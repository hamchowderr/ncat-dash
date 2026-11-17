/**
 * The few things worth reading from a toolkit result, as label and value: how long a video
 * is, what a transcript says. Files are left out (they show as files), and so are ids and
 * anything nested, so a person never meets raw data.
 */

export type Fact = { label: string; value: string };

const MAX_FACTS = 6;
const MAX_TEXT = 280;
const URL_LIKE = /^(https?|s3|gs):\/\//i;
// Bookkeeping the toolkit adds, which means nothing to the person reading the run.
const SKIPPED =
  /(^|_)(id|ids|url|urls|key|token|code|pid|queue|build|number|webhook)$|^build|^queue/i;
const SHOUTED = new Set(["url", "id", "srt", "ass", "fps", "mp3", "mp4", "s3"]);

/** "frame_rate" → "Frame rate", "srt_file" → "SRT file". */
export function factLabel(key: string): string {
  const words = key
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  return words
    .map((word, index) =>
      SHOUTED.has(word)
        ? word.toUpperCase()
        : index === 0
          ? word.charAt(0).toUpperCase() + word.slice(1)
          : word,
    )
    .join(" ");
}

function shown(value: unknown): string | null {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Number.isInteger(value)
      ? value.toLocaleString("en-US")
      : String(Math.round(value * 100) / 100);
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || URL_LIKE.test(text)) return null;
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1).trimEnd()}…` : text;
}

/** The readable facts in one result, or none when the result is a file or a list of them. */
export function factsOf(result: unknown): Fact[] {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return [];
  const facts: Fact[] = [];
  for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
    if (SKIPPED.test(key)) continue;
    const text = shown(value);
    if (text === null) continue;
    facts.push({ label: factLabel(key), value: text });
    if (facts.length === MAX_FACTS) break;
  }
  return facts;
}
