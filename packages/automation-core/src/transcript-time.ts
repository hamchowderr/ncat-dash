/**
 * How long a transcript may take before it is given up on, from the video's length.
 *
 * Speech-to-text on a GPU runs many times faster than the video plays, and on an ordinary
 * server's processor about as fast or a little slower. A team's own server can be slower
 * still, or busy with other work, so the limit is generous: three times the video's
 * length, never under half an hour and never over six hours (the limit for every job).
 * Without a limit a 64-minute video on a slow server once ran for four hours before
 * anyone was told.
 */
export const TRANSCRIPT_MIN_MS = 30 * 60 * 1000;
export const TRANSCRIPT_MAX_MS = 6 * 60 * 60 * 1000;
/** Times the video's length a transcript may take. */
export const TRANSCRIPT_TIMES_LENGTH = 3;

/** The longest a transcript of a video this many seconds long may take, in ms. */
export function transcriptLimitMs(durationSeconds: number | null | undefined): number {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return TRANSCRIPT_MAX_MS;
  }
  return Math.min(
    TRANSCRIPT_MAX_MS,
    Math.max(TRANSCRIPT_MIN_MS, durationSeconds * 1000 * TRANSCRIPT_TIMES_LENGTH),
  );
}

/**
 * Whether a transcript running this long is taking longer than usual: longer than the
 * video itself and over ten minutes. The file page says so, before it is given up on.
 */
export function transcriptIsSlow(
  elapsedMs: number,
  durationSeconds: number | null | undefined,
): boolean {
  if (elapsedMs < 10 * 60 * 1000) return false;
  return !durationSeconds || elapsedMs > durationSeconds * 1000;
}

/** A length of time in plain words: "45 min", "1 h 12 min". */
export function spokenSpan(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** What a transcript that was given up on says. */
export function transcriptTooSlowError(
  elapsedMs: number,
  durationSeconds: number | null | undefined,
): string {
  const length = durationSeconds ? ` for a ${spokenSpan(durationSeconds * 1000)} video` : "";
  return `Transcribing took over ${spokenSpan(elapsedMs)}${length}, so it was stopped. The server doing it may be busy or too slow for long videos. Try again when it is less busy.`;
}
