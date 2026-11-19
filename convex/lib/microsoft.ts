// Microsoft 365: what the dashboard reads from OneDrive about Teams meeting recordings,
// and how it checks that a change notice really came for one of its watches. No database
// or network here.

/** One file in OneDrive, as Microsoft Graph lists it. */
export interface DriveItem {
  id?: string;
  name?: string;
  size?: number;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string };
  folder?: unknown;
  video?: { duration?: number };
  deleted?: unknown;
  // Set on a search result for a file in someone else's OneDrive, shared with you.
  remoteItem?: { id?: string; name?: string; parentReference?: { driveId?: string } };
  "@microsoft.graph.downloadUrl"?: string;
}

export interface PickedRecording {
  itemId: string;
  // The OneDrive the file is in, for a recording shared with you; none for your own.
  driveId?: string;
  topic: string;
  startTime: number;
  extension: "mp4";
  contentType: string;
  size: number;
  minutes: number | null;
}

/**
 * Teams names a recording "<meeting>-<yyyymmdd_hhmmss>-Meeting Recording.mp4" (the last
 * words in the organizer's language). The meeting's name is what comes before the stamp.
 */
const STAMP = /-(\d{8})_(\d{6})(?:-[^-]*)?$/;

/** Whether a file is named the way Teams names a meeting recording. */
export function looksLikeTeamsRecording(fileName: string): boolean {
  return /\.mp4$/i.test(fileName) && STAMP.test(fileName.replace(/\.[^.]+$/, ""));
}

/**
 * Where a search result really is, when it is a file in someone else's OneDrive that was
 * shared with you: that OneDrive and the file's id in it. Null for your own files.
 */
export function sharedFileOf(item: DriveItem): { driveId: string; itemId: string } | null {
  const driveId = item.remoteItem?.parentReference?.driveId;
  const itemId = item.remoteItem?.id;
  if (!driveId || !itemId) return null;
  return { driveId, itemId };
}

/** The meeting a recording's file name is for: "Weekly Sync" from Teams' file name. */
export function topicOf(fileName: string): string {
  const bare = fileName.replace(/\.[^.]+$/, "");
  const topic = bare.replace(STAMP, "").trim();
  return topic || bare.trim() || "Teams meeting";
}

/**
 * A Teams meeting recording worth bringing in: a finished video file with something in
 * it. Null for anything else in the folder (notes, pictures, transcripts, other files).
 */
export function pickRecording(
  item: DriveItem,
  now: number,
  driveId?: string,
): PickedRecording | null {
  if (!item.id || !item.name || item.folder || item.deleted) return null;
  const mime = (item.file?.mimeType ?? "").toLowerCase();
  const isVideo = mime === "video/mp4" || (!mime && /\.mp4$/i.test(item.name));
  if (!item.file || !isVideo || !(item.size && item.size > 0)) return null;
  const created = Date.parse(item.createdDateTime ?? "");
  const durationMs = item.video?.duration ?? 0;
  const end = Number.isFinite(created) ? created : now;
  return {
    itemId: item.id,
    ...(driveId ? { driveId } : {}),
    topic: topicOf(item.name),
    // The file is made as the meeting ends, so the meeting started its length before.
    startTime: durationMs > 0 ? end - durationMs : end,
    extension: "mp4",
    contentType: "video/mp4",
    size: item.size,
    minutes: durationMs > 0 ? Math.max(1, Math.round(durationMs / 60_000)) : null,
  };
}

/** Text compared without giving away, by how long it takes, how much of it matched. */
export function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * How long a watch on a OneDrive lasts. Microsoft allows just under 30 days (42,300
 * minutes); a little less is asked for so a slow clock never makes it refuse.
 */
export const WATCH_MS = 42_000 * 60 * 1000;
/** A watch with less than this left is renewed. */
export const RENEW_WATCH_MS = 3 * 24 * 60 * 60 * 1000;
