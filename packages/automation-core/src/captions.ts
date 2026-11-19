/**
 * How a team's captions look and read, set once in Settings and used by every caption step:
 *
 * - Word fixes: words the transcript keeps getting wrong (a brand name, a web address,
 *   slang), each with how it should be written. They go to the toolkit as the caption
 *   request's `replace` list, so they are fixed before the captions are burned in.
 * - Saved styles: a named look (font, size, words per line, colours, outline, shadow,
 *   position). A few ready-made looks come built in; a team saves its own.
 * - Styles by shape: which style vertical, wide and square videos get. A caption step that
 *   does not pick a style uses the one for its video's shape, read from the file's details.
 *
 * What a step sets on its own always wins over all of this.
 */
import type { FileDetails } from "./details";

/** The caption steps these apply to. */
export const CAPTION_STEPS = ["video-caption", "media-generate-ass"] as const;

export function isCaptionStep(stepId: string | undefined): boolean {
  return (CAPTION_STEPS as readonly string[]).includes(stepId ?? "");
}

/** The setting on a caption step that names the style it uses. Never sent to the toolkit. */
export const CAPTION_STYLE_SETTING = "caption_style";

export type CaptionShape = "vertical" | "wide" | "square";

export const CAPTION_SHAPES: { shape: CaptionShape; label: string; example: string }[] = [
  { shape: "vertical", label: "Vertical videos", example: "Shorts, Reels, TikTok" },
  { shape: "wide", label: "Wide videos", example: "YouTube, podcasts" },
  { shape: "square", label: "Square videos", example: "1:1 and 4:5 feed posts" },
];

/** The picture height each shape's sizes are given for. A taller video gets bigger text. */
export const SHAPE_HEIGHT: Record<CaptionShape, number> = {
  vertical: 1920,
  wide: 1080,
  square: 1080,
};

export const CAPTION_LOOKS = [
  "highlight",
  "karaoke",
  "word_by_word",
  "underline",
  "classic",
] as const;
export type CaptionLookKind = (typeof CAPTION_LOOKS)[number];

export const LOOK_WORDS: Record<CaptionLookKind, { name: string; text: string }> = {
  highlight: { name: "Highlight", text: "The word being said changes colour" },
  karaoke: { name: "Karaoke", text: "Words fill with colour as they are said" },
  word_by_word: { name: "One word at a time", text: "Only the word being said shows" },
  underline: { name: "Underline", text: "The word being said is underlined" },
  classic: { name: "Plain lines", text: "Whole lines, no word effect" },
};

export const CAPTION_POSITIONS = ["top_center", "middle_center", "bottom_center"] as const;
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];

export const POSITION_WORDS: Record<CaptionPosition, string> = {
  top_center: "Top",
  middle_center: "Middle",
  bottom_center: "Bottom",
};

/** A caption look, in the toolkit's own setting names. Every part is optional. */
export interface CaptionLook {
  style?: CaptionLookKind;
  font_family?: string;
  /** Text height in pixels on a video of the shape's height (1920 tall for vertical). */
  font_size?: number;
  bold?: boolean;
  all_caps?: boolean;
  max_words_per_line?: number;
  line_color?: string;
  word_color?: string;
  outline_color?: string;
  outline_width?: number;
  shadow_offset?: number;
  position?: CaptionPosition;
}

export interface CaptionStyle {
  name: string;
  look: CaptionLook;
}

export interface WordFix {
  /** The word as the transcript writes it. */
  find: string;
  /** How it should read. */
  replace: string;
}

export interface CaptionSetup {
  fixes: WordFix[];
  styles: CaptionStyle[];
  /** Which style each shape gets, by name. A shape left out gets the built-in choice. */
  byShape: Partial<Record<CaptionShape, string>>;
}

export const NO_CAPTION_SETUP: CaptionSetup = { fixes: [], styles: [], byShape: {} };

/** Looks every team has without saving anything. Teams start their own from one. */
export const BUILT_IN_STYLES: CaptionStyle[] = [
  {
    name: "Bold highlight",
    look: {
      style: "highlight",
      all_caps: true,
      bold: true,
      font_size: 90,
      max_words_per_line: 4,
      position: "bottom_center",
      line_color: "#FFFFFF",
      word_color: "#F2B33D",
      outline_color: "#000000",
      outline_width: 3,
    },
  },
  {
    name: "Clean",
    look: {
      style: "classic",
      font_size: 54,
      max_words_per_line: 8,
      position: "bottom_center",
      line_color: "#FFFFFF",
      outline_color: "#000000",
      outline_width: 2,
      shadow_offset: 1,
    },
  },
  {
    name: "Karaoke",
    look: {
      style: "karaoke",
      bold: true,
      font_size: 80,
      max_words_per_line: 5,
      position: "middle_center",
      line_color: "#FFFFFF",
      word_color: "#4ADE80",
      outline_color: "#000000",
      outline_width: 3,
    },
  },
  {
    name: "One word",
    look: {
      style: "word_by_word",
      all_caps: true,
      bold: true,
      font_size: 120,
      position: "middle_center",
      line_color: "#FFFFFF",
      outline_color: "#000000",
      outline_width: 4,
    },
  },
];

