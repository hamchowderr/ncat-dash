/**
 * Project packages: the deliverables a kind of project usually has, so making a project
 * lays out every slot at once and shows what is still missing. Plain data, read by the
 * Convex functions and the screens alike.
 */

export type DeliverableKind = "video" | "short" | "thumbnail" | "audio" | "other";
export type DeliverableStatus = "todo" | "in_progress" | "review" | "approved" | "published";

/** The board's columns, in order. */
export const STATUSES: { status: DeliverableStatus; label: string }[] = [
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "review", label: "In review" },
  { status: "approved", label: "Approved" },
  { status: "published", label: "Published" },
];

export function statusName(status: DeliverableStatus): string {
  return STATUSES.find((entry) => entry.status === status)?.label ?? status;
}

export const KINDS: { kind: DeliverableKind; label: string }[] = [
  { kind: "video", label: "Full video" },
  { kind: "short", label: "Short" },
  { kind: "thumbnail", label: "Thumbnail" },
  { kind: "audio", label: "Audio" },
  { kind: "other", label: "Other" },
];

export type PackageSlot = { kind: DeliverableKind; label: string };

export type ProjectPackage = {
  id: string;
  name: string;
  description: string;
  /** How many shorts it makes when nobody picks a number. Null when it has none. */
  shorts: number | null;
  slots: (shorts: number) => PackageSlot[];
};

/** The most shorts one project lays out, and the most slots it holds in all. */
export const MAX_SHORTS = 30;
export const MAX_SLOTS = 80;

const shortsWithThumbnails = (count: number): PackageSlot[] =>
  Array.from({ length: count }, (_, at) => [
    { kind: "short" as const, label: `Short ${at + 1}` },
    { kind: "thumbnail" as const, label: `Short ${at + 1} thumbnail` },
  ]).flat();

export const PACKAGES: ProjectPackage[] = [
  {
    id: "video_podcast",
    name: "Video podcast",
    description: "An episode with its thumbnail, an audio version, and shorts with thumbnails.",
    shorts: 5,
    slots: (shorts) => [
      { kind: "video", label: "Full episode" },
      { kind: "thumbnail", label: "Episode thumbnail" },
      { kind: "audio", label: "Audio version" },
      ...shortsWithThumbnails(shorts),
    ],
  },
  {
    id: "youtube_video",
    name: "YouTube video",
    description: "A long video with its thumbnail, and shorts cut from it.",
    shorts: 3,
    slots: (shorts) => [
      { kind: "video", label: "Full video" },
      { kind: "thumbnail", label: "Thumbnail" },
      ...Array.from({ length: shorts }, (_, at) => ({
        kind: "short" as const,
        label: `Short ${at + 1}`,
      })),
    ],
  },
  {
    id: "shorts_batch",
    name: "Batch of shorts",
    description: "A set of shorts, each with its own thumbnail.",
    shorts: 10,
    slots: shortsWithThumbnails,
  },
  {
    id: "blank",
    name: "Start empty",
    description: "No slots yet. Add each one yourself.",
    shorts: null,
    slots: () => [],
  },
];

export function packageOf(id: string): ProjectPackage | undefined {
  return PACKAGES.find((entry) => entry.id === id);
}

/** The slots a package lays out, with the number of shorts kept within the limits. */
export function slotsFor(id: string, shorts?: number): PackageSlot[] {
  const found = packageOf(id);
  if (!found) return [];
  const count =
    found.shorts === null
      ? 0
      : Math.max(0, Math.min(MAX_SHORTS, Math.round(shorts ?? found.shorts)));
  return found.slots(count).slice(0, MAX_SLOTS);
}

const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi)(\?|#|$)/i;
const IMAGE = /\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i;
const AUDIO = /\.(mp3|m4a|wav|aac|ogg|flac|opus)(\?|#|$)/i;

/** What a file is, from its address: "video", "image", "audio", or null when unclear. */
export function fileKindOf(url: string): "video" | "image" | "audio" | null {
  if (VIDEO.test(url)) return "video";
  if (IMAGE.test(url)) return "image";
  if (AUDIO.test(url)) return "audio";
  return null;
}

/**
 * Why a file does not belong in a slot, or null when it does. A file whose kind cannot be
 * told from its address is let in.
 */
export function slotProblem(kind: DeliverableKind, url: string): string | null {
  const file = fileKindOf(url);
  if (file === null || kind === "other") return null;
  if ((kind === "video" || kind === "short") && file !== "video") return "This slot takes a video.";
  if (kind === "thumbnail" && file !== "image") return "This slot takes a picture.";
  if (kind === "audio" && file !== "audio") return "This slot takes an audio file.";
  return null;
}
