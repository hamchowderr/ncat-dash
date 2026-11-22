import { describe, expect, it } from "vitest";

import {
  CAPTION_LANGUAGE_SETTING,
  CAPTION_STYLE_SETTING,
  assColour,
  assTime,
  captionLanguageOf,
  captionPlace,
  readAlignedLines,
  scriptFontFor,
  spokenLines,
  timeAlignedLine,
  timeTranslatedLines,
  translatedCaptionFile,
  withCaptionSetup,
  withoutDashboardSettings,
  writtenWithoutSpaces,
  type Word,
} from "../src";

const said = (text: string, from = 0, step = 0.5): Word[] =>
  text.split(" ").map((word, index) => ({
    text: word,
    start: from + index * step,
    end: from + index * step + step * 0.8,
  }));

describe("caption language setting", () => {
  it("reads a language on the list and ignores anything else", () => {
    expect(captionLanguageOf({ [CAPTION_LANGUAGE_SETTING]: "es" })).toBe("es");
    expect(captionLanguageOf({ [CAPTION_LANGUAGE_SETTING]: "PT-br" })).toBe("pt-BR");
    expect(captionLanguageOf({ [CAPTION_LANGUAGE_SETTING]: "xx" })).toBeNull();
    expect(captionLanguageOf({})).toBeNull();
  });

  it("is never sent to the toolkit", () => {
    const input = {
      video_url: "https://x/v.mp4",
      [CAPTION_LANGUAGE_SETTING]: "es",
      [CAPTION_STYLE_SETTING]: "Bold highlight",
    };
    expect(withoutDashboardSettings(input)).toEqual({ video_url: "https://x/v.mp4" });
    const sent = withCaptionSetup(input, { fixes: [], styles: [], byShape: {} }, {});
    expect(sent).not.toHaveProperty(CAPTION_LANGUAGE_SETTING);
    expect(sent).not.toHaveProperty(CAPTION_STYLE_SETTING);
  });

  it("knows which languages are written without spaces and need other fonts", () => {
    expect(writtenWithoutSpaces("ja")).toBe(true);
    expect(writtenWithoutSpaces("zh-TW")).toBe(true);
    expect(writtenWithoutSpaces("es")).toBe(false);
    expect(scriptFontFor("ja")).toBe("Noto Sans CJK JP");
    expect(scriptFontFor("zh")).toBe("Noto Sans CJK SC");
    expect(scriptFontFor("zh-TW")).toBe("Noto Sans CJK TC");
    expect(scriptFontFor("ko")).toBe("Noto Sans CJK KR");
    expect(scriptFontFor("hi")).toBe("Noto Sans Devanagari");
    expect(scriptFontFor("th")).toBe("Noto Sans Thai");
    expect(scriptFontFor("he")).toBe("Noto Sans Hebrew");
    expect(scriptFontFor("am")).toBe("Noto Sans Ethiopic");
    expect(scriptFontFor("ar")).toBe("Noto Sans Arabic");
    expect(scriptFontFor("es")).toBeNull();
  });
});

describe("spokenLines", () => {
  it("ends a line at a sentence, a pause, or 18 words", () => {
    const words = [
      ...said("We went in. Then"),
      { text: "later", start: 5, end: 5.4 },
      ...said(Array.from({ length: 20 }, (_, i) => `w${i}`).join(" "), 6),
    ];
    const lines = spokenLines(words);
    expect(lines[0]).toEqual([0, 1, 2]);
    expect(lines[1]).toEqual([3]);
    expect(lines[2]![0]).toBe(4);
    expect(lines[2]!.length).toBe(18);
    expect(lines[3]!.length).toBe(3);
    expect(lines.flat()).toEqual(words.map((_, i) => i));
  });
});

describe("readAlignedLines", () => {
  it("reads pairs of word and spoken word numbers, one list per line", () => {
    const answer = 'Sure:\n[[["Hola", [0]], ["mundo", [1, 1]]], [["Sí", []], ["", [0]]]]';
    expect(readAlignedLines(answer, [2, 1])).toEqual([
      [
        { t: "Hola", src: [0] },
        { t: "mundo", src: [1] },
      ],
      [{ t: "Sí", src: [] }],
    ]);
  });

  it("drops numbers past the line's end and refuses a wrong shape", () => {
    expect(readAlignedLines('[[["a", [0, 5, -1, 1.5]]]]', [2])).toEqual([[{ t: "a", src: [0] }]]);
    expect(readAlignedLines('[[["a", [0]]]]', [1, 1])).toBeNull();
    expect(readAlignedLines('[["a"]]', [1])).toBeNull();
    expect(readAlignedLines("not json", [1])).toBeNull();
  });
});

