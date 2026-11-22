import { describe, expect, it } from "vitest";
import { createNcatRoutes } from "../../src/mastra/ncat/routes";
import { translateWordsPrompt, translateWordsRequest } from "../../src/mastra/ncat/translate";
import { ctx, find } from "../helpers/route-harness";

/**
 * POST /ncat/translate-words: for "Caption video" with a caption language, the dashboard
 * sends a video's spoken words in short lines, once per video and language, and gets back
 * each line translated, every word paired with the spoken words it stands for. The model
 * is the stand-in (AIMock); its answer is at the top of fixtures/chat.json.
 */

const route = find(createNcatRoutes(), "/ncat/translate-words", "POST");

const ASKED = {
  language: "Spanish",
  lines: [
    ["We", "opened", "the", "cafe", "last", "spring."],
    ["Nobody", "came."],
  ],
  organizationId: "team_1",
};

describe("the agent translating captions word by word", () => {
  it("answers with each line's words and the spoken words they stand for", async () => {
    const { c, captured } = ctx({ resourceId: "u1", body: ASKED });
    await route.handler(c);
    expect(captured.status).toBe(200);
    const body = captured.body as { answer: string; model: string; usage: unknown };
    const lines = JSON.parse(body.answer) as [string, number[]][][];
    expect(lines).toHaveLength(2);
    expect(lines[0]![0]).toEqual(["Abrimos", [1]]);
    expect(lines[1]).toEqual([
      ["Nadie", [0]],
      ["vino.", [1]],
    ]);
    expect(typeof body.model).toBe("string");
    expect(body.usage).toBeTruthy();
  });

  it("refuses an unsigned call and a body it cannot read", async () => {
    const unsigned = ctx({ body: ASKED });
    await route.handler(unsigned.c);
    expect(unsigned.captured.status).toBe(401);
    const bad = ctx({ resourceId: "u1", body: { ...ASKED, lines: [[]] } });
    await route.handler(bad.c);
    expect(bad.captured.status).toBe(400);
  });
});

describe("the word-by-word translate prompt", () => {
  it("numbers each line's words from 0", () => {
    const prompt = translateWordsPrompt(translateWordsRequest.parse(ASKED));
    expect(prompt).toContain("Translate these spoken caption lines into Spanish");
    expect(prompt).toContain("Line 1: 0:We 1:opened 2:the 3:cafe 4:last 5:spring.");
    expect(prompt).toContain("Line 2: 0:Nobody 1:came.");
    expect(prompt).not.toContain("without spaces");
  });

  it("asks for readable word groups in a language written without spaces", () => {
    const prompt = translateWordsPrompt(
      translateWordsRequest.parse({ language: "Japanese", noSpaces: true, lines: [["Hi"]] }),
    );
    expect(prompt).toContain("Japanese is written without spaces");
  });
});
