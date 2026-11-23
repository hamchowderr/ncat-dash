import { STARTERS } from "@takewon/automation-core";

/** A video the speed test runs through ready-mades. Always the same file, so runs compare. */
export interface Clip {
  id: string;
  name: string;
  url: string;
  seconds: number;
  shape: "vertical" | "wide";
}

/** One run of the test: a ready-made on a video. */
export interface PlanItem {
  clip: Clip;
  readyMadeId: string;
  readyMadeName: string;
}

const CLIPS_AT = "https://pub-3d40216e6b8248f8ae21488b053c3285.r2.dev/speed-test/clips";

/**
 * The videos the test uses by default: cut from NASA's public-domain interview with
 * astronaut Jeanette Epps (October 2019), one person talking to camera with questions off
 * camera, re-encoded at 30 fps like a phone or camera file.
 * - 40 s vertical: the length the site demo and the encode audit were timed on.
 * - 81 s wide: the length of Buffer's July 2026 test of Vyra (about 20 minutes).
 * - 8 min wide: a long video, for clips cut from a whole talk.
 */
export const DEFAULT_CLIPS: Clip[] = [
  {
    id: "talking-head-40s-vertical",
    name: "40 s vertical talking head",
    url: `${CLIPS_AT}/talking-head-40s-vertical.mp4`,
    seconds: 40,
    shape: "vertical",
  },
  {
    id: "talking-head-81s-wide",
    name: "81 s wide talking head",
    url: `${CLIPS_AT}/talking-head-81s-wide.mp4`,
    seconds: 81,
    shape: "wide",
  },
  {
    id: "interview-8min-wide",
    name: "8 min wide interview",
    url: `${CLIPS_AT}/interview-8min-wide.mp4`,
    seconds: 480,
    shape: "wide",
  },
];

/**
 * Which ready-mades each video goes through. The main ones people switch on first, and
 * none that pays an AI model for every video, so a test run costs nothing but toolkit time.
 */
export const DEFAULT_PLAN: Record<string, string[]> = {
  "talking-head-40s-vertical": ["caption-uploads", "clean-up-recording", "social-clips"],
  "talking-head-81s-wide": [
    "caption-uploads",
    "vertical-blur-captions",
    "follow-speaker-vertical",
    "clean-up-recording",
    "social-clips",
  ],
  "interview-8min-wide": ["social-clips", "clips-follow-speaker", "clean-up-recording"],
};

export interface PlanOptions {
  clips?: Clip[];
  plan?: Record<string, string[]>;
  /** Only these videos, by id. */
  onlyClips?: string[];
  /** Only these ready-mades, by id. */
  onlyReadyMades?: string[];
}

/** The runs to make, one after another, shortest video first. */
export function planRuns(options: PlanOptions = {}): PlanItem[] {
  const clips = options.clips ?? DEFAULT_CLIPS;
  const plan = options.plan ?? DEFAULT_PLAN;
  for (const id of options.onlyClips ?? []) {
    if (!clips.some((clip) => clip.id === id)) {
      throw new Error(`There is no video "${id}". Videos: ${clips.map((c) => c.id).join(", ")}.`);
    }
  }
  const items: PlanItem[] = [];
  for (const clip of [...clips].sort((a, b) => a.seconds - b.seconds)) {
    if (options.onlyClips?.length && !options.onlyClips.includes(clip.id)) continue;
    for (const readyMadeId of plan[clip.id] ?? []) {
      if (options.onlyReadyMades?.length && !options.onlyReadyMades.includes(readyMadeId)) {
        continue;
      }
      const starter = STARTERS.find((candidate) => candidate.id === readyMadeId);
      if (!starter) throw new Error(`There is no ready-made "${readyMadeId}".`);
      items.push({ clip, readyMadeId, readyMadeName: starter.name });
    }
  }
  return items;
}

/**
 * How long one run may take before the test stops it and calls it too slow: a quarter of
 * an hour, plus eight times the video's length.
 */
export function timeLimitMs(clip: Clip): number {
  return (15 * 60 + clip.seconds * 8) * 1000;
}

/** The name of the automation the test keeps for a ready-made on its team. */
export function automationName(readyMadeName: string): string {
  return `Speed Test: ${readyMadeName}`;
}
