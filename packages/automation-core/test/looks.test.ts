import { describe, expect, it } from "vitest";

import {
  gradeWords,
  lookNameProblem,
  lookShapeOf,
  lookSummary,
  readLookAnswer,
  savedLooksText,
  shotSecondsFrom,
} from "../src";

const facts = { width: 1080, height: 1920, duration: 30, shotSeconds: 2.5 };

describe("reading what the model saw in a sample", () => {
  it("keeps the fill, the grade and the captions, with shape and pace from the facts", () => {
    const answer = `Here is the look:
{"fill":"blur","brightness":0.02,"contrast":1.15,"saturation":1.2,"warmth":0.3,
 "captions":{"effect":"highlight","position":"middle","size":"large","bold":true,"all_caps":true,
 "words_per_line":3,"text_color":"#ffffff","word_color":"#22dd88","outline_color":"#000000"},
 "notes":"Warm, punchy talking head with big centred captions.","shape":"wide"}`;
    expect(readLookAnswer(answer, facts)).toEqual({
      frame: {
        shape: "vertical",
        fill: "blur",
        brightness: 0.02,
        contrast: 1.15,
        saturation: 1.2,
        warmth: 0.3,
      },
      captions: {
        style: "highlight",
        font_size: 106,
        bold: true,
        all_caps: true,
        max_words_per_line: 3,
        position: "middle_center",
        line_color: "#FFFFFF",
        word_color: "#22DD88",
        outline_color: "#000000",
        outline_width: 3,
      },
      shotSeconds: 2.5,
      notes: "Warm, punchy talking head with big centred captions.",
    });
  });

  it("keeps anything odd in range, and no captions when the sample has none", () => {
    const read = readLookAnswer(
      '{"fill":"stretch","contrast":9,"warmth":"-4","captions":null,"notes":5}',
      { ...facts, width: 1920, height: 1080, shotSeconds: null },
    );
    expect(read).toEqual({
      frame: {
        shape: "wide",
        fill: "crop",
        brightness: 0,
        contrast: 1.6,
        saturation: 1,
        warmth: -1,
      },
      captions: null,
      shotSeconds: null,
      notes: "",
    });
  });

  it("drops a caption colour that is not a colour, and plain lines get no word colour", () => {
    const read = readLookAnswer(
      '{"captions":{"effect":"classic","text_color":"red; drop","size":"small"}}',
      facts,
    );
    expect(read?.captions).toMatchObject({
      style: "classic",
      line_color: "#FFFFFF",
      font_size: 54,
    });
    expect(read?.captions).not.toHaveProperty("word_color");
  });

  it("is null when there is no JSON to read", () => {
    expect(readLookAnswer("I could not see the frames.", facts)).toBeNull();
    expect(readLookAnswer("{not json}", facts)).toBeNull();
  });
});

describe("plain facts about a look", () => {
  it("knows the shape from the picture size", () => {
    expect(lookShapeOf(1080, 1920)).toBe("vertical");
    expect(lookShapeOf(1920, 1080)).toBe("wide");
    expect(lookShapeOf(1000, 1000)).toBe("square");
  });

  it("works out the pace from the camera cuts", () => {
    expect(shotSecondsFrom([2, 4, 6, 8, 40], 10)).toBe(2);
    expect(shotSecondsFrom([], 12)).toBe(12);
    expect(shotSecondsFrom([1], 0)).toBeNull();
  });

  it("says a look in one line", () => {
    expect(
      lookSummary({
        frame: {
          shape: "vertical",
          fill: "blur",
          brightness: 0,
          contrast: 1.2,
          saturation: 1,
          warmth: 0.4,
        },
        shotSeconds: 2.1,
      }),
    ).toBe("Vertical, a blurred copy behind, punchier, warmer, a new shot every 2.1 seconds");
    expect(
      gradeWords({
        shape: "wide",
        fill: "crop",
        brightness: 0,
        contrast: 1,
        saturation: 0,
        warmth: 0,
      }),
    ).toBe("black and white");
  });

  it("checks a name", () => {
    expect(lookNameProblem("  ", [])).toBe("Give the look a name.");
    expect(lookNameProblem("cafe reels", ["Cafe Reels"])).toBe(
      'There is already a look called "cafe reels".',
    );
    expect(lookNameProblem("Cafe Reels", [])).toBeNull();
  });
});

describe("saved looks for the agent", () => {
  it("lists each by name with what it does, and says nothing when there are none", () => {
    expect(savedLooksText([])).toBeNull();
    expect(
      savedLooksText([
        {
          name: "Square Bars",
          frame: {
            shape: "square",
            fill: "bars",
            brightness: 0,
            contrast: 1,
            saturation: 1,
            warmth: 0,
          },
        },
      ]),
    ).toBe(
      'Saved looks (the Match A Saved Look step\'s "look" setting takes one of these names; blank uses the first):\n- Square Bars: Square, black bars, colour left as it is',
    );
  });
});
