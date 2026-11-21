import { describe, expect, it } from "vitest";

import {
  captionCues,
  toPlainTranscript,
  toSrt,
  toVtt,
  transcriptFileName,
  transcriptParagraphs,
  transcriptPieces,
  wrapCue,
  type PieceWord,
} from "../src";

const timed = (text: string, from: number, step = 0.4): PieceWord[] =>
  text.split(" ").map((t, index) => ({
    t,
    s: from + index * step,
    e: from + index * step + step * 0.8,
  }));

describe("pieces keep each word's timing", () => {
  it("carries the words of segments made with word timestamps", () => {
    const pieces = transcriptPieces([
      {
        start: 0,
        end: 2,
        text: " Hello there everyone, welcome.",
        words: [
          { word: " Hello", start: 0, end: 0.4 },
          { word: " there", start: 0.5, end: 0.8 },
          { word: " everyone,", start: 0.9, end: 1.4 },
          { word: " welcome.", start: 1.5, end: 2 },
        ],
      },
    ]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.words).toEqual([
      { t: "Hello", s: 0, e: 0.4 },
      { t: "there", s: 0.5, e: 0.8 },
      { t: "everyone,", s: 0.9, e: 1.4 },
      { t: "welcome.", s: 1.5, e: 2 },
    ]);
  });

  it("leaves words out when the transcript has none", () => {
    const pieces = transcriptPieces([{ start: 0, end: 2, text: "No words timed here at all." }]);
    expect(pieces[0]).not.toHaveProperty("words");
  });

  it("joins the words of short segments that join the next one", () => {
    const pieces = transcriptPieces([
      { start: 0, end: 0.5, text: "Okay.", words: [{ word: "Okay.", start: 0, end: 0.5 }] },
      {
        start: 0.6,
        end: 2,
        text: "So here we go now.",
        words: timed("So here we go now.", 0.6, 0.3).map((w) => ({
          word: w.t,
          start: w.s,
          end: w.e,
        })),
      },
    ]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.words!.map((word) => word.t)).toEqual([
      "Okay.",
      "So",
      "here",
      "we",
      "go",
      "now.",
    ]);
  });
});

describe("subtitle cues", () => {
  it("wraps a long cue over two lines near its middle", () => {
    const text = "This line is a good deal longer than forty two characters";
    const wrapped = wrapCue(text);
    expect(wrapped.split("\n")).toHaveLength(2);
    for (const line of wrapped.split("\n")) expect(line.length).toBeLessThanOrEqual(42);
    expect(wrapCue("Short line.")).toBe("Short line.");
  });

  it("starts a new cue after a sentence, a pause, six seconds or two full lines", () => {
    const words = [
      ...timed("I have never known how to code.", 0),
      ...timed("In 39 days we merged 881 changes.", 4),
    ];
    const cues = captionCues([{ start: 0, end: 7, text: "", words }]);
    expect(cues.map((cue) => cue.text.replace("\n", " "))).toEqual([
      "I have never known how to code.",
      "In 39 days we merged 881 changes.",
    ]);
    expect(cues[0]!.start).toBe(0);
    expect(cues[1]!.start).toBe(4);

    const long = timed(Array.from({ length: 40 }, (_, i) => `word${i}`).join(" "), 0, 0.3);
    for (const cue of captionCues([{ start: 0, end: 12, text: "", words: long }])) {
      expect(cue.end - cue.start).toBeLessThanOrEqual(6.5);
      for (const line of cue.text.split("\n")) expect(line.length).toBeLessThanOrEqual(42);
    }
  });

  it("splits a long piece without word timings and shares its time by length", () => {
    const text =
      "This is the first sentence of a long piece. Then a second one follows it here. " +
      "And a third sentence closes the whole piece out nicely.";
    const cues = captionCues([{ start: 10, end: 22, text }]);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues[0]!.start).toBe(10);
    expect(cues[cues.length - 1]!.end).toBeCloseTo(22, 2);
    for (let i = 1; i < cues.length; i++)
      expect(cues[i]!.start).toBeGreaterThanOrEqual(cues[i - 1]!.end);
  });

  it("never lets cues overlap and keeps each on screen long enough", () => {
    const cues = captionCues([
      { start: 0, end: 0.1, text: "Hi." },
      { start: 0.3, end: 2, text: "Then the rest." },
    ]);
    expect(cues[0]!.end).toBeLessThanOrEqual(cues[1]!.start);
    expect(cues[0]!.end).toBeGreaterThan(cues[0]!.start);
  });
});

describe("subtitle files", () => {
  const cues = [
    { start: 0, end: 1.5, text: "Hello there." },
    { start: 3661.25, end: 3663, text: "An hour in." },
  ];

  it("writes SRT with numbered cues and comma milliseconds", () => {
    expect(toSrt(cues)).toBe(
      "1\n00:00:00,000 --> 00:00:01,500\nHello there.\n\n" +
        "2\n01:01:01,250 --> 01:01:03,000\nAn hour in.\n",
    );
  });

  it("writes WebVTT with its header and dot milliseconds", () => {
    expect(toVtt(cues)).toBe(
      "WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nHello there.\n\n" +
        "01:01:01.250 --> 01:01:03.000\nAn hour in.\n",
    );
    expect(toVtt([])).toBe("WEBVTT\n");
  });

  it("writes plain text in paragraphs, each under its moment", () => {
    const pieces = [
      { start: 0, end: 2, text: "First thought." },
      { start: 2.5, end: 4, text: "Still the same paragraph." },
      { start: 10, end: 12, text: "After a long pause." },
    ];
    expect(transcriptParagraphs(pieces)).toEqual([
      { start: 0, text: "First thought. Still the same paragraph." },
      { start: 10, text: "After a long pause." },
    ]);
    expect(toPlainTranscript(pieces)).toBe(
      "[0:00] First thought. Still the same paragraph.\n\n[0:10] After a long pause.\n",
    );
  });

  it("names a download after the file", () => {
    expect(transcriptFileName("Weekly call: 2026/11/21", "srt")).toBe("Weekly call 2026 11 21.srt");
    expect(transcriptFileName("   ", "vtt")).toBe("transcript.vtt");
  });
});
