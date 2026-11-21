/**
 * The content library: every file a team has, each with a short ID people (and the agent)
 * can say out loud, where it came from, its tags, and what was said in it.
 */
import { wordsFromSegments } from "./moments";

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

/** One spoken word of a piece, short names to keep a long transcript small: text, start, end. */
export type PieceWord = { t: string; s: number; e: number };

export type TranscriptPiece = { start: number; end: number; text: string; words?: PieceWord[] };

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
  const clean: (TranscriptSegment & { words?: PieceWord[] })[] = [];
  for (const raw of segments) {
    if (!raw || typeof raw !== "object") continue;
    const { start, end, text } = raw as Record<string, unknown>;
    if (typeof start !== "number" || typeof text !== "string" || !Number.isFinite(start)) continue;
    const words = text.replace(/\s+/g, " ").trim();
    if (!words) continue;
    const finish = typeof end === "number" && Number.isFinite(end) && end >= start ? end : start;
    // A transcript made with word timestamps keeps each word's timing, for captions.
    const timed = wordsFromSegments([raw]).map((word) => ({
      t: word.text,
      s: word.start,
      e: word.end,
    }));
    clean.push({ start, end: finish, text: words, ...(timed.length > 0 ? { words: timed } : {}) });
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
      if (segment.words) current.words = [...(current.words ?? []), ...segment.words];
    } else {
      if (current) pieces.push(current);
      if (pieces.length >= MAX_PIECES) break;
      current = { ...segment, text: segment.text.slice(0, MAX_PIECE_CHARS) };
    }
  }
  if (current && pieces.length < MAX_PIECES) pieces.push(current);
  return pieces.map((piece) => ({
    start: Math.round(piece.start * 100) / 100,
    end: Math.round(piece.end * 100) / 100,
    text: piece.text,
    ...(piece.words ? { words: piece.words } : {}),
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

// Caption files in the library (SRT, WebVTT, ASS) are read into timed lines, the same as a
// transcript, so they show and search the way "What was said" does.

export type CaptionFormat = "srt" | "vtt" | "ass";

const MAX_CAPTION_LINES = 3000;

/** The caption format of a file, from its name or link, or null when it is not one. */
export function captionFileFormat(nameOrLink: string): CaptionFormat | null {
  const path = nameOrLink.split(/[?#]/)[0] ?? "";
  const match = /\.(srt|vtt|ass|ssa)$/i.exec(path);
  if (!match) return null;
  const ext = match[1]!.toLowerCase();
  return ext === "ssa" ? "ass" : (ext as CaptionFormat);
}

/** "00:01:02,500", "01:02.5", "0:01:02.50" → seconds; null when it is not a time. */
function readClock(text: string): number | null {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d+))?$/.exec(text.trim());
  if (!match) return null;
  const [, h, m, s, fraction] = match;
  const whole = Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s);
  return fraction ? whole + Number(`0.${fraction}`) : whole;
}

function cueLines(text: string, format: CaptionFormat): TranscriptSegment[] {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const cues: TranscriptSegment[] = [];
  if (format === "ass") {
    // [Events] Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    let fields = [
      "layer",
      "start",
      "end",
      "style",
      "name",
      "marginl",
      "marginr",
      "marginv",
      "effect",
      "text",
    ];
    for (const line of lines) {
      const format = /^Format:\s*(.*)$/i.exec(line);
      if (format && /text/i.test(format[1]!)) {
        fields = format[1]!.split(",").map((field) => field.trim().toLowerCase());
        continue;
      }
      const dialogue = /^Dialogue:\s*(.*)$/i.exec(line);
      if (!dialogue) continue;
      const parts = dialogue[1]!.split(",");
      const at = (name: string) => fields.indexOf(name);
      const textAt = at("text");
      if (textAt < 0 || parts.length < fields.length) continue;
      const start = readClock(parts[at("start")] ?? "");
      const end = readClock(parts[at("end")] ?? "");
      const words = parts
        .slice(textAt)
        .join(",")
        .replace(/\{[^}]*\}/g, "")
        .replace(/\\[Nn]/g, " ")
        .replace(/\\h/g, " ");
      if (start === null) continue;
      cues.push({ start, end: end ?? start, text: words });
    }
    return cues;
  }
  // SRT and WebVTT: blocks with a "start --> end" line, then the words.
  let current: TranscriptSegment | null = null;
  for (const line of lines) {
    const timing = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/.exec(line);
    if (timing) {
      if (current) cues.push(current);
      const start = readClock(timing[1]!);
      const end = readClock(timing[2]!);
      current = start === null ? null : { start, end: end ?? start, text: "" };
      continue;
    }
    if (!line.trim()) {
      if (current) cues.push(current);
      current = null;
      continue;
    }
    if (current) current.text = `${current.text} ${line.replace(/<[^>]*>/g, "")}`;
  }
  if (current) cues.push(current);
  return cues;
}

/**
 * The timed lines of a caption file, one per cue as it shows on screen, in order. Styling
 * (ASS tags, WebVTT markup) is left out; empty cues are skipped.
 */
export function captionLines(text: string, format: CaptionFormat): TranscriptPiece[] {
  return cueLines(text, format)
    .map((cue) => ({
      ...cue,
      text: cue.text.replace(/\s+/g, " ").trim().slice(0, MAX_PIECE_CHARS),
    }))
    .filter((cue) => cue.text && Number.isFinite(cue.start))
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_CAPTION_LINES)
    .map((cue) => ({
      start: Math.round(cue.start * 100) / 100,
      end: Math.round(Math.max(cue.end, cue.start) * 100) / 100,
      text: cue.text,
    }));
}
