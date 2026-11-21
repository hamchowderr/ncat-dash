import {
  type FrameLook,
  frameLookOf,
  LOOK_FILLS,
  type LookFill,
  type LookShape,
} from "@ncat-dash/step-catalog";

import {
  CAPTION_LOOKS,
  type CaptionLook,
  type CaptionLookKind,
  captionLookProblem,
  SHAPE_HEIGHT,
} from "./captions";

/**
 * # Saved looks
 *
 * A team copies the look of a video it likes once: the toolkit takes a sheet of six
 * frames from it and finds its camera cuts, and the model looks at the sheet one time and
 * says how the picture is filled, how the colour is graded and how the captions look. All
 * of that is kept as a saved look, which the Match A Saved Look step then puts any video
 * into with plain FFmpeg, never asking the model again.
 */

/** What the dashboard knows of the sample before the model looks at it. */
export interface LookFacts {
  width: number;
  height: number;
  /** In seconds. */
  duration: number;
  /** How long a shot lasts on average, from the camera cuts; null when not known. */
  shotSeconds: number | null;
}

/** What studying a sample found, before it is named and saved. */
export interface LookProposal {
  frame: FrameLook;
  /** The captions burned into the sample, as a caption style; null when it has none. */
  captions: CaptionLook | null;
  shotSeconds: number | null;
  /** One or two sentences on the look, from the model, for the team to read. */
  notes: string;
}

export const MAX_LOOKS = 30;
export const MAX_LOOK_NAME = 60;

/** Vertical, wide or square, from the sample's picture size. */
export function lookShapeOf(width: number, height: number): LookShape {
  if (!(width > 0) || !(height > 0)) return "vertical";
  const ratio = width / height;
  return ratio < 0.9 ? "vertical" : ratio > 1.1 ? "wide" : "square";
}

/** How long a shot lasts on average, in seconds to one place, from the cuts found. */
export function shotSecondsFrom(cuts: number[], duration: number): number | null {
  if (!(duration > 0)) return null;
  const inside = cuts.filter((cut) => cut > 0 && cut < duration);
  return Math.round((duration / (inside.length + 1)) * 10) / 10;
}

/** Caption text sizes the model picks from, as a share of the picture's height. */
const SIZES = { small: 0.028, medium: 0.04, large: 0.055 } as const;
const POSITIONS = { top: "top_center", middle: "middle_center", bottom: "bottom_center" } as const;
const HEX = /^#[0-9a-fA-F]{6}$/;

const choice = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

const colour = (value: unknown, fallback: string) =>
  typeof value === "string" && HEX.test(value.trim()) ? value.trim().toUpperCase() : fallback;

/** The caption part of the model's answer as a caption look the toolkit takes, or null. */
function captionsOf(value: unknown, shape: LookShape): CaptionLook | null {
  if (!value || typeof value !== "object") return null;
  const said = value as Record<string, unknown>;
  const size = choice(said.size, ["small", "medium", "large"] as const, "medium");
  const words = Number(said.words_per_line);
  const look: CaptionLook = {
    style: choice<CaptionLookKind>(said.effect, CAPTION_LOOKS, "highlight"),
    font_size: Math.round(SHAPE_HEIGHT[shape] * SIZES[size]),
    bold: said.bold === true,
    all_caps: said.all_caps === true,
    max_words_per_line: Number.isFinite(words) ? Math.min(8, Math.max(1, Math.round(words))) : 4,
    position: POSITIONS[choice(said.position, ["top", "middle", "bottom"] as const, "bottom")],
    line_color: colour(said.text_color, "#FFFFFF"),
    word_color: colour(said.word_color, "#FFD400"),
    outline_color: colour(said.outline_color, "#000000"),
    outline_width: said.outline === false ? 0 : 3,
  };
  if (look.style === "classic") delete look.word_color;
  return captionLookProblem(look) ? null : look;
}

/**
 * The model's answer read as a look, or null when it holds no JSON object. Every number is
 * kept in range and every choice one of its own; the shape and pace come from the facts,
 * not the model, since FFmpeg knows them for certain.
 */
export function readLookAnswer(text: string, facts: LookFacts): LookProposal | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let said: Record<string, unknown>;
  try {
    said = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!said || typeof said !== "object" || Array.isArray(said)) return null;
  const shape = lookShapeOf(facts.width, facts.height);
  const frame = frameLookOf({
    ...said,
    shape,
    fill: choice<LookFill>(said.fill, LOOK_FILLS, "crop"),
  });
  const notes = typeof said.notes === "string" ? said.notes.trim().slice(0, 400) : "";
  return {
    frame,
    captions: captionsOf(said.captions, shape),
    shotSeconds: facts.shotSeconds,
    notes,
  };
}

const SHAPE_WORDS: Record<LookShape, string> = {
  vertical: "Vertical",
  wide: "Wide",
  square: "Square",
};

const FILL_WORDS: Record<LookFill, string> = {
  crop: "cut to fill the frame",
  blur: "a blurred copy behind",
  bars: "black bars",
};

/** The colour of a look in a few plain words, or "colour left as it is". */
export function gradeWords(frame: FrameLook): string {
  const words: string[] = [];
  if (frame.brightness >= 0.03) words.push("brighter");
  if (frame.brightness <= -0.03) words.push("darker");
  if (frame.contrast >= 1.05) words.push("punchier");
  if (frame.contrast <= 0.95) words.push("flatter");
  if (frame.saturation === 0) words.push("black and white");
  else if (frame.saturation >= 1.1) words.push("more vivid");
  else if (frame.saturation <= 0.9) words.push("muted");
  if (frame.warmth >= 0.1) words.push("warmer");
  if (frame.warmth <= -0.1) words.push("cooler");
  return words.length ? words.join(", ") : "colour left as it is";
}

/** A look in one line: "Vertical, a blurred copy behind, warmer, a new shot every 2.1s". */
export function lookSummary(look: Pick<LookProposal, "frame" | "shotSeconds">): string {
  const parts = [
    SHAPE_WORDS[look.frame.shape],
    FILL_WORDS[look.frame.fill],
    gradeWords(look.frame),
  ];
  if (look.shotSeconds) parts.push(`a new shot every ${look.shotSeconds} seconds`);
  return parts.join(", ");
}

/** A name for a look, trimmed, or a problem in plain words. */
export function lookNameProblem(name: string, taken: string[]): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the look a name.";
  if (trimmed.length > MAX_LOOK_NAME) return `A name is at most ${MAX_LOOK_NAME} characters.`;
  if (trimmed.startsWith("{")) return "A name cannot start with {.";
  if (taken.some((one) => one.toLowerCase() === trimmed.toLowerCase())) {
    return `There is already a look called "${trimmed}".`;
  }
  return null;
}
