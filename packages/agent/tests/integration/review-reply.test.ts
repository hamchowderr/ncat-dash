import { describe, expect, it, vi } from "vitest";
import { createNcatRoutes } from "../../src/mastra/ncat/routes";
import { reviewPrompt } from "../../src/mastra/ncat/review";
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

  it("sends the still to the model as the image itself, not its address", async () => {
    const still = "http://toolkit.internal.test/still.jpg";
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const images: unknown[] = [];
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === still) {
        return new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
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
        body: { ...asked("@Agent is the logo too small here?"), still },
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
});
