/**
 * Cutting one long video into clips that fit a platform: where to cut, and the FFmpeg
 * request that makes each clip. The behaviour (cut at pauses in speech, a reshaped clip
 * keeps the full picture on a blurred background) follows the Social Clips app.
 *
 * Each platform's limits come from its own published specs; platform-guide.ts holds the
 * full set, with sources, and is what the agent reads.
 */

/** The shape a clip is made in. "original" keeps the video's own shape. */
export type Frame = "9:16" | "4:5" | "1:1" | "16:9" | "original";

/** The picture size each shape is made at. */
export const FRAME_SIZES: Record<Exclude<Frame, "original">, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

/** The picture size a frame is made at, or null when the clip keeps the video's own. */
export function frameSize(frame: Frame | undefined): { width: number; height: number } | null {
  return frame && frame !== "original" ? FRAME_SIZES[frame] : null;
}

/** "Vertical 9:16", "Portrait 4:5", "Square 1:1", "Wide 16:9", "Its own shape". */
export function frameName(frame: Frame): string {
  switch (frame) {
    case "9:16":
      return "Vertical 9:16";
    case "4:5":
      return "Portrait 4:5";
    case "1:1":
      return "Square 1:1";
    case "16:9":
      return "Wide 16:9";
    default:
      return "Its own shape";
  }
}

interface PlatformSpec {
  readonly name: string;
  /** The longest clip the Clips step makes for it. */
  readonly maxSeconds: number;
  /** The shortest video the platform takes, when it has a minimum. */
  readonly minSeconds?: number;
  readonly frame: Frame;
  /** For "original": the largest picture the platform takes; bigger videos are scaled down. */
  readonly box?: { readonly width: number; readonly height: number };
}

export const PLATFORMS = [
  { name: "Instagram Stories", maxSeconds: 60, minSeconds: 3, frame: "9:16" },
  { name: "Instagram Reels", maxSeconds: 180, minSeconds: 3, frame: "9:16" },
  { name: "Instagram feed", maxSeconds: 180, minSeconds: 3, frame: "4:5" },
  { name: "Facebook Stories", maxSeconds: 60, minSeconds: 3, frame: "9:16" },
  { name: "Facebook Reels", maxSeconds: 90, minSeconds: 3, frame: "9:16" },
  { name: "Facebook feed", maxSeconds: 180, minSeconds: 1, frame: "4:5" },
  { name: "TikTok", maxSeconds: 180, frame: "9:16" },
  { name: "YouTube Shorts", maxSeconds: 180, frame: "9:16" },
  { name: "YouTube", maxSeconds: 900, frame: "16:9" },
  { name: "Snapchat Spotlight", maxSeconds: 60, minSeconds: 5, frame: "9:16" },
  { name: "Snapchat Stories", maxSeconds: 60, frame: "9:16" },
  { name: "Threads", maxSeconds: 300, frame: "9:16" },
  { name: "Pinterest", maxSeconds: 900, minSeconds: 4, frame: "9:16" },
  { name: "LinkedIn", maxSeconds: 900, minSeconds: 3, frame: "original" },
  {
    name: "X",
    maxSeconds: 140,
    minSeconds: 0.5,
    frame: "original",
    box: { width: 1280, height: 1024 },
  },
] as const satisfies readonly PlatformSpec[];

export type Platform = (typeof PLATFORMS)[number] & PlatformSpec;
export type PlatformName = (typeof PLATFORMS)[number]["name"];

export function getPlatform(name: unknown): Platform | undefined {
  return (PLATFORMS as readonly Platform[]).find((platform) => platform.name === name);
}

/** Why a video is too short for a platform, or null when it is long enough. */
export function tooShortFor(platform: Platform, duration: number): string | null {
  if (platform.minSeconds === undefined || duration >= platform.minSeconds) return null;
  return `The video is ${round(duration)} s long; ${platform.name} needs at least ${platform.minSeconds} s.`;
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

// A new shape: the whole picture, scaled to fit, over a blurred copy that fills the frame.
function fillFilter({ width, height }: { width: number; height: number }): string {
  return (
    "[0:v]split=2[bg][fg];" +
    `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:5[blurred];` +
    `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[sharp];` +
    "[blurred][sharp]overlay=(W-w)/2:(H-h)/2,setsar=1[v]"
  );
}

// Its own shape, scaled down only when bigger than the platform takes.
function shrinkFilter({ width, height }: { width: number; height: number }): string {
  return `[0:v]scale=w='min(iw,${width})':h='min(ih,${height})':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[v]`;
}

/** The request for the toolkit's /v1/ffmpeg/compose that makes one clip. */
export function clipRequest(
  fileUrl: string,
  clip: Pick<ClipPlan, "start" | "seconds">,
  frame: Frame,
  box?: { width: number; height: number },
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
  const size = frameSize(frame);
  const filter = size ? fillFilter(size) : box ? shrinkFilter(box) : null;
  return {
    // Seeking on the input is fast and, because the clip is re-encoded, exact.
    inputs: [{ file_url: fileUrl, options: [opt("-ss", clip.start), opt("-t", clip.seconds)] }],
    ...(filter ? { filters: [{ filter }] } : {}),
    outputs: [
      {
        options: filter ? [opt("-map", "[v]"), opt("-map", "0:a?"), ...encode] : encode,
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
