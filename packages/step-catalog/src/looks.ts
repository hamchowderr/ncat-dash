import { z } from "zod";
import { defineStep, type StepDefinition, StepSetupError } from "./define";

/**
 * # Match A Saved Look
 *
 * A team can copy the look of a video it likes, once (Settings → Looks): the agent reads
 * a sheet of frames from it and the dashboard keeps what it saw as a saved look. This step
 * puts any video into that look with plain FFmpeg, every time, with no AI: the same
 * shape, the same way of filling it, and the same colour.
 *
 * The step's `look` setting is the saved look's name. When a run gets to the step, the
 * dashboard swaps the name for the look itself (as JSON, see `frameLookOf`), so a look
 * changed in Settings is used from the next run on.
 */

export const SAVED_LOOK_STEP = "recipe-saved-look";

export const LOOK_SHAPES = ["vertical", "wide", "square"] as const;
export type LookShape = (typeof LOOK_SHAPES)[number];

export const LOOK_SIZES: Record<LookShape, { width: number; height: number }> = {
  vertical: { width: 1080, height: 1920 },
  wide: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
};

/** How a picture of another shape is fitted: cut to fill, a blurred copy behind, or bars. */
export const LOOK_FILLS = ["crop", "blur", "bars"] as const;
export type LookFill = (typeof LOOK_FILLS)[number];

/** The part of a saved look FFmpeg makes: shape, fill and colour. */
export interface FrameLook {
  shape: LookShape;
  fill: LookFill;
  /** -0.3 (darker) to 0.3 (brighter); 0 leaves it. */
  brightness: number;
  /** 0.6 (flatter) to 1.6 (punchier); 1 leaves it. */
  contrast: number;
  /** 0 (black and white) to 2 (vivid); 1 leaves it. */
  saturation: number;
  /** -1 (cool, blue) to 1 (warm, orange); 0 leaves it. */
  warmth: number;
}

export const NEUTRAL_FRAME: FrameLook = {
  shape: "vertical",
  fill: "crop",
  brightness: 0,
  contrast: 1,
  saturation: 1,
  warmth: 0,
};

const clamp = (value: unknown, low: number, high: number, fallback: number) => {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(high, Math.max(low, number)) * 100) / 100;
};

/**
 * Any value read as a frame look: every number kept in its range and every choice one of
 * its own, so nothing a look holds can change the FFmpeg command beyond its place.
 */
export function frameLookOf(value: unknown): FrameLook {
  const look = (value ?? {}) as Record<string, unknown>;
  return {
    shape: LOOK_SHAPES.includes(look.shape as LookShape)
      ? (look.shape as LookShape)
      : NEUTRAL_FRAME.shape,
    fill: LOOK_FILLS.includes(look.fill as LookFill) ? (look.fill as LookFill) : NEUTRAL_FRAME.fill,
    brightness: clamp(look.brightness, -0.3, 0.3, 0),
    contrast: clamp(look.contrast, 0.6, 1.6, 1),
    saturation: clamp(look.saturation, 0, 2, 1),
    warmth: clamp(look.warmth, -1, 1, 0),
  };
}

/** The colour filters for a look, or nothing when it leaves the colour as it is. */
export function gradeFilter(look: FrameLook): string {
  const parts: string[] = [];
  if (look.brightness !== 0 || look.contrast !== 1 || look.saturation !== 1) {
    parts.push(
      `eq=brightness=${look.brightness}:contrast=${look.contrast}:saturation=${look.saturation}`,
    );
  }
  if (look.warmth !== 0) {
    // Warm pushes the mid-tones toward red and away from blue; cool the other way.
    const shift = Math.round(look.warmth * 0.15 * 1000) / 1000;
    parts.push(`colorbalance=rm=${shift}:bm=${-shift}`);
  }
  return parts.join(",");
}

