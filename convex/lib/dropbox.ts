// Dropbox: what the dashboard reads from a Dropbox listing, which files it brings in, how
// it checks that a notice really came from Dropbox, and how files are sent back in
// pieces. No database or network here.

import { PRODUCT_NAME } from "@takewon/automation-core";

/** One entry in a Dropbox folder listing (files/list_folder). */
export interface DropboxEntry {
  ".tag"?: "file" | "folder" | "deleted";
  id?: string;
  name?: string;
  path_lower?: string;
  path_display?: string;
  client_modified?: string;
  server_modified?: string;
  size?: number;
  content_hash?: string;
  is_downloadable?: boolean;
}

export type MediaKind = "video" | "audio" | "image";

/**
 * The files steps can work with, by their ending. Everything else in a watched folder
 * (documents, zips, project files) is left in Dropbox, so Uploads does not fill up with
 * things no step can use.
 */
const MEDIA: Record<string, { kind: MediaKind; contentType: string }> = {
  mp4: { kind: "video", contentType: "video/mp4" },
  m4v: { kind: "video", contentType: "video/x-m4v" },
  mov: { kind: "video", contentType: "video/quicktime" },
  mkv: { kind: "video", contentType: "video/x-matroska" },
  webm: { kind: "video", contentType: "video/webm" },
  avi: { kind: "video", contentType: "video/x-msvideo" },
  mts: { kind: "video", contentType: "video/mp2t" },
  m2ts: { kind: "video", contentType: "video/mp2t" },
  mxf: { kind: "video", contentType: "application/mxf" },
  mp3: { kind: "audio", contentType: "audio/mpeg" },
  wav: { kind: "audio", contentType: "audio/wav" },
  m4a: { kind: "audio", contentType: "audio/mp4" },
  aac: { kind: "audio", contentType: "audio/aac" },
  flac: { kind: "audio", contentType: "audio/flac" },
  ogg: { kind: "audio", contentType: "audio/ogg" },
  opus: { kind: "audio", contentType: "audio/opus" },
  aif: { kind: "audio", contentType: "audio/aiff" },
  aiff: { kind: "audio", contentType: "audio/aiff" },
  jpg: { kind: "image", contentType: "image/jpeg" },
  jpeg: { kind: "image", contentType: "image/jpeg" },
  png: { kind: "image", contentType: "image/png" },
  webp: { kind: "image", contentType: "image/webp" },
  gif: { kind: "image", contentType: "image/gif" },
  heic: { kind: "image", contentType: "image/heic" },
  svg: { kind: "image", contentType: "image/svg+xml" },
};

/** What kind of media a file is by its name, or null when no step can use it. */
export function mediaOf(name: string): { kind: MediaKind; contentType: string } | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return MEDIA[name.slice(dot + 1).toLowerCase()] ?? null;
}

export interface PickedFile {
  fileId: string;
  path: string;
  name: string;
  size: number;
  contentHash: string;
  contentType: string;
  kind: MediaKind;
  modifiedAt: number;
}

/**
 * A Dropbox file worth bringing in: a whole, downloadable video, sound or picture with
 * something in it. Null for folders, deleted files, other kinds of files, and Dropbox's
 * own cloud documents (Paper, Google Docs kept in Dropbox), which cannot be downloaded.
 */
export function pickFile(entry: DropboxEntry): PickedFile | null {
  if (entry[".tag"] !== "file" || !entry.id || !entry.name) return null;
  if (entry.is_downloadable === false || !(entry.size && entry.size > 0)) return null;
  // Dropbox's "Saved for later" and similar leave files that start with a dot.
  if (entry.name.startsWith(".")) return null;
  const media = mediaOf(entry.name);
  if (!media) return null;
  const modified = Date.parse(entry.server_modified ?? entry.client_modified ?? "");
  return {
    fileId: entry.id,
    path: entry.path_display ?? entry.path_lower ?? entry.name,
    name: entry.name,
    size: entry.size,
    contentHash: entry.content_hash ?? "",
    contentType: media.contentType,
    kind: media.kind,
    modifiedAt: Number.isFinite(modified) ? modified : 0,
  };
}

/** Whether a file is inside a folder (or is that folder), compared as Dropbox does. */
export function isInside(folderPath: string, filePath: string): boolean {
  const folder = folderPath.toLowerCase().replace(/\/+$/, "");
  const file = filePath.toLowerCase();
  return folder === "" || file === folder || file.startsWith(`${folder}/`);
}

/**
 * Dropbox's own check on a notice: the body signed with the app's secret, HMAC-SHA256,
 * as lowercase hex in X-Dropbox-Signature.
 */
export async function signatureOf(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signed), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Text compared without giving away, by how long it takes, how much of it matched. */
export function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Dropbox reads a request's settings from the Dropbox-API-Arg header, which must be
 * plain ASCII, so letters outside it (in file names) are written as \uXXXX.
 */
export function apiArg(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * A file up to this size goes to Dropbox in one request; a bigger one in pieces this
 * size, a multiple of 4 MiB as Dropbox asks, small enough to hold in an action.
 */
export const PIECE_BYTES = 8 * 1024 * 1024;
/** Pieces sent by one run of the sending action before it hands over to the next. */
export const PIECES_PER_TURN = 24;

/** The byte range of the next piece of a file `size` bytes long, from `offset`. */
export function nextPiece(offset: number, size: number): { start: number; end: number } | null {
  if (offset >= size) return null;
  return { start: offset, end: Math.min(size, offset + PIECE_BYTES) - 1 };
}

/** A name made safe for a Dropbox folder or file: no slashes or characters it refuses. */
export function dropboxName(name: string, fallback = "Automation"): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .slice(0, 120);
  return cleaned || fallback;
}

/** Where an automation's finished files go in Dropbox when nobody picked a folder. */
export const DEFAULT_SEND_ROOT = `/${PRODUCT_NAME}`;

/** The folder an automation's finished files go to: the chosen one, or the default. */
export function sendFolderOf(chosen: string | undefined, automationName: string): string {
  const root = (chosen ?? "").replace(/\/+$/, "");
  return root ? root : `${DEFAULT_SEND_ROOT}/${dropboxName(automationName)}`;
}
