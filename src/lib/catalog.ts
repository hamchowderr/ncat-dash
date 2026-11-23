import { getStep, type StepCategory } from "@takewon/step-catalog";

export const CATEGORY_LABELS: Record<StepCategory, string> = {
  video: "Video",
  audio: "Audio",
  media: "Media",
  image: "Image",
  recipe: "Recipes",
  team: "Your team's steps",
  ffmpeg: "Custom edits",
  code: "Code",
  storage: "Storage",
};

export const CATEGORY_ORDER: StepCategory[] = [
  "video",
  "audio",
  "media",
  "image",
  "recipe",
  "team",
  "ffmpeg",
  "code",
  "storage",
];

/**
 * Step pages whose address would otherwise name the tool the toolkit uses underneath. The
 * old address still works and moves to the new one.
 */
const PAGE_NAMES: Record<string, string> = { "ffmpeg-compose": "custom-edit" };

/** The address of a step's own page, such as /steps/custom-edit. */
export function stepHref(stepId: string): string {
  return `/steps/${PAGE_NAMES[stepId] ?? stepId}`;
}

/** The step a page address names, or undefined. */
export function stepIdOfPage(name: string): string | undefined {
  return Object.entries(PAGE_NAMES).find(([, page]) => page === name)?.[0];
}

/** A step's title, or its id when the catalog no longer has it. */
export function stepTitle(stepId: string): string {
  return getStep(stepId)?.title ?? stepId;
}

/** Turns a field name like "video_url" into "Video URL". */
export function fieldLabel(name: string): string {
  return name
    .split("_")
    .map((word, index) =>
      ["url", "id", "srt", "ass", "s3", "gcp", "mp3"].includes(word)
        ? word.toUpperCase()
        : index === 0
          ? word.charAt(0).toUpperCase() + word.slice(1)
          : word,
    )
    .join(" ");
}

export function errorMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { message?: unknown } } | null)?.data;
  return typeof data?.message === "string" ? data.message : fallback;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}
