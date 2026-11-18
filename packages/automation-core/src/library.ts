/**
 * The content library: every file a team has, each with a short ID people (and the agent)
 * can say out loud, where it came from, its tags, and what was said in it.
 */

export type LibraryKind = "video" | "audio" | "image" | "other";

/**
 * Where a library file came from. Only "upload" and "automation" are made today; the
 * others are for the ways to start that come later (a recording, a link, a voice note).
 */
export type LibrarySource = "upload" | "automation";

/**
 * The letter a short ID starts with: V for a video someone brought in, C for a clip (a
 * video an automation made), A for sound, I for a picture, F for any other file.
 */
export function shortIdLetter(kind: LibraryKind, source: LibrarySource): string {
  if (kind === "video") return source === "automation" ? "C" : "V";
  if (kind === "audio") return "A";
  if (kind === "image") return "I";
  return "F";
}

/**
 * A short ID as someone might type it ("c99", " V12 ", "#C99") in the shape it is kept
 * ("C99"), or null when it is not one.
 */
export function readShortId(text: string): string | null {
  const match = /^\s*#?([vcaif])\s*-?\s*(\d{1,7})\s*$/i.exec(text);
  return match ? `${match[1].toUpperCase()}${Number(match[2])}` : null;
}

export const MAX_TAGS = 30;
export const MAX_TAG_LENGTH = 40;

/** One tag as it is kept: trimmed, single-spaced, lowercase, without a leading "#". */
export function cleanTag(tag: string): string {
  return tag.replace(/^#+/, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
}

/** A file's tags, cleaned, without repeats or blanks, in the order given. */
export function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  for (const tag of tags) {
    const clean = cleanTag(tag);
    if (clean) seen.add(clean);
  }
  return [...seen].slice(0, MAX_TAGS);
}

/**
 * What a search for a file's own words looks through, as one line: its ID, title, tags and
 * where it came from. What was said in it is searched separately, piece by piece.
 */
export function librarySearchText(item: {
  shortId: string;
  title: string;
  tags: string[];
  automationName?: string | null;
}): string {
  return [item.shortId, item.title, ...item.tags, item.automationName ?? ""]
    .filter(Boolean)
    .join(" ");
}

/** A title from a file name: "episode-4_final.mp4" reads "episode 4 final". */
export function titleFromFileName(name: string): string {
  const stem = name.replace(/\.[a-z0-9]{1,5}$/i, "");
  const spaced = stem.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (spaced || name).slice(0, 200);
}

export type TranscriptSegment = { start: number; end: number; text: string };

export type TranscriptPiece = { start: number; end: number; text: string };

// A piece of a transcript is one of Whisper's segments, about a sentence, so a search lands
// on the sentence it was said in. Fragments of a word or two ("Okay.", "So,") join the
// next segment, so a piece always reads as something someone said.
const MIN_PIECE_WORDS = 4;
const PIECE_SECONDS = 30;
const MAX_PIECE_CHARS = 1200;
const MAX_PIECES = 3000;

/**
 * Reads the segments the toolkit's transcribe returns (Whisper's shape: start, end, text,
 * plus fields nobody here needs) and groups them into pieces of about thirty seconds.
 * Anything that is not a segment is skipped.
 */
export function transcriptPieces(segments: unknown): TranscriptPiece[] {
  if (!Array.isArray(segments)) return [];
  const clean: TranscriptSegment[] = [];
  for (const raw of segments) {
    if (!raw || typeof raw !== "object") continue;
    const { start, end, text } = raw as Record<string, unknown>;
    if (typeof start !== "number" || typeof text !== "string" || !Number.isFinite(start)) continue;
    const words = text.replace(/\s+/g, " ").trim();
    if (!words) continue;
    const finish = typeof end === "number" && Number.isFinite(end) && end >= start ? end : start;
    clean.push({ start, end: finish, text: words });
  }
  clean.sort((a, b) => a.start - b.start);

  const pieces: TranscriptPiece[] = [];
  let current: TranscriptPiece | null = null;
  for (const segment of clean) {
    const fits =
      current &&
      current.text.split(" ").length < MIN_PIECE_WORDS &&
      segment.end - current.start <= PIECE_SECONDS &&
      current.text.length + segment.text.length + 1 <= MAX_PIECE_CHARS;
    if (current && fits) {
      current.text = `${current.text} ${segment.text}`;
      current.end = Math.max(current.end, segment.end);
    } else {
      if (current) pieces.push(current);
      if (pieces.length >= MAX_PIECES) return pieces;
      current = { ...segment, text: segment.text.slice(0, MAX_PIECE_CHARS) };
    }
  }
  if (current && pieces.length < MAX_PIECES) pieces.push(current);
  return pieces.map((piece) => ({
    start: Math.round(piece.start * 100) / 100,
    end: Math.round(piece.end * 100) / 100,
    text: piece.text,
  }));
}

/**
 * The words of a piece around the first place a search matched, for a results list: about
 * `width` characters, cut at word edges, with "…" where text was left out.
 */
export function snippetAround(text: string, search: string, width = 160): string {
  if (text.length <= width) return text;
  const words = search
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 1);
  const lower = text.toLowerCase();
  const at = words
    .map((word) => lower.indexOf(word))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const centre = at ?? 0;
  let from = Math.max(0, centre - Math.floor(width / 3));
  let to = Math.min(text.length, from + width);
  from = Math.max(0, to - width);
  if (from > 0) {
    const space = text.indexOf(" ", from);
    if (space >= 0 && space < centre) from = space + 1;
  }
  if (to < text.length) {
    const space = text.lastIndexOf(" ", to);
    if (space > from) to = space;
  }
  return `${from > 0 ? "…" : ""}${text.slice(from, to)}${to < text.length ? "…" : ""}`;
}

/** "0:42", "12:31", "1:02:05": a moment in a video, as a player shows it. */
export function formatMoment(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