/** What each shape gets when the team has not picked: big words for short clips, plain lines for wide. */
export const BUILT_IN_BY_SHAPE: Record<CaptionShape, string> = {
  vertical: "Bold highlight",
  square: "Bold highlight",
  wide: "Clean",
};

export const MAX_WORD_FIXES = 200;
export const MAX_CAPTION_STYLES = 30;

/** Vertical, wide or square, from a picture size. Null when the size is not known. */
export function shapeOf(details: Pick<FileDetails, "width" | "height"> | null | undefined) {
  const width = details?.width;
  const height = details?.height;
  if (!width || !height) return null;
  const ratio = width / height;
  const shape: CaptionShape = ratio < 0.9 ? "vertical" : ratio > 1.1 ? "wide" : "square";
  return shape;
}

/** Every style a step can pick: the team's own first, then the built-in ones. */
export function allCaptionStyles(setup: CaptionSetup): CaptionStyle[] {
  return [...setup.styles, ...BUILT_IN_STYLES];
}

export function findCaptionStyle(setup: CaptionSetup, name: unknown): CaptionStyle | undefined {
  if (typeof name !== "string" || !name.trim()) return undefined;
  const wanted = name.trim().toLowerCase();
  return allCaptionStyles(setup).find((style) => style.name.toLowerCase() === wanted);
}