describe("timeAlignedLine", () => {
  const spoken = said("the red car is fast", 10, 0.5);

  it("gives a word the time of the spoken word it stands for", () => {
    const timed = timeAlignedLine(spoken, [
      { t: "el", src: [0] },
      { t: "coche", src: [2] },
      { t: "rojo", src: [1] },
      { t: "es", src: [3] },
      { t: "rápido", src: [4] },
    ]);
    expect(timed.map((word) => word.t)).toEqual(["el", "coche", "rojo", "es", "rápido"]);
    // "coche rojo" swaps "red car": one of the two keeps its own start, the other does
    // not jump back past it.
    expect([timed[1]!.s === 11, timed[2]!.s === 10.5]).toContain(true);
    expect(timed[2]!.s).toBeGreaterThan(timed[1]!.s);
    expect(timed[3]!.s).toBe(11.5);
    expect(timed[4]!.s).toBe(12);
    // The line starts and ends with the spoken line, and the words follow one another.
    expect(timed[0]!.s).toBe(10);
    expect(timed[timed.length - 1]!.e).toBe(12.4);
    for (let i = 1; i < timed.length; i++) expect(timed[i]!.s).toBe(timed[i - 1]!.e);
  });

  it("shares a reversed line out by length instead of holding one word", () => {
    const timed = timeAlignedLine(spoken, [
      { t: "速い", src: [4] },
      { t: "車", src: [2] },
      { t: "赤い", src: [1] },
      { t: "その", src: [0] },
    ]);
    for (const word of timed) expect(word.e - word.s).toBeGreaterThanOrEqual(0.12);
    const longest = Math.max(...timed.map((word) => word.e - word.s));
    expect(longest).toBeLessThan(1.5);
  });

  it("shares a line with no pairs out by length, start to end", () => {
    const timed = timeAlignedLine(spoken, [
      { t: "aa", src: [] },
      { t: "bbbb", src: [] },
    ]);
    expect(timed[0]).toEqual({ t: "aa", s: 10, e: 10.8 });
    expect(timed[1]).toEqual({ t: "bbbb", s: 10.8, e: 12.4 });
  });

  it("gives every word room even when the line was said quickly", () => {
    const quick = [{ text: "ok", start: 1, end: 1.1 }];
    const timed = timeAlignedLine(quick, [
      { t: "de", src: [0] },
      { t: "acuerdo", src: [0] },
    ]);
    expect(timed[1]!.e - timed[0]!.s).toBeCloseTo(0.24, 5);
  });

  it("times nothing for an empty line", () => {
    expect(timeAlignedLine(spoken, [])).toEqual([]);
    expect(timeTranslatedLines(spoken, [[0, 1]], [])).toEqual([[]]);
  });
});

describe("translatedCaptionFile", () => {
  const lines = [
    [
      { t: "Hola", s: 0, e: 0.5 },
      { t: "a", s: 0.5, e: 0.7 },
      { t: "todos", s: 0.7, e: 1.2 },
    ],
  ];
  const size = { width: 1080, height: 1920 };

  it("writes colours, times and places the way the toolkit does", () => {
    expect(assColour("#F2B33D")).toBe("&H003DB3F2");
    expect(assColour("nope")).toBe("&H00FFFFFF");
    expect(assTime(3725.456)).toBe("1:02:05.46");
    expect(captionPlace({ position: "bottom_center" }, 1080, 1920)).toEqual({
      an: 2,
      x: 540,
      y: 1600,
    });
    expect(captionPlace({ position: "top_left", alignment: "left" }, 1080, 1920)).toEqual({
      an: 7,
      x: 0,
      y: 320,
    });
    expect(captionPlace({ x: 10, y: 20, alignment: "right" }, 1080, 1920).an).toBe(6);
  });

  it("lights the said word in highlight, with the line under it", () => {
    const file = translatedCaptionFile(
      lines,
      {
        style: "highlight",
        all_caps: true,
        bold: true,
        font_size: 90,
        max_words_per_line: 4,
        position: "bottom_center",
        word_color: "#F2B33D",
      },
      size,
      "es",
    );
    expect(file).toContain("PlayResX: 1080\nPlayResY: 1920");
    expect(file).toContain("Style: Default,Arial,90,&H00FFFFFF,&H00FFFFFF,&H00000000");
    expect(file).toContain(
      "Dialogue: 0,0:00:00.00,0:00:01.20,Default,,0,0,0,,{\\an2\\pos(540,1600)}{\\c&H00FFFFFF}HOLA A TODOS",
    );
    expect(file).toContain(
      "Dialogue: 1,0:00:00.50,0:00:00.70,Default,,0,0,0,,{\\an2\\pos(540,1600)}{\\c&H00FFFFFF}HOLA {\\c&H003DB3F2}A{\\c&H00FFFFFF} TODOS",
    );
  });

  it("fills each word in karaoke, splitting lines at the words per line", () => {
    const file = translatedCaptionFile(
      lines,
      { style: "karaoke", max_words_per_line: 2, word_color: "#4ADE80" },
      size,
      "es",
    );
    expect(file).toContain("{\\c&H0080DE4A}{\\k50}Hola {\\k20}a\\N{\\k50}todos");
  });

  it("underlines, shows one word at a time, or shows plain lines", () => {
    const underline = translatedCaptionFile(lines, { style: "underline" }, size, "es");
    expect(underline).toContain("Hola {\\u1}a{\\u0} todos");
    const single = translatedCaptionFile(lines, { style: "word_by_word" }, size, "es");
    expect(single.match(/^Dialogue/gm)).toHaveLength(3);
    const plain = translatedCaptionFile(lines, {}, size, "es");
    expect(plain).toContain("}Hola a todos");
    expect(plain.match(/^Dialogue/gm)).toHaveLength(1);
  });

  it("joins words without spaces and uses a font that has the letters", () => {
    const file = translatedCaptionFile(
      [
        [
          { t: "洞窟を", s: 0, e: 1 },
          { t: "探検しました", s: 1, e: 2 },
        ],
      ],
      { style: "highlight", font_family: "Arial", all_caps: true },
      size,
      "ja",
    );
    expect(file).toContain("Style: Default,Noto Sans CJK JP,");
    expect(file).toContain("洞窟を{\\c&H0000FFFF}探検しました");
  });

  it("keeps braces and backslashes from becoming caption commands", () => {
    const file = translatedCaptionFile([[{ t: "{\\b1}hi", s: 0, e: 1 }]], {}, size, "es");
    expect(file).toContain("}b1hi");
    expect(file).not.toContain("{\\b1}");
  });
});
