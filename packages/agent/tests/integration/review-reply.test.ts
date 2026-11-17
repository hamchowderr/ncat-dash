import { describe, expect, it, vi } from "vitest";
import { createNcatRoutes } from "../../src/mastra/ncat/routes";
import { clock, reviewPrompt } from "../../src/mastra/ncat/review";
import { ctx, find } from "../helpers/route-harness";

/**
 * POST /ncat/review-reply: Convex asks for the agent's answer to an "@Agent" comment in a
 * review room. The model is the stand-in (AIMock); its fixtures are at the top of
 * fixtures/chat.json.
 */

const route = find(createNcatRoutes(), "/ncat/review-reply", "POST");

function asked(body: string, overrides: Record<string, unknown> = {}) {
  return {
    question: {
      review: { title: "Weekly clips", status: "open" },
      clip: {
        title: "Opening hello",
        version: 1,
        versions: 1,
        url: "https://files.example.test/opening-hello.mp4",
        isVideo: true,
      },
      moment: { seconds: 2, label: "0:02" },
      thread: [{ author: "Maya Ortiz", body, isAgent: false }],
      otherNotes: [{ at: "0:04", author: "Jordan Lee", body: "Cut is late here", resolved: false }],
      automation: {
        name: "Weekly clips",
        outline: "Starts when a file is sent to its web address.\n1. Split video\n2. Approval",
        runStatus: "waiting",
      },
      askedBy: "Maya Ortiz",
      ...overrides,
    },
    still: null,
  };
}

const SENSE = {
  frames: { from: 0, every: 0.5, count: 12 },
  pacing: { cuts: 3, averageShot: 10, shot: { start: 1.5, end: 9 }, cutsNear: [1.5, 9] },
  sound: {
    hasAudio: true,
    loudness: -23.5,
    loudnessAtMoment: -31,
    quietNear: [{ start: 2, end: 3.2 }],
  },
  transcript: [{ at: 1.5, text: "Welcome back to the station." }],
};

describe("the agent answering in a review room", () => {
  it("answers the comment it was tagged in", async () => {
    const { c, captured } = ctx({
      resourceId: "u1",
      body: asked("@Agent is the logo too small here?"),
    });
    await route.handler(c);
    expect(captured.status).toBe(200);
    expect((captured.body as { answer: string }).answer).toMatch(/At 0:02 the logo/);
  });

  it("sends the still and the frames to the model as the pictures themselves, not their addresses", async () => {
    const still = "http://toolkit.internal.test/still.jpg";
    const frames = "http://toolkit.internal.test/frames.png";
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
    const images: unknown[] = [];
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === still) {
        return new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
      }
      if (url === frames) {
        return new Response(png, { headers: { "content-type": "image/png" } });
      }
      if (url.includes("/v1/messages") && typeof init?.body === "string") {
        const body = JSON.parse(init.body) as {
          messages: { content: string | { type: string; source?: unknown }[] }[];
        };
        for (const message of body.messages) {
          if (Array.isArray(message.content)) {
            images.push(...message.content.filter((part) => part.type === "image"));
          }
        }
      }
      return realFetch(input, init);
    });
    try {
      const { c, captured } = ctx({
        resourceId: "u1",
        body: { ...asked("@Agent is the logo too small here?"), still, frames, sense: SENSE },
      });
      await route.handler(c);
      expect(captured.status).toBe(200);
      expect(images).toEqual([
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: Buffer.from(jpeg).toString("base64"),
          },
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: Buffer.from(png).toString("base64"),
          },
        },
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it("answers without the still when it cannot be fetched", async () => {
    const { c, captured } = ctx({
      resourceId: "u1",
      body: {
        ...asked("@Agent is the logo too small here?"),
        still: "http://127.0.0.1:9/gone.jpg",
      },
    });
    await route.handler(c);
    expect(captured.status).toBe(200);
  });

  it("only answers a signed request", async () => {
    const { c, captured } = ctx({ body: asked("@Agent is the logo too small here?") });
    await route.handler(c);
    expect(captured.status).toBe(401);
  });

  it("refuses a question that is not one", async () => {
    const { c, captured } = ctx({ resourceId: "u1", body: { question: { thread: [] } } });
    await route.handler(c);
    expect(captured.status).toBe(400);
  });
});

describe("the prompt", () => {
  it("gives the model the clip, the moment, the automation, the notes and the thread", () => {
    const { question } = asked("@Agent does the opening hold attention?");
    const prompt = reviewPrompt(question, false);
    expect(prompt).toContain('Clip: "Opening hello", version 1 of 1.');
    expect(prompt).toContain("pinned to 0:02. No still of the moment could be taken.");
    expect(prompt).toContain("1. Split video");
    expect(prompt).toContain("- 0:04 Jordan Lee: Cut is late here");
    expect(prompt).toContain("Maya Ortiz: @Agent does the opening hold attention?");
    expect(prompt.trim().endsWith("Answer Maya Ortiz's latest message in this thread.")).toBe(true);
  });

  it("says when the clip has no timeline, and marks the agent's own earlier answers", () => {
    const { question } = asked("@Agent and now?", {
      moment: null,
      automation: null,
      otherNotes: [],
    });
    question.thread.push({ author: "Agent", body: "Earlier answer", isAgent: true });
    const prompt = reviewPrompt(question, true);
    expect(prompt).toContain("a still image or a file without a timeline");
    expect(prompt).toContain("You (the agent): Earlier answer");
    expect(prompt).not.toContain("automation");
  });

  it("tells the model the frames, pacing, sound and speech the toolkit measured", () => {
    const { question } = asked("@Agent does this drag?");
    const prompt = reviewPrompt(question, true, SENSE, true);
    expect(prompt).toContain("The image is a still of that moment.");
    expect(prompt).toContain(
      "The second image shows 12 frames in reading order (left to right, then down), one every 0.5 seconds from 0:00.",
    );
    expect(prompt).toContain(
      "Pacing: 3 cuts in the clip, a shot lasts 10 seconds on average. The moment is in a shot from 0:01.5 to 0:09; cuts near it at 0:01.5, 0:09.",
    );
    expect(prompt).toContain(
      "the clip averages -23.5 LUFS, -31 LUFS in the 3 seconds around the moment",
    );
    expect(prompt).toContain("Quiet gaps nearby: 0:02 to 0:03.2.");
    expect(prompt).toContain("0:01.5 Welcome back to the station.");
  });

  it("says plainly what is missing: one take, no audio, no frames picture", () => {
    const { question } = asked("@Agent does this drag?");
    const prompt = reviewPrompt(
      question,
      false,
      {
        frames: null,
        pacing: { cuts: 0, averageShot: 12, shot: { start: 0, end: 12 }, cutsNear: [] },
        sound: { hasAudio: false, loudness: null, loudnessAtMoment: null, quietNear: [] },
        transcript: null,
      },
      false,
    );
    expect(prompt).toContain("Pacing: the clip is one continuous shot with no cuts.");
    expect(prompt).toContain("Sound: the clip has no audio track.");
    expect(prompt).not.toContain("frames in reading order");
  });

  it("calls the frames picture the image when there is no still", () => {
    const { question } = asked("@Agent and here?");
    expect(reviewPrompt(question, false, SENSE, true)).toContain("The image shows 12 frames");
  });

  it("writes moments the way the team does", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(75.5)).toBe("1:15.5");
    expect(clock(600)).toBe("10:00");
  });
});
