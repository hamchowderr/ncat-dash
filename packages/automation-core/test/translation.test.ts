import { describe, expect, it } from "vitest";

import {
  LANGUAGES,
  TRANSLATE_BATCH_LINES,
  cuesToTranslate,
  languageName,
  languageOf,
  nextBatchEnd,
  readTranslatedLines,
  toSrt,
  translatedCues,
  translationFileName,
} from "../src";

describe("languages", () => {
  it("finds a language by its code, whatever its case", () => {
    expect(languageOf("es")).toEqual({ code: "es", name: "Spanish" });
    expect(languageOf("PT-br")?.name).toBe("Portuguese (Brazil)");
    expect(languageOf("xx")).toBeNull();
    expect(languageName("ja")).toBe("Japanese");
    expect(languageName("xx")).toBe("xx");
  });

  it("lists each code once", () => {
    const codes = LANGUAGES.map((language) => language.code.toLowerCase());
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("the lines a translation is made of", () => {
  const words = (text: string, from: number) =>
    text.split(" ").map((t, index) => ({ t, s: from + index * 0.4, e: from + index * 0.4 + 0.3 }));

  it("uses the same cues as the original subtitles, each on one line", () => {
    const pieces = [
      {
        start: 0,
        end: 9,
        text: "",
        words: words(
          "We opened the cafe in the spring of last year with a tiny budget. Nobody came.",
          0,
        ),
      },
    ];
    const cues = cuesToTranslate(pieces);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues.every((cue) => !cue.text.includes("\n"))).toBe(true);
    expect(cues[0]!.start).toBe(0);
  });

  it("puts translated lines back on the cues' times, wrapped for the screen", () => {
    const cues = [
      { start: 1, end: 3, text: "Hello there" },
      { start: 3, end: 7, text: "This is a much longer line that would not fit on one row" },
    ];
    const lines = [
      "Hola",
      "Esta es una línea mucho más larga que no cabría en una sola fila de la pantalla",
    ];
    const translated = translatedCues(cues, lines);
    expect(translated[0]).toEqual({ start: 1, end: 3, text: "Hola" });
    expect(translated[1]!.text).toContain("\n");
    expect(toSrt(translated)).toContain("00:00:01,000 --> 00:00:03,000\nHola");
  });
});

describe("batches", () => {
  it("takes at most a batch of lines at a time, and always at least one", () => {
    const lines = Array.from({ length: 300 }, (_, index) => `Line ${index}`);
    expect(nextBatchEnd(lines, 0)).toBe(TRANSLATE_BATCH_LINES);
    expect(nextBatchEnd(lines, 290)).toBe(300);
    const long = ["x".repeat(20_000), "short"];
    expect(nextBatchEnd(long, 0)).toBe(1);
    expect(nextBatchEnd(long, 1)).toBe(2);
  });
});

describe("reading the model's answer", () => {
  it("reads a list with one line for each line sent", () => {
    expect(readTranslatedLines('["Hola", "  Adiós  amigos "]', 2)).toEqual([
      "Hola",
      "Adiós amigos",
    ]);
    expect(readTranslatedLines('Here you go:\n```json\n["Hola"]\n```', 1)).toEqual(["Hola"]);
  });

  it("refuses an answer with the wrong number of lines or that is not a list", () => {
    expect(readTranslatedLines('["Hola"]', 2)).toBeNull();
    expect(readTranslatedLines("Hola, adiós", 2)).toBeNull();
    expect(readTranslatedLines('["Hola", 2]', 2)).toBeNull();
    expect(readTranslatedLines('{"lines": ["Hola"', 1)).toBeNull();
  });
});

describe("download names", () => {
  it("names the file after the video and the language", () => {
    expect(translationFileName("Cafe: episode 1", "es", "srt")).toBe("Cafe episode 1.es.srt");
    expect(translationFileName("", "fr", "vtt")).toBe("transcript.fr.vtt");
  });
});
