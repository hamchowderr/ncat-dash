/**
 * Things a team sets once and every automation uses: its logo, colour, font and music.
 * They live in the team's settings. A step that needs one takes it from there, so nobody
 * fills in a logo on every step.
 */
export type BrandKey = "logo" | "color" | "font" | "music";

export type Brand = Partial<Record<BrandKey, string>>;

export const BRAND_KEYS: BrandKey[] = ["logo", "color", "font", "music"];

/** How each one is named in a sentence: "Uses your team's logo." */
export const BRAND_WORDS: Record<BrandKey, string> = {
  logo: "logo",
  color: "brand colour",
  font: "font",
  music: "background music",
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

/** A problem with a brand value in plain words, or null when it is fine. */
export function brandProblem(key: BrandKey, value: string): string | null {
  if (key === "logo" || key === "music") {
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
