/**
 * Cut lists for the toolkit's own cutting steps: Trim keeps one part, Cut removes parts,
 * Split makes one clip per part. Each is read from the settings the step ran with.
 */
import type { CutPiece, CutSource, CutTimeline } from "./cuts";
import { fileNameOf } from "./cuts";

/** The catalog steps whose cuts can be opened in an editor. */
export const CUTTING_STEPS = ["video-trim", "video-cut", "video-split"] as const;
export type CuttingStep = (typeof CUTTING_STEPS)[number];

export function isCuttingStep(stepId: unknown): stepId is CuttingStep {
  return CUTTING_STEPS.includes(stepId as CuttingStep);
}

/** Seconds from a time as the toolkit takes it: "00:01:30", "01:30.5", "90" or 90. */
export function parseTime(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !/^\d+(:\d+){0,2}(\.\d+)?$/.test(value.trim())) return null;
  const seconds = value
    .trim()
    .split(":")
    .reduce((total, part) => total * 60 + Number(part), 0);
  return Number.isFinite(seconds) ? seconds : null;
}

type Span = { start?: unknown; end?: unknown };

/** A start and end as a piece inside the recording, or null when it holds nothing. */
function piece(span: Span, duration: number): CutPiece | null {
  const start = span.start === undefined || span.start === "" ? 0 : parseTime(span.start);
  const end = span.end === undefined || span.end === "" ? duration : parseTime(span.end);
  if (start === null || end === null) return null;
  const from = Math.min(start, duration);
  const to = Math.min(end, duration);
  return to > from ? { start: from, seconds: to - from } : null;
}

const spans = (value: unknown): Span[] =>
  Array.isArray(value) ? value.filter((item) => typeof item === "object" && item !== null) : [];

/** What is left of a recording once the given parts are removed. */
export function keptPieces(removed: Span[], duration: number): CutPiece[] {
  const gone = removed
    .map((span) => piece(span, duration))
    .filter((found): found is CutPiece => found !== null)
    .sort((a, b) => a.start - b.start);
  const kept: CutPiece[] = [];
  let at = 0;
  for (const cut of gone) {
    if (cut.start > at) kept.push({ start: at, seconds: cut.start - at });
    at = Math.max(at, cut.start + cut.seconds);
  }
  if (duration > at) kept.push({ start: at, seconds: duration - at });
  return kept;
}

/**
 * The timelines for one job of a cutting step, from the settings it ran with. Empty when
 * the settings hold no usable times.
 */
export function stepTimelines(
  stepId: CuttingStep,
  input: Record<string, unknown>,
  source: CutSource,
): CutTimeline[] {
  const base = fileNameOf(source.url).replace(/\.[^.]+$/, "");
  if (stepId === "video-trim") {
    const kept = piece({ start: input.start, end: input.end }, source.duration);
    return kept ? [{ name: `${base} trimmed`, source, pieces: [kept] }] : [];
  }
  if (stepId === "video-cut") {
    const pieces = keptPieces(spans(input.cuts), source.duration);
    return pieces.length > 0 ? [{ name: `${base} cut`, source, pieces }] : [];
  }
  const parts = spans(input.splits)
    .map((span) => piece(span, source.duration))
    .filter((found): found is CutPiece => found !== null);
  return parts.map((part, index) => ({
    name: `${base} ${index + 1} of ${parts.length}`,
    source,
    pieces: [part],
  }));
}