/** The name of the style a shape gets. */
export function styleNameFor(setup: CaptionSetup, shape: CaptionShape): string {
  const picked = setup.byShape[shape];
  return picked && findCaptionStyle(setup, picked) ? picked : BUILT_IN_BY_SHAPE[shape];
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/** The settings a step set itself, without blanks. */
function ownSettings(input: Record<string, unknown>): Record<string, unknown> {
  const settings = input.settings;
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return {};
  return Object.fromEntries(Object.entries(settings).filter(([, value]) => !isBlank(value)));
}

/**
 * Whether a caption step needs its video's size before it can be sent: a style is going
 * to be applied (it picked one, or set no look of its own), and the style for the shape
 * and the text size for the video's height both come from it.
 */
export function needsDetails(input: Record<string, unknown>, setup: CaptionSetup): boolean {
  if (findCaptionStyle(setup, input[CAPTION_STYLE_SETTING])) return true;
  return Object.keys(ownSettings(input)).length === 0;
}

/**
 * The style a caption step uses for one video: the one it picked, or the team's style for
 * the video's shape. Null when the step set its own look, or the shape is not known and
 * the shapes differ (the toolkit's own look is used then).
 */
export function styleFor(
  setup: CaptionSetup,
  input: Record<string, unknown>,
  shape: CaptionShape | null,
): CaptionStyle | null {
  const picked = findCaptionStyle(setup, input[CAPTION_STYLE_SETTING]);
  if (picked) return picked;
  if (Object.keys(ownSettings(input)).length > 0) return null;
  if (shape) return findCaptionStyle(setup, styleNameFor(setup, shape)) ?? null;
  const names = new Set(CAPTION_SHAPES.map(({ shape: each }) => styleNameFor(setup, each)));
  return names.size === 1 ? (findCaptionStyle(setup, [...names][0]) ?? null) : null;
}

/** A look's text size for a video of this height, so a 4K video gets text as big as 1080p. */
function scaledSize(size: number, shape: CaptionShape | null, height: number | undefined) {
  if (!shape || !height) return size;
  return Math.max(8, Math.round((size * height) / SHAPE_HEIGHT[shape]));
}

/**
 * A caption job's input with the team's captions applied: the style's look under the
 * step's own settings, the team's font when the look names none, and the team's word
 * fixes after the step's own. The style setting is taken out; the toolkit does not know it.
 */
export function withCaptionSetup(
  input: Record<string, unknown>,
  setup: CaptionSetup,
  file: { details?: Pick<FileDetails, "width" | "height"> | null; brandFont?: string },
): Record<string, unknown> {
  const rest = Object.fromEntries(
    Object.entries(input).filter(([name]) => name !== CAPTION_STYLE_SETTING),
  );
  const shape = shapeOf(file.details);
  const style = styleFor(setup, input, shape);
  const out: Record<string, unknown> = { ...rest };

  if (style) {
    const look: Record<string, unknown> = { ...style.look };
    if (typeof look.font_size === "number") {
      look.font_size = scaledSize(look.font_size, shape, file.details?.height);
    }
    if (isBlank(look.font_family) && file.brandFont) look.font_family = file.brandFont;
    out.settings = { ...look, ...ownSettings(input) };
  }

  const own = Array.isArray(input.replace) ? (input.replace as WordFix[]) : [];
  const taken = new Set(own.map((fix) => String(fix.find ?? "").toLowerCase()));
  const team = setup.fixes.filter((fix) => !taken.has(fix.find.toLowerCase()));
  if (own.length + team.length > 0) out.replace = [...own, ...team];
  return out;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;
const FONT = /^[A-Za-z0-9 ._-]{1,80}$/;

/** A problem with a look in plain words, or null when it is fine. */
export function captionLookProblem(look: CaptionLook): string | null {
  if (look.style !== undefined && !CAPTION_LOOKS.includes(look.style)) return "Pick a word effect.";
  if (look.position !== undefined && !CAPTION_POSITIONS.includes(look.position)) {
    return "Pick top, middle or bottom.";
  }
  if (look.font_family !== undefined && !FONT.test(look.font_family)) {
    return "A font name can hold letters, numbers, spaces, dots, dashes and underscores.";
  }
  for (const key of ["line_color", "word_color", "outline_color"] as const) {
    const value = look[key];
    if (value !== undefined && !HEX.test(value)) return "Use a hex colour such as #FFCC00.";
  }
  const whole = (value: number | undefined, low: number, high: number) =>
    value === undefined || (Number.isInteger(value) && value >= low && value <= high);
  if (!whole(look.font_size, 8, 400)) return "Text size is a whole number from 8 to 400.";
  if (!whole(look.max_words_per_line, 1, 20)) return "Words per line is from 1 to 20.";
  if (!whole(look.outline_width, 0, 20)) return "Outline is from 0 to 20.";
  if (!whole(look.shadow_offset, 0, 20)) return "Shadow is from 0 to 20.";
  return null;
}

/**
 * A team's caption setup tidied for saving (trimmed, blanks and repeats dropped), or a
 * problem in plain words.
 */
export function tidyCaptionSetup(
  setup: CaptionSetup,
): { ok: true; setup: CaptionSetup } | { ok: false; message: string } {
  const fail = (message: string) => ({ ok: false as const, message });
  const fixes: WordFix[] = [];
  for (const fix of setup.fixes) {
    const find = fix.find.trim();
    const replace = fix.replace.trim();
    if (!find && !replace) continue;
    if (!find) return fail(`Say which word "${replace}" replaces.`);
    if (/\s/.test(find)) {
      return fail(
        `"${find}" is more than one word. Captions are fixed a word at a time, so add each word on its own line.`,
      );
    }
    if (find.length > 60 || replace.length > 60) return fail("Keep each word under 60 letters.");
    if (!replace) return fail(`Say how "${find}" should be written.`);
    if (fixes.some((other) => other.find.toLowerCase() === find.toLowerCase())) {
      return fail(`"${find}" is in the list twice.`);
    }
    fixes.push({ find, replace });
  }
  if (fixes.length > MAX_WORD_FIXES) return fail(`Keep up to ${MAX_WORD_FIXES} word fixes.`);

  const styles: CaptionStyle[] = [];
  for (const style of setup.styles) {
    const name = style.name.trim();
    if (!name || name.length > 40) return fail("Give each style a name of up to 40 letters.");
    const clash = (other: CaptionStyle) => other.name.toLowerCase() === name.toLowerCase();
    if (BUILT_IN_STYLES.some(clash))
      return fail(`"${name}" is a built-in style. Pick another name.`);
    if (styles.some(clash)) return fail(`Two styles are called "${name}".`);
    const look = Object.fromEntries(
      Object.entries(style.look).filter(([, value]) => !isBlank(value)),
    ) as CaptionLook;
    const problem = captionLookProblem(look);
    if (problem) return fail(`${name}: ${problem}`);
    styles.push({ name, look });
  }
  if (styles.length > MAX_CAPTION_STYLES) return fail(`Keep up to ${MAX_CAPTION_STYLES} styles.`);

  const byShape: CaptionSetup["byShape"] = {};
  const tidied = { fixes, styles, byShape };
  for (const { shape } of CAPTION_SHAPES) {
    const picked = setup.byShape[shape]?.trim();
    if (!picked) continue;
    const style = findCaptionStyle(tidied, picked);
    if (!style) return fail(`There is no style called "${picked}".`);
    byShape[shape] = style.name;
  }
  return { ok: true, setup: tidied };
}

/** One line for the agent: what the team's captions do by themselves. */
export function captionSetupText(setup: CaptionSetup): string {
  const shapes = CAPTION_SHAPES.map(
    ({ shape, label }) => `${label.toLowerCase()} get "${styleNameFor(setup, shape)}"`,
  ).join(", ");
  const styles = allCaptionStyles(setup)
    .map((style) => `"${style.name}"`)
    .join(", ");
  const fixes =
    setup.fixes.length > 0
      ? ` ${setup.fixes.length} word fixes from Settings are applied to every caption.`
      : "";
  return `Caption steps style themselves from Settings: ${shapes}. To use another look, set ${CAPTION_STYLE_SETTING} to one of ${styles}; leave settings blank.${fixes}`;
}
