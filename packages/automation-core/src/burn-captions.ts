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
