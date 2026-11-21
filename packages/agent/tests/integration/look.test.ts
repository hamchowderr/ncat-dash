import { describe, expect, it, vi } from "vitest";
import { lookPrompt, lookRequest } from "../../src/mastra/ncat/look";
import { createNcatRoutes } from "../../src/mastra/ncat/routes";
import { ctx, find } from "../helpers/route-harness";

/**
 * POST /ncat/look: Settings → Looks sends a sheet of frames from a sample video, once,
 * and gets back what the model saw as text. The model is the stand-in (AIMock); its answer
 * is at the top of fixtures/chat.json.
 */

const route = find(createNcatRoutes(), "/ncat/look", "POST");

const SHEET = "http://toolkit.internal.test/sheet.png";
const ASKED = {
  sheet: SHEET,
  name: "Cafe sample reel",
  width: 1080,
  height: 1920,
  duration: 31.5,
  shotSeconds: 2.25,
  organizationId: "team_1",
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);

describe("the agent copying a look", () => {
  it("sends the sheet itself to the model and answers with what it saw", async () => {
    const images: unknown[] = [];
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === SHEET) return new Response(PNG, { headers: { "content-type": "image/png" } });
      if (url.includes("/v1/messages") && typeof init?.body === "string") {
        const body = JSON.parse(init.body) as {
          messages: { content: string | { type: string }[] }[];
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
      const { c, captured } = ctx({ resourceId: "u1", body: ASKED });
      await route.handler(c);
      expect(captured.status).toBe(200);
      const answer = JSON.parse((captured.body as { answer: string }).answer) as {
        fill: string;
        captions: { position: string };
      };
      expect(answer.fill).toBe("blur");
      expect(answer.captions.position).toBe("middle");
      expect(images).toEqual([
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: Buffer.from(PNG).toString("base64"),
          },
        },
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it("says so, without asking, when the sheet cannot be fetched", async () => {
    const { c, captured } = ctx({
      resourceId: "u1",
      body: { ...ASKED, sheet: "http://127.0.0.1:9/gone.png" },
    });
    await route.handler(c);
    expect(captured.status).toBe(502);
    expect(captured.body).toEqual({ error: "The frames could not be fetched." });
  });

  it("refuses an unsigned call and a body it cannot read", async () => {
    const unsigned = ctx({ body: ASKED });
    await route.handler(unsigned.c);
    expect(unsigned.captured.status).toBe(401);
    const bad = ctx({ resourceId: "u1", body: { ...ASKED, width: "wide" } });
    await route.handler(bad.c);
    expect(bad.captured.status).toBe(400);
  });
});

describe("the look prompt", () => {
  it("passes on the sample's size, length and pace", () => {
    const prompt = lookPrompt(lookRequest.parse(ASKED));
    expect(prompt).toContain("Sample: Cafe sample reel");
    expect(prompt).toContain("1080 by 1920 pixels, 31.5 seconds long.");
    expect(prompt).toContain("A new shot starts about every 2.3 seconds.");
    expect(lookPrompt(lookRequest.parse({ ...ASKED, shotSeconds: null }))).toContain(
      "How long its shots last is not known.",
    );
  });
});
