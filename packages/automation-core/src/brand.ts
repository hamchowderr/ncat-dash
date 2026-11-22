/**
 * Things a team sets once and every automation uses: its logo, colour, font and music,
 * the card picture that quote cards and end cards are written on, and its intro and outro.
 * They live in the team's settings. A step that needs one takes it from there, so nobody
 * fills in a logo on every step.
 */
export type BrandKey = "logo" | "color" | "font" | "music" | "card" | "intro" | "outro";

export type Brand = Partial<Record<BrandKey, string>>;

export const BRAND_KEYS: BrandKey[] = ["logo", "color", "font", "music", "card", "intro", "outro"];

/** The brand items that are a file: an upload or an address. */
export const BRAND_FILES = ["logo", "music", "card", "intro", "outro"] as const;
export type BrandFileKey = (typeof BRAND_FILES)[number];

export function isBrandFile(key: BrandKey): key is BrandFileKey {
  return (BRAND_FILES as readonly string[]).includes(key);
}

/** How each one is named in a sentence: "Uses your team's logo." */
export const BRAND_WORDS: Record<BrandKey, string> = {
  logo: "logo",
  color: "brand colour",
  font: "font",
  music: "background music",
  card: "card template",
  intro: "intro",
  outro: "outro",
};

const UPLOAD_REF = /^upload:([A-Za-z0-9_-]+)$/;

/**
 * A lasting pointer to one of the team's uploads. A signed link to a file stops working
 * after a week, so anything kept in settings holds this instead, and it is swapped for a
 * fresh link at the moment a job is sent to the toolkit.
 */
export function uploadRef(uploadId: string): string {
  return `upload:${uploadId}`;
}

/** The upload id inside a pointer made by `uploadRef`, or null for anything else. */
export function readUploadRef(value: unknown): string | null {
  return typeof value === "string" ? (UPLOAD_REF.exec(value)?.[1] ?? null) : null;
}

const CLIP_REF = /^upload:([A-Za-z0-9_-]+)#t=(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/;
const TIME_RANGE = /#t=(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/;

const seconds3 = (value: number) => String(Math.round(Math.max(0, value) * 1000) / 1000);

/**
 * A pointer to part of one of the team's uploads, from `start` to `end` seconds: the
 * upload's pointer with a media fragment (`#t=12.3,15.8`), which a browser plays as just
 * that stretch.
 */
export function clipRef(uploadId: string, start: number, end: number): string {
  return `upload:${uploadId}#t=${seconds3(start)},${seconds3(Math.max(start, end))}`;
}

/** The upload and the stretch inside a pointer made by `clipRef`, or null. */
export function readClipRef(
  value: unknown,
): { uploadId: string; start: number; end: number } | null {
  if (typeof value !== "string") return null;
  const match = CLIP_REF.exec(value);
  if (!match) return null;
  return { uploadId: match[1]!, start: Number(match[2]), end: Number(match[3]) };
}

/** The stretch a link or pointer plays (`#t=start,end`), or null when it plays it all. */
export function timeRangeOf(value: unknown): { start: number; end: number } | null {
  if (typeof value !== "string") return null;
  const match = TIME_RANGE.exec(value);
  return match ? { start: Number(match[1]), end: Number(match[2]) } : null;
}

/** A problem with a brand value in plain words, or null when it is fine. */
export function brandProblem(key: BrandKey, value: string): string | null {
  if (isBrandFile(key)) {
    if (readUploadRef(value) || /^https?:\/\/\S+$/.test(value)) return null;
    return "Pick one of your uploads, or paste an address that starts with https://.";
  }
  if (key === "color") {
    return /^[A-Za-z]+$|^#[0-9A-Fa-f]{6}$/.test(value)
      ? null
      : "Use a colour name such as white, or a hex value such as #FFCC00.";
  }
  return /^[A-Za-z0-9 ._-]{1,80}$/.test(value)
    ? null
    : "A font name can hold letters, numbers, spaces, dots, dashes and underscores.";
}