/** The filter graph that puts a video into a look, ending in [v]. */
export function lookFilter(look: FrameLook): string {
  const { width, height } = LOOK_SIZES[look.shape];
  const size = `${width}:${height}`;
  const grade = gradeFilter(look);
  const finish = `${grade ? `${grade},` : ""}setsar=1,format=yuv420p[v]`;
  if (look.fill === "blur") {
    return `[0:v]split=2[back][front];[back]scale=${size}:force_original_aspect_ratio=increase,crop=${size},boxblur=20:1[blurred];[front]scale=${size}:force_original_aspect_ratio=decrease[fitted];[blurred][fitted]overlay=(W-w)/2:(H-h)/2,${finish}`;
  }
  if (look.fill === "bars") {
    return `[0:v]scale=${size}:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2:color=black,${finish}`;
  }
  return `[0:v]scale=${size}:force_original_aspect_ratio=increase,crop=${size},${finish}`;
}

/** The compose request that puts one video into a look. */
export function lookRequest(videoUrl: string, look: FrameLook): Record<string, unknown> {
  return {
    inputs: [{ file_url: videoUrl }],
    filters: [{ filter: lookFilter(look) }],
    outputs: [
      {
        options: [
          { option: "-map", argument: "[v]" },
          { option: "-map", argument: "0:a?" },
          { option: "-c:v", argument: "libx264" },
          { option: "-crf", argument: 21 },
          { option: "-preset", argument: "veryfast" },
          { option: "-c:a", argument: "aac" },
          { option: "-movflags", argument: "+faststart" },
          { option: "-f", argument: "mp4" },
        ],
      },
    ],
  };
}

/** Frames on one sheet when a video is studied: three across, two down. */
export const SHEET_FRAMES = 6;

/**
 * The compose request for a sheet of six frames spread over a video, the one picture the
 * agent reads to copy its look. `duration` is the video's length in seconds.
 */
export function contactSheetRequest(
  videoUrl: string,
  duration: number,
  vertical: boolean,
): Record<string, unknown> {
  // One frame every sixth of the video, starting a little way in.
  const every = Math.max(0.5, duration / SHEET_FRAMES);
  const width = vertical ? 360 : 640;
  return {
    inputs: [
      { file_url: videoUrl, options: [{ option: "-ss", argument: Math.min(1, duration / 10) }] },
    ],
    filters: [
      { filter: `[0:v]fps=1/${Math.round(every * 100) / 100},scale=${width}:-2,tile=3x2[v]` },
    ],
    outputs: [
      {
        options: [
          { option: "-map", argument: "[v]" },
          { option: "-frames:v", argument: 1 },
          { option: "-f", argument: "image2" },
        ],
      },
    ],
  };
}

export const savedLookStep: StepDefinition = defineStep({
  id: SAVED_LOOK_STEP,
  category: "recipe",
  title: "Match A Saved Look",
  description:
    "Puts the video into one of your saved looks: the same shape, the same way of filling it and the same colour as the video the look was copied from. Plain FFmpeg every time, no AI.",
  endpoint: "/v1/ffmpeg/compose",
  method: "POST",
  output: "files",
  primaryInput: "video_url",
  input: z.object({
    video_url: z.string().url().describe("The video"),
    look: z
      .string()
      .max(4000)
      .default("")
      .describe("Which saved look. Leave blank for the team's first one."),
  }),
  toRequest: (blanks) => {
    const filled = blanks as { video_url: string; look: string };
    let spec: unknown;
    try {
      spec = JSON.parse(filled.look);
    } catch {
      spec = null;
    }
    if (!spec || typeof spec !== "object") {
      throw new StepSetupError(
        filled.look
          ? `There is no saved look called "${filled.look}". Pick one in the step, or save one in Settings → Looks.`
          : "Save a look in Settings → Looks first: copy it from a video you like.",
      );
    }
    return lookRequest(filled.video_url, frameLookOf(spec));
  },
}) as unknown as StepDefinition;
