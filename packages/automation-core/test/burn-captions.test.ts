import { describe, expect, it } from "vitest";
import {
  burnRequest,
  burnsInFast,
  canUseKnownWords,
  clipRequest,
  hasKnownWords,
  segmentsFromWords,
  withKnownWords,
  withoutKnownWords,
  wordsInClip,
  wordsRequest,
} from "../src";

describe("captions burned in with one quick save", () => {
  it("asks for the timed words with the caption job's look, word fixes, skipped parts and language", () => {
    const job = {
      video_url: "https://f/clip.mp4",
      settings: { style: "highlight" },
      replace: [{ find: "chowder", replace: "Chowderr" }],
      exclude_time_ranges: [{ start: "00:00:01", end: "00:00:02" }],
      language: "en",
    };
    expect(wordsRequest(job)).toEqual({
      media_url: "https://f/clip.mp4",
      settings: { style: "highlight" },
      replace: [{ find: "chowder", replace: "Chowderr" }],
      exclude_time_ranges: [{ start: "00:00:01", end: "00:00:02" }],
      language: "en",
    });
    expect(wordsRequest({ video_url: "https://f/a.mp4" })).toEqual({
      media_url: "https://f/a.mp4",
    });
  });

  it("takes every caption job except text the team typed itself", () => {
    expect(burnsInFast({ video_url: "x" })).toBe(true);
    expect(burnsInFast({ video_url: "x", captions: "  " })).toBe(true);
    expect(burnsInFast({ video_url: "x", captions: "Hello" })).toBe(false);
  });

  it("burns the caption file in with the same quick settings Clips uses, keeping the sound", () => {
    const burn = burnRequest("https://f/clip.mp4", "https://f/words.ass") as {
      inputs: unknown[];
      filters: { filter: string }[];
      outputs: { options: unknown[] }[];
    };
    expect(burn.inputs).toEqual([{ file_url: "https://f/clip.mp4" }]);
    expect(burn.filters[0].filter).toBe("[0:v]ass='https://f/words.ass',setsar=1[v]");
    const clip = clipRequest("https://f/a.mp4", { start: 0, seconds: 10 }, "9:16") as {
      outputs: { options: unknown[] }[];
    };
    const quick = (options: unknown[]) =>
      options.filter((o) => ["-c:v", "-preset", "-crf"].includes((o as { option: string }).option));
    expect(quick(burn.outputs[0].options)).toEqual(quick(clip.outputs[0].options));
    expect(burn.outputs[0].options).toContainEqual({ option: "-map", argument: "0:a?" });
  });
});

describe("clips", () => {
  it("make the blurred fill from a quarter-size copy, then scale it to the full frame", () => {
    const clip = clipRequest("https://f/a.mp4", { start: 0, seconds: 10 }, "9:16") as {
      filters: { filter: string }[];
    };
    expect(clip.filters[0].filter).toContain("crop=270:480,boxblur=5:5,scale=1080:1920[blurred]");
  });
});

describe("captions from words already known", () => {
  const words = [
    { text: "So", start: 0, end: 0.2 },
    { text: "this", start: 0.3, end: 0.5 },
    { text: "works.", start: 0.6, end: 1 },
    { text: "Then", start: 1.1, end: 1.3 },
    { text: "a", start: 1.4, end: 1.5 },
    { text: "pause", start: 1.6, end: 2 },
    { text: "later", start: 3.5, end: 4 },
  ];

  it("groups words into stretches at sentence ends and pauses, as Whisper does", () => {
    const segments = segmentsFromWords(words);
    expect(segments.map((s) => s.words.map((w) => w.word).join(" "))).toEqual([
      "So this works.",
      "Then a pause",
      "later",
    ]);
    expect(segments[1]).toMatchObject({ start: 1.1, end: 2 });
  });

  it("breaks a long run of talk without pauses", () => {
    const talk = Array.from({ length: 100 }, (_, i) => ({
      text: `w${i}`,
      start: i * 0.3,
      end: i * 0.3 + 0.25,
    }));
    const segments = segmentsFromWords(talk);
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) expect(segment.end - segment.start).toBeLessThanOrEqual(15);
    expect(segments.flatMap((s) => s.words)).toHaveLength(100);
  });

  it("skips blank or broken words and keeps times going forward", () => {
    expect(
      segmentsFromWords([
        { text: " ", start: 0, end: 1 },
        { text: "Hi", start: 2, end: 1.5 },
        { text: "x", start: Number.NaN, end: 1 },
      ]),
    ).toEqual([{ start: 2, end: 2, words: [{ word: "Hi", start: 2, end: 2 }] }]);
  });

  it("takes a clip's words timed from its start, counting a cut word when most of it is in", () => {
    expect(wordsInClip(words, 1.2, 1)).toEqual([
      { text: "Then", start: 0, end: 0.1 },
      { text: "a", start: 0.2, end: 0.3 },
      { text: "pause", start: 0.4, end: 0.8 },
    ]);
  });

  it("only for a step that hears the language it is given", () => {
    expect(canUseKnownWords({})).toBe(true);
    expect(canUseKnownWords({ language: "auto" })).toBe(true);
    expect(canUseKnownWords({ language: "fr" })).toBe(false);
  });

  it("adds the words and the picture size to the request, and can take them off again", () => {
    const request = {
      media_url: "https://f/a.mp4",
      settings: { style: "highlight" },
      language: "auto",
    };
    const known = withKnownWords(request, words.slice(0, 3), { width: 1080, height: 1920 });
    expect(known).toMatchObject({
      media_url: "https://f/a.mp4",
      canvas_width: 1080,
      canvas_height: 1920,
    });
    expect(known).not.toHaveProperty("language");
    expect(hasKnownWords(known)).toBe(true);
    expect(hasKnownWords(request)).toBe(false);
    expect(withKnownWords(request, [], null)).not.toHaveProperty("canvas_width");
    expect(withoutKnownWords(known)).toEqual({
      media_url: "https://f/a.mp4",
      settings: { style: "highlight" },
    });
  });
});
