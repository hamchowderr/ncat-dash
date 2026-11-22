/**
 * Subtitle files made from a transcript: SRT and WebVTT, plus a plain text copy.
 *
 * Cues follow the usual subtitle rules: at most two lines of 42 characters, at most six
 * seconds on screen, a new cue after the end of a sentence or a pause. When the transcript
 * has each word's timing the cue starts and ends with its words; without it (an older
 * transcript, a caption file) a long piece is split and its time shared out by length.
 */
import { formatMoment, type PieceWord } from "./library";

export type TimedPiece = { start: number; end: number; text: string; words?: PieceWord[] };
export type Cue = { start: number; end: number; text: string };

const LINE_CHARS = 42;
const CUE_CHARS = LINE_CHARS * 2;
const CUE_SECONDS = 6;
const PAUSE_SECONDS = 1;
const MIN_CUE_SECONDS = 0.5;

const endsSentence = (word: string) => /[.?!…]["')\]]?$/.test(word);
const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Breaks a cue over two lines at the space nearest its middle, when it is too long for one. */
export function wrapCue(text: string): string {
  const flat = clean(text);
  if (flat.length <= LINE_CHARS) return flat;
  const middle = flat.length / 2;
  let best = -1;
  for (let at = flat.indexOf(" "); at !== -1; at = flat.indexOf(" ", at + 1)) {
    if (best === -1 || Math.abs(at - middle) < Math.abs(best - middle)) best = at;
  }
  return best === -1 ? flat : `${flat.slice(0, best)}\n${flat.slice(best + 1)}`;
}

function cuesFromWords(words: PieceWord[]): Cue[] {
  const cues: Cue[] = [];
  let group: PieceWord[] = [];
  const close = () => {
    if (group.length === 0) return;
    cues.push({
      start: group[0]!.s,
      end: group[group.length - 1]!.e,
      text: group.map((word) => word.t).join(" "),
    });
    group = [];
  };
  for (const word of words) {
    const text = clean(word.t);
    if (!text) continue;
    const last = group[group.length - 1];
    if (last) {
      const length = group.reduce((sum, one) => sum + one.t.length + 1, 0) + text.length;
      const tooLong = length > CUE_CHARS;
      const tooSlow = word.e - group[0]!.s > CUE_SECONDS;
      const paused = word.s - last.e > PAUSE_SECONDS;
      const sentence = endsSentence(last.t) && group.length >= 3;
      if (tooLong || tooSlow || paused || sentence) close();
    }
    group.push({ ...word, t: text });
  }
  close();
  return cues;
}

function cuesFromText(piece: TimedPiece): Cue[] {
  const text = clean(piece.text);
  if (!text) return [];
  const length = Math.max(0, piece.end - piece.start);
  if (text.length <= CUE_CHARS && length <= CUE_SECONDS + 1) {
    return [{ start: piece.start, end: piece.end, text }];
  }
  // Split at word boundaries into cues of at most two lines, sharing the time by length.
  const chunks: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const next = current ? `${current} ${word}` : word;
    if (current && (next.length > CUE_CHARS || (endsSentence(current) && current.length > 20))) {
      chunks.push(current);
      current = word;
    } else current = next;
  }
  if (current) chunks.push(current);
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const cues: Cue[] = [];
  let at = piece.start;
  for (const chunk of chunks) {
    const share = total > 0 ? (length * chunk.length) / total : 0;
    cues.push({ start: at, end: at + share, text: chunk });
    at += share;
  }
  return cues;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** The cues of a transcript, in order, never overlapping, each long enough to be read. */
export function captionCues(pieces: TimedPiece[]): Cue[] {
  const cues = [...pieces]
    .sort((a, b) => a.start - b.start)
    .flatMap((piece) =>
      piece.words && piece.words.length > 0 ? cuesFromWords(piece.words) : cuesFromText(piece),
    )
    .filter((cue) => cue.text !== "");
  return cues.map((cue, index) => {
    const next = cues[index + 1];
    let end = Math.max(cue.end, cue.start + MIN_CUE_SECONDS);
    if (next && end > next.start) end = Math.max(next.start, cue.start + 0.05);
    return { start: round3(cue.start), end: round3(end), text: wrapCue(cue.text) };
  });
}

function clock(seconds: number, mark: "," | "."): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, size = 2) => String(n).padStart(size, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${mark}${pad(ms % 1000, 3)}`;
}

/** An SRT file: numbered cues, times with a comma before the milliseconds. */
export function toSrt(cues: Cue[]): string {
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${clock(cue.start, ",")} --> ${clock(cue.end, ",")}\n${cue.text}\n`,
    )
    .join("\n");
}

/** A WebVTT file: the WEBVTT header, then cues with a dot before the milliseconds. */
export function toVtt(cues: Cue[]): string {
  const body = cues
    .map((cue) => `${clock(cue.start, ".")} --> ${clock(cue.end, ".")}\n${cue.text}\n`)
    .join("\n");
  return body ? `WEBVTT\n\n${body}` : "WEBVTT\n";
}

const PARAGRAPH_CHARS = 600;
const PARAGRAPH_PAUSE = 2;

/**
 * The transcript as text to read: paragraphs, each starting with the moment it is said. A
 * new paragraph starts after a long pause or once one grows long.
 */
export function transcriptParagraphs(pieces: TimedPiece[]): { start: number; text: string }[] {
  const paragraphs: { start: number; end: number; text: string }[] = [];
  for (const piece of [...pieces].sort((a, b) => a.start - b.start)) {
    const text = clean(piece.text);
    if (!text) continue;
    const last = paragraphs[paragraphs.length - 1];
    const joins =
      last &&
      piece.start - last.end <= PARAGRAPH_PAUSE &&
      last.text.length + text.length < PARAGRAPH_CHARS;
    if (last && joins) {
      last.text = `${last.text} ${text}`;
      last.end = Math.max(last.end, piece.end);
    } else paragraphs.push({ start: piece.start, end: piece.end, text });
  }
  return paragraphs.map(({ start, text }) => ({ start, text }));
}

/** A plain text copy: each paragraph under its moment, a blank line between them. */
export function toPlainTranscript(pieces: TimedPiece[]): string {
  return transcriptParagraphs(pieces)
    .map((paragraph) => `[${formatMoment(paragraph.start)}] ${paragraph.text}`)
    .join("\n\n")
    .concat(pieces.length > 0 ? "\n" : "");
}

/** A file name for a transcript download: the file's title, made safe, and the format. */
export function transcriptFileName(title: string, format: "srt" | "vtt" | "txt"): string {
  const safe = title
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${safe || "transcript"}.${format}`;
}
