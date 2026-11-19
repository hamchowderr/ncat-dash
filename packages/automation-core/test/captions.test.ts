import { getStep } from "@ncat-dash/step-catalog";
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_STYLES,
  type CaptionSetup,
  captionSetupText,
  needsDetails,
  NO_CAPTION_SETUP,
  shapeOf,
  styleFor,
  styleNameFor,
  tidyCaptionSetup,
  withCaptionSetup,
} from "../src";

const VERTICAL = { width: 1080, height: 1920 };
const WIDE = { width: 1920, height: 1080 };

const setup: CaptionSetup = {
  fixes: [
    { find: "chowder", replace: "Chowderr" },
    { find: "otaku", replace: "Otaku" },
  ],
  styles: [
    { name: "Tall", look: { style: "highlight", font_size: 100, word_color: "#FF0000" } },
    { name: "Wide", look: { style: "classic", font_size: 50 } },
  ],
  byShape: { vertical: "Tall", wide: "Wide" },
};

describe("caption shapes", () => {
  it("tells vertical, wide and square apart", () => {
    expect(shapeOf(VERTICAL)).toBe("vertical");
    expect(shapeOf(WIDE)).toBe("wide");
    expect(shapeOf({ width: 1080, height: 1080 })).toBe("square");
    expect(shapeOf({ width: 1080, height: 1350 })).toBe("vertical");
    expect(shapeOf(null)).toBeNull();
    expect(shapeOf({ width: 1080 })).toBeNull();
  });

  it("gives each shape the team's style, or the built-in one", () => {
    expect(styleNameFor(setup, "vertical")).toBe("Tall");
    expect(styleNameFor(setup, "wide")).toBe("Wide");
    expect(styleNameFor(setup, "square")).toBe("Bold highlight");
    expect(styleNameFor(NO_CAPTION_SETUP, "wide")).toBe("Clean");
    // A style that was removed falls back to the built-in choice.
    expect(styleNameFor({ ...setup, byShape: { vertical: "Gone" } }, "vertical")).toBe(
      "Bold highlight",
    );
  });
});

describe("styling a caption job", () => {
  const input = { video_url: "https://f.example/a.mp4" };

  it("uses the style for the video's shape", () => {
    const tall = withCaptionSetup(input, setup, { details: VERTICAL });
    expect(tall.settings).toMatchObject({ style: "highlight", font_size: 100 });
    const wide = withCaptionSetup(input, setup, { details: WIDE });
    expect(wide.settings).toMatchObject({ style: "classic", font_size: 50 });
  });

  it("scales the text size to the video's height", () => {
    const fourK = withCaptionSetup(input, setup, { details: { width: 2160, height: 3840 } });
    expect((fourK.settings as { font_size: number }).font_size).toBe(200);
  });

  it("uses a picked style whatever the shape, and never sends its name", () => {
    const out = withCaptionSetup({ ...input, caption_style: "wide" }, setup, {
      details: VERTICAL,
    });
    expect(out.settings).toMatchObject({ style: "classic" });
    expect(out).not.toHaveProperty("caption_style");
  });

  it("keeps what the step set itself on top of the style", () => {
    const out = withCaptionSetup(
      { ...input, caption_style: "Tall", settings: { word_color: "#00FF00", font_size: "" } },
      setup,
      { details: VERTICAL },
    );
    expect(out.settings).toMatchObject({ word_color: "#00FF00", font_size: 100 });
  });

  it("leaves a step with its own look alone", () => {
    const out = withCaptionSetup({ ...input, settings: { style: "karaoke" } }, setup, {
      details: VERTICAL,
    });
    expect(out.settings).toEqual({ style: "karaoke" });
  });

  it("uses the team's font when the look names none", () => {
    const out = withCaptionSetup(input, setup, { details: VERTICAL, brandFont: "Inter" });
    expect(out.settings).toMatchObject({ font_family: "Inter" });
  });

  it("does not guess a style when the shape is not known and shapes differ", () => {
    expect(styleFor(setup, input, null)).toBeNull();
    const same = { ...setup, byShape: { vertical: "Tall", wide: "Tall", square: "Tall" } };
    expect(styleFor(same, input, null)?.name).toBe("Tall");
  });

  it("adds the team's word fixes after the step's own, the step's winning", () => {
    const out = withCaptionSetup(
      { ...input, replace: [{ find: "Chowder", replace: "chowder soup" }] },
      setup,
      { details: VERTICAL },
    );
    expect(out.replace).toEqual([
      { find: "Chowder", replace: "chowder soup" },
      { find: "otaku", replace: "Otaku" },
    ]);
  });

  it("makes requests the toolkit accepts", () => {
    const caption = getStep("video-caption")!;
    const ass = getStep("media-generate-ass")!;
    const out = withCaptionSetup({ ...input, caption_style: "Tall" }, setup, {
      details: VERTICAL,
      brandFont: "Inter",
    });
    expect(() => caption.input.strict().parse(out)).not.toThrow();
    const assOut = withCaptionSetup({ media_url: input.video_url }, setup, { details: WIDE });
    expect(() => ass.input.strict().parse(assOut)).not.toThrow();
  });

  it("only needs the video's size when a style is going to be used", () => {
    expect(needsDetails(input, setup)).toBe(true);
    expect(needsDetails({ ...input, caption_style: "Tall" }, setup)).toBe(true);
    expect(needsDetails({ ...input, settings: { style: "karaoke" } }, setup)).toBe(false);
  });
});

describe("saving a caption setup", () => {
  it("tidies blanks and spaces", () => {
    const result = tidyCaptionSetup({
      fixes: [
        { find: " chowder ", replace: " Chowderr " },
        { find: "", replace: "" },
      ],
      styles: [{ name: " Mine ", look: { style: "karaoke", font_size: undefined } }],
      byShape: { vertical: "mine", wide: "Clean" },
    });
    expect(result).toEqual({
      ok: true,
      setup: {
        fixes: [{ find: "chowder", replace: "Chowderr" }],
        styles: [{ name: "Mine", look: { style: "karaoke" } }],
        byShape: { vertical: "Mine", wide: "Clean" },
      },
    });
  });

  it.each([
    [{ fixes: [{ find: "two words", replace: "x" }] }, "more than one word"],
    [{ fixes: [{ find: "a", replace: "" }] }, 'how "a" should be written'],
    [
      {
        fixes: [
          { find: "a", replace: "b" },
          { find: "A", replace: "c" },
        ],
      },
      "twice",
    ],
    [{ styles: [{ name: "Clean", look: {} }] }, "built-in"],
    [{ styles: [{ name: "Mine", look: { line_color: "red" } }] }, "hex colour"],
    [{ styles: [{ name: "Mine", look: { font_size: 2 } }] }, "Text size"],
    [{ byShape: { wide: "Nope" } }, 'no style called "Nope"'],
  ])("refuses %j", (partial, message) => {
    const result = tidyCaptionSetup({ ...NO_CAPTION_SETUP, ...partial } as CaptionSetup);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(message);
  });

  it("describes itself for the agent", () => {
    const text = captionSetupText(setup);
    expect(text).toContain('vertical videos get "Tall"');
    expect(text).toContain("2 word fixes");
    for (const style of BUILT_IN_STYLES) expect(text).toContain(style.name);
  });
});
