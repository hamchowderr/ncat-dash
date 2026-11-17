/**
 * SRT captions. Every editor here, CapCut included, imports them as editable text. When a
 * recording is cut, its captions are moved to where their words now sit on the timeline.
 */
import type { CutPiece } from "./cuts";

export interface Cue {
  /** Seconds. */
  start: number;
  end: number;
  text: string;
}

const stamp = (seconds: number) => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

const STAMP = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/;
const seconds = (match: RegExpMatchArray) =>
  Number(match[1]) * 3600 +
  Number(match[2]) * 60 +
  Number(match[3]) +
  Number(match[4].padEnd(3, "0")) / 1000;

/** The cues in an SRT file. Blocks that cannot be read are skipped. */
export function parseSrt(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text
    .replace(/^﻿/, "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    const at = lines.findIndex((line) => line.includes("-->"));
    if (at < 0) continue;
    const [from, to] = lines[at].split("-->");
    const start = from.match(STAMP);
    const end = to?.match(STAMP);
    const words = lines.slice(at + 1).join("\n");
    if (!start || !end || !words) continue;
    cues.push({ start: seconds(start), end: seconds(end), text: words });
  }
  return cues;
}

export function formatSrt(cues: Cue[]): string {
  return cues
    .map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`)
    .join("\n");
}

/**
 * A recording's captions as they fall on a timeline of its pieces. A cue that crosses a
 * cut keeps the part still on screen; one that was cut away entirely is dropped.
 */
export function cutCues(cues: Cue[], pieces: CutPiece[]): Cue[] {
  const moved: Cue[] = [];
  let at = 0;
  for (const piece of pieces) {
    const pieceEnd = piece.start + piece.seconds;
    for (const cue of cues) {
      const start = Math.max(cue.start, piece.start);
      const end = Math.min(cue.end, pieceEnd);
      if (end - start < 0.05) continue;
      moved.push({ start: at + start - piece.start, end: at + end - piece.start, text: cue.text });
    }
    at += piece.seconds;
  }
  return moved;
}
