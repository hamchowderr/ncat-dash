import { describe, expect, it } from "vitest";

import {
  cleanTags,
  formatMoment,
  librarySearchText,
  readShortId,
  shortIdLetter,
  snippetAround,
  titleFromFileName,
  transcriptPieces,
} from "../src";

describe("short IDs", () => {
  it("start with a letter for the kind of file", () => {
    expect(shortIdLetter("video", "upload")).toBe("V");
    expect(shortIdLetter("video", "automation")).toBe("C");
    expect(shortIdLetter("audio", "upload")).toBe("A");
    expect(shortIdLetter("image", "automation")).toBe("I");
    expect(shortIdLetter("other", "upload")).toBe("F");
  });

  it("are read however someone types them", () => {
    expect(readShortId("c99")).toBe("C99");
    expect(readShortId(" V12 ")).toBe("V12");
    expect(readShortId("#C-007")).toBe("C7");
    expect(readShortId("v 3")).toBe("V3");
    expect(readShortId("video 3")).toBeNull();
    expect(readShortId("X12")).toBeNull();
    expect(readShortId("C")).toBeNull();
  });
});

describe("tags", () => {
  it("are kept lowercase, trimmed and without repeats", () => {
    expect(cleanTags(["Pricing", " pricing ", "#Behind  the scenes", "", "  "])).toEqual([
      "pricing",
      "behind the scenes",
    ]);
  });

  it("are cut to a sensible length and number", () => {
    expect(cleanTags(["x".repeat(80)])[0]).toHaveLength(40);
    expect(cleanTags(Array.from({ length: 50 }, (_, i) => `tag ${i}`))).toHaveLength(30);
  });
});

describe("search text and titles", () => {
  it("joins the ID, title, tags and automation", () => {
    expect(
      librarySearchText({
        shortId: "C4",
        title: "Episode 4 clip 1",
        tags: ["pricing", "q&a"],
        automationName: "Podcast clips",
      }),
    ).toBe("C4 Episode 4 clip 1 pricing q&a Podcast clips");
  });

  it("reads a title out of a file name", () => {
    expect(titleFromFileName("episode-4_final.mp4")).toBe("episode-4 final");
    expect(titleFromFileName("Talk.MOV")).toBe("Talk");
    expect(titleFromFileName("notes")).toBe("notes");
  });
});

describe("transcript pieces", () => {
  const segment = (start: number, end: number, text: string) => ({
    id: 0,
    seek: 0,
    start,
    end,
    text,
    tokens: [1, 2, 3],
    avg_logprob: -0.2,
  });

  it("keeps each sentence its own piece, folding short fragments into the next", () => {
    const pieces = transcriptPieces([
      segment(0, 1, " Okay."),
      segment(1, 8, " Welcome back to the show."),
      segment(8, 20, " Today we talk about pricing."),
      segment(20, 29, " And why it matters."),
    ]);
    expect(pieces).toEqual([
      { start: 0, end: 8, text: "Okay. Welcome back to the show." },
      { start: 8, end: 20, text: "Today we talk about pricing." },
      { start: 20, end: 29, text: "And why it matters." },
    ]);
  });

  it("skips anything that is not a segment and sorts by time", () => {
    expect(
      transcriptPieces([
        null,
        "text",
        { start: "1", text: "no" },
        segment(40, 45, " later"),
        segment(0, 2, "   "),
        segment(1, 3, " sooner"),
      ]),
    ).toEqual([
      { start: 1, end: 3, text: "sooner" },
      { start: 40, end: 45, text: "later" },
    ]);
    expect(transcriptPieces({ text: "not a list" })).toEqual([]);
  });
});

describe("snippets and moments", () => {
  it("shows the words around a match", () => {
    const text = `${"filler words here ".repeat(20)}the pricing question came up ${"and more talk ".repeat(20)}`;
    const snippet = snippetAround(text, "pricing", 80);
    expect(snippet).toContain("pricing");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(82);
  });

  it("keeps a short piece whole", () => {
    expect(snippetAround("Short one.", "one")).toBe("Short one.");
  });

  it("writes a moment the way a player does", () => {
    expect(formatMoment(42.7)).toBe("0:42");
    expect(formatMoment(751)).toBe("12:31");
    expect(formatMoment(3725)).toBe("1:02:05");
  });
});
