/**
 * The "Caption video" step, made the fast way. The toolkit's own caption route writes the
 * captions on and then saves the whole video again at FFmpeg's default (slow) setting,
 * which was most of the time a captioned clip took. Instead the step asks the toolkit for
 * the timed words as a caption file (/v1/media/generate/ass, the same transcription, look,
 * word fixes and language), then burns that file in with one quick FFmpeg save
 * (/v1/ffmpeg/compose), the same settings Clips uses.
 *
 * Captions a team typed itself (the classic style) still go to the caption route: it is
 * the only one that takes written text.
 */

type Option = { option: string; argument?: string | number };
const opt = (option: string, argument?: string | number): Option =>
  argument === undefined ? { option } : { option, argument };

/** Whether a caption job can be made the fast way: anything but text the team typed. */
export function burnsInFast(input: Record<string, unknown>): boolean {
  return typeof input.captions !== "string" || input.captions.trim() === "";
}

/** The video a caption job is for. */
export function captionVideoOf(input: Record<string, unknown>): string {
  return typeof input.video_url === "string" ? input.video_url : "";
}

/** The request for the timed words, with the caption job's look, word fixes and language. */
export function wordsRequest(input: Record<string, unknown>): Record<string, unknown> {
  const request: Record<string, unknown> = { media_url: captionVideoOf(input) };
  for (const field of ["settings", "replace", "exclude_time_ranges", "language"]) {
    if (input[field] !== undefined) request[field] = input[field];
  }
  return request;
}

/** The request that burns a caption file into a video in one quick save. */
export function burnRequest(videoUrl: string, captionsUrl: string): Record<string, unknown> {
  return {
    inputs: [{ file_url: videoUrl }],
    filters: [{ filter: `[0:v]ass='${captionsUrl}',setsar=1[v]` }],
    outputs: [
      {
        options: [
          opt("-map", "[v]"),
          opt("-map", "0:a?"),
          opt("-c:v", "libx264"),
          opt("-preset", "veryfast"),
          opt("-crf", 21),
          opt("-pix_fmt", "yuv420p"),
          opt("-c:a", "aac"),
          opt("-b:a", "160k"),
          opt("-movflags", "+faststart"),
          opt("-f", "mp4"),
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------
// Words already known. Every upload is transcribed once (and Best moments keeps the words
// of what it heard), so a caption job for that video, or for a clip cut from it, sends
// those words along and the toolkit does not transcribe the video again.

/** A word as the dashboard keeps it: text, start, end in seconds. */
export interface KnownWord {
  text: string;
  start: number;
  end: number;
}

/** One stretch of speech in the shape the toolkit's caption file request takes. */
export interface CaptionSegment {
  start: number;
  end: number;
  words: { word: string; start: number; end: number }[];
}

// A new stretch starts after a sentence ends or a pause this long, as Whisper's segments
// do, so caption lines break where they would have from a fresh transcription.
const SEGMENT_PAUSE = 1;
const SEGMENT_MAX_SECONDS = 15;
const MAX_SEGMENT_WORDS = 60;

/**
 * The most known words sent with one caption request: about forty-five minutes of talk.
 * A longer video is heard again by the toolkit instead, so the request stays small.
 */
export const MAX_SENT_WORDS = 6000;

/** Groups words into stretches of speech, about a sentence each. */
export function segmentsFromWords(words: KnownWord[]): CaptionSegment[] {
  const segments: CaptionSegment[] = [];
  let current: CaptionSegment | null = null;
  for (const word of words) {
    const text = word.text.trim();
    if (!text || !Number.isFinite(word.start) || !Number.isFinite(word.end)) continue;
    const start = Math.max(0, word.start);
    const end = Math.max(start, word.end);
    const last = current?.words[current.words.length - 1];
    const breaks =
      !current ||
      !last ||
      /[.!?…]["')\]]*$/.test(last.word) ||
      start - last.end >= SEGMENT_PAUSE ||
      end - current.start > SEGMENT_MAX_SECONDS ||
      current.words.length >= MAX_SEGMENT_WORDS;
    if (breaks) {
      if (current) segments.push(current);
      current = { start, end, words: [] };
    }
    current!.words.push({ word: text, start, end });
    current!.end = end;
  }
  if (current) segments.push(current);
  return segments;
}

/**
 * The words said in a clip cut from `start` for `seconds`, timed from the clip's own start.
 * A word cut through at an edge counts when most of it is in the clip.
 */
export function wordsInClip(words: KnownWord[], start: number, seconds: number): KnownWord[] {
  const end = start + seconds;
  const kept: KnownWord[] = [];
  for (const word of words) {
    const middle = (word.start + word.end) / 2;
    if (middle < start || middle > end) continue;
    const from = Math.max(word.start, start) - start;
    const to = Math.min(word.end, end) - start;
    kept.push({ text: word.text, start: round3(from), end: round3(Math.max(from, to)) });
  }
  return kept;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Whether a caption job can use words already known: only when it transcribes in the
 * language it hears. A language set on the step is left to the toolkit, which hears the
 * video again in it.
 */
export function canUseKnownWords(input: Record<string, unknown>): boolean {
  const language = input.language;
  return language === undefined || language === "" || language === "auto";
}

/**
 * The caption file request with the words already known, so the video is not heard
 * again, and with its picture size when known, so it is not downloaded either.
 */
export function withKnownWords(
  request: Record<string, unknown>,
  words: KnownWord[],
  size?: { width?: number; height?: number } | null,
): Record<string, unknown> {
  const withWords: Record<string, unknown> = { ...request, segments: segmentsFromWords(words) };
  delete withWords.language;
  if (size?.width && size.height) {
    withWords.canvas_width = Math.round(size.width);
    withWords.canvas_height = Math.round(size.height);
  }
  return withWords;
}

/** Whether a caption file request carries words already known. */
export function hasKnownWords(request: unknown): boolean {
  return (
    typeof request === "object" &&
    request !== null &&
    Array.isArray((request as Record<string, unknown>).segments)
  );
}

/**
 * The caption file request without the known words, for a toolkit that does not take them
 * (one from before they were added): it hears the video itself, as it always did.
 */
export function withoutKnownWords(request: Record<string, unknown>): Record<string, unknown> {
  const plain = { ...request };
  delete plain.segments;
  delete plain.canvas_width;
  delete plain.canvas_height;
  return plain;
}
