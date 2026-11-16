/**
 * Cutting one long video into clips that fit a platform: where to cut, and the FFmpeg
 * request that makes each clip. The platform list and the behaviour (cut at pauses in
 * speech, vertical clips keep the full frame on a blurred background) follow the
 * Social Clips app.
 */

export const PLATFORMS = [
  { name: "Instagram Stories", maxSeconds: 60, frame: "9:16" },
  { name: "Instagram Reels", maxSeconds: 180, frame: "9:16" },
  { name: "Facebook Stories", maxSeconds: 60, frame: "9:16" },
  { name: "Facebook Reels", maxSeconds: 90, frame: "9:16" },
  { name: "TikTok", maxSeconds: 180, frame: "9:16" },
  { name: "YouTube Shorts", maxSeconds: 180, frame: "9:16" },
  { name: "Snapchat Spotlight", maxSeconds: 60, frame: "9:16" },
  { name: "Snapchat Stories", maxSeconds: 60, frame: "9:16" },
  { name: "Threads", maxSeconds: 300, frame: "9:16" },
  { name: "Pinterest", maxSeconds: 900, frame: "9:16" },
  { name: "LinkedIn", maxSeconds: 900, frame: "original" },
  { name: "X", maxSeconds: 140, frame: "original" },
] as const;

export type Platform = (typeof PLATFORMS)[number];
export type PlatformName = Platform["name"];
export type Frame = Platform["frame"];

export function getPlatform(name: unknown): Platform | undefined {
  return PLATFORMS.find((platform) => platform.name === name);
}

/** "60 s", "3 min", "2 min 20 s". */
export function formatLimit(seconds: number): string {
  if (seconds < 120) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

export interface Silence {
  start: number;
  end: number;
}

export interface ClipPlan {
  part: number;
  parts: number;
  /** Second of the source video the clip starts at. */
  start: number;
  seconds: number;
}

// The most clips one video is cut into, so a mistake cannot queue thousands of jobs.
export const MAX_CLIPS = 100;
// A leftover shorter than this is not worth a clip of its own.
const MIN_TAIL_SECONDS = 1;

const round = (value: number) => Math.round(value * 100) / 100;

/** The video's length in seconds from the toolkit's metadata result, or null. */
export function durationOf(result: unknown): number | null {
  const duration = Number((result as { duration?: unknown } | null)?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

/** The pauses from the toolkit's silence result. Anything unreadable counts as none. */
export function parseSilences(result: unknown): Silence[] {
  if (!Array.isArray(result)) return [];
  return result
    .map((item) => ({
      start: Number((item as { start?: unknown })?.start),
      end: Number((item as { end?: unknown })?.end),
    }))
    .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a.start - b.start);
}

/**
 * Where to cut a video so every clip fits `maxSeconds`. It makes the fewest clips that
 * can fit, aims for clips of even length, and moves each cut to the middle of the
 * nearest pause in speech when one is within reach. No clip is ever over the limit.
 */
export function planClips(duration: number, silences: Silence[], maxSeconds: number): ClipPlan[] {
  if (!(duration > 0) || !(maxSeconds > 0)) return [];
  const parts = Math.min(MAX_CLIPS, Math.ceil(duration / maxSeconds - 1e-9));
  const pauses = silences.map(({ start, end }) => (start + end) / 2);

  const cuts: number[] = [0];
  for (let left = parts; left > 1; left--) {
    const from = cuts[cuts.length - 1];
    const ideal = from + (duration - from) / left;
    // Late enough that the clips still to come can hold the rest; never past the limit.
    const earliest = Math.max(from + MIN_TAIL_SECONDS, duration - (left - 1) * maxSeconds);
    const latest = Math.min(from + maxSeconds, duration - MIN_TAIL_SECONDS);
    const reachable = pauses.filter((at) => at >= earliest && at <= latest);
    const cut = reachable.length
      ? reachable.reduce((best, at) => (Math.abs(at - ideal) < Math.abs(best - ideal) ? at : best))
      : Math.min(Math.max(ideal, earliest), latest);
    cuts.push(cut);
  }
  cuts.push(duration);

  const plan: ClipPlan[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = round(cuts[i]);
    // Rounding down keeps a clip that is exactly at the limit from tipping over it.
    const seconds = Math.min(maxSeconds, Math.floor((cuts[i + 1] - cuts[i]) * 100) / 100);
    if (seconds > 0) plan.push({ part: plan.length + 1, parts: 0, start, seconds });
  }
  return plan.map((clip) => ({ ...clip, parts: plan.length }));
}

type Option = { option: string; argument?: string | number };
const opt = (option: string, argument?: string | number): Option =>
  argument === undefined ? { option } : { option, argument };

// Vertical: the whole picture, scaled to fit, over a blurred copy that fills the frame.
const VERTICAL =
  "[0:v]split=2[bg][fg];" +
  "[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:5[blurred];" +
  "[fg]scale=1080:1920:force_original_aspect_ratio=decrease[sharp];" +
  "[blurred][sharp]overlay=(W-w)/2:(H-h)/2,setsar=1[v]";

/** The request for the toolkit's /v1/ffmpeg/compose that makes one clip. */
export function clipRequest(
  fileUrl: string,
  clip: Pick<ClipPlan, "start" | "seconds">,
  frame: Frame,
): Record<string, unknown> {
  const encode = [
    opt("-c:v", "libx264"),
    opt("-preset", "veryfast"),
    opt("-crf", 21),
    opt("-pix_fmt", "yuv420p"),
    opt("-c:a", "aac"),
    opt("-b:a", "160k"),
    opt("-movflags", "+faststart"),
    opt("-f", "mp4"),
  ];
  return {
    // Seeking on the input is fast and, because the clip is re-encoded, exact.
    inputs: [{ file_url: fileUrl, options: [opt("-ss", clip.start), opt("-t", clip.seconds)] }],
    ...(frame === "9:16" ? { filters: [{ filter: VERTICAL }] } : {}),
    outputs: [
      {
        options: frame === "9:16" ? [opt("-map", "[v]"), opt("-map", "0:a?"), ...encode] : encode,
      },
    ],
  };
}

/** Caption look for clips: big, upper case, the word being spoken highlighted. */
export const CLIP_CAPTION_SETTINGS = {
  style: "highlight",
  all_caps: true,
  bold: true,
  max_words_per_line: 4,
  position: "bottom_center",
  line_color: "#FFFFFF",
  word_color: "#F2B33D",
  outline_color: "#000000",
  outline_width: 3,
} as const;
