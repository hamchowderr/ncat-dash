// Zoom: what the dashboard reads from Zoom's events and recording lists, and how it
// checks that an event really came from Zoom. No database or network here.

/** One file of a Zoom cloud recording, as Zoom lists it. */
export interface ZoomRecordingFile {
  id?: string;
  file_type?: string;
  file_extension?: string;
  file_size?: number;
  download_url?: string;
  recording_type?: string;
  status?: string;
}

/** One recorded meeting, as Zoom lists it. */
export interface ZoomMeeting {
  uuid?: string;
  id?: number | string;
  host_id?: string;
  topic?: string;
  start_time?: string;
  duration?: number;
  recording_files?: ZoomRecordingFile[];
}

/**
 * The video kinds Zoom makes, best first for making clips: the shared screen with the
 * speaker in a corner shows the most, then the speaker alone, then the gallery.
 */
const VIDEO_ORDER = [
  "shared_screen_with_speaker_view",
  "shared_screen_with_speaker_view(CC)",
  "speaker_view",
  "active_speaker",
  "shared_screen_with_gallery_view",
  "gallery_view",
  "shared_screen",
];

export interface PickedFile {
  id: string;
  downloadUrl: string;
  extension: "mp4" | "m4a";
  contentType: string;
  size: number;
}

/**
 * The one file of a meeting worth bringing in: its best finished video, or the sound
 * alone when Zoom kept no video. Null when nothing finished can be used.
 */
export function pickRecordingFile(files: ZoomRecordingFile[] | undefined): PickedFile | null {
  const usable = (files ?? []).filter(
    (file) =>
      file.id &&
      file.download_url &&
      (file.status === undefined || file.status === "completed") &&
      (file.file_size ?? 1) > 0,
  );
  const rank = (file: ZoomRecordingFile) => {
    const at = VIDEO_ORDER.indexOf(file.recording_type ?? "");
    return at === -1 ? VIDEO_ORDER.length : at;
  };
  const videos = usable
    .filter((file) => (file.file_type ?? "").toUpperCase() === "MP4")
    .sort((a, b) => rank(a) - rank(b));
  const video = videos[0];
  if (video) {
    return {
      id: video.id!,
      downloadUrl: video.download_url!,
      extension: "mp4",
      contentType: "video/mp4",
      size: video.file_size ?? 0,
    };
  }
  const sound = usable.find((file) => (file.file_type ?? "").toUpperCase() === "M4A");
  if (sound) {
    return {
      id: sound.id!,
      downloadUrl: sound.download_url!,
      extension: "m4a",
      contentType: "audio/mp4",
      size: sound.file_size ?? 0,
    };
  }
  return null;
}

/** "Weekly Sync 2026-11-18.mp4": the meeting's topic and the day it started. */
export function recordingFileName(topic: string, startTime: number, extension: string): string {
  const name =
    topic
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Zoom meeting";
  const day = Number.isFinite(startTime) ? new Date(startTime).toISOString().slice(0, 10) : "";
  return `${name}${day ? ` ${day}` : ""}.${extension}`;
}

/** Zoom sends a meeting's start as ISO text. Unreadable text gives "now". */
export function startOf(meeting: ZoomMeeting, now: number): number {
  const at = Date.parse(meeting.start_time ?? "");
  return Number.isFinite(at) ? at : now;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** HMAC-SHA256 of the message under the key, as hex: Zoom's way of signing. */
export async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message)));
}

/** An event older than this is refused, so a copied one cannot be sent again later. */
export const EVENT_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Whether an event came from Zoom: `x-zm-signature` must be "v0=" and the HMAC of
 * "v0:<x-zm-request-timestamp>:<body>" under the app's secret token, and recent.
 */
export async function isFromZoom(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
  now: number,
): Promise<boolean> {
  if (!secret || !timestamp || !signature) return false;
  const stamp = Number(timestamp);
  if (!Number.isFinite(stamp)) return false;
  // Zoom sends seconds; take milliseconds too.
  const at = stamp > 1e12 ? stamp : stamp * 1000;
  if (Math.abs(now - at) > EVENT_MAX_AGE_MS) return false;
  const expected = `v0=${await hmacHex(secret, `v0:${timestamp}:${body}`)}`;
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
