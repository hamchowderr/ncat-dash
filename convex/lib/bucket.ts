import { teamFolder } from "@takewon/automation-core";
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { decryptSecret } from "./crypto";

/**
 * The team's bucket, reached through its toolkit. The toolkit (Chowderr's fork) signs
 * links and lists files with its own S3_* settings, so the storage keys never reach this
 * app; signed links go straight to the bucket, so file bytes never pass through either.
 *
 * One toolkit can serve many teams (the hosted toolkit does), so a team only ever works
 * inside its own folder, `root`. Every key passed to and returned from the helpers below
 * is written from inside that folder: "" is the top of the team's storage. Nothing here
 * can reach a key outside it.
 */
export interface Bucket {
  baseUrl: string;
  apiKey: string;
  /** The bucket's name, as the toolkit reports it. */
  bucket: string;
  /** The team's folder in the bucket, "teams/<id>/". */
  root: string;
}

/** A file name made safe to use in a key: letters, digits, dots, dashes, underscores. */
export function safeName(fileName: string): string {
  const cleaned = fileName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "");
  return cleaned.slice(-120) || "file";
}

/** The key in the bucket for a key inside the team's folder. */
function inBucket(bucket: Bucket, key: string): string {
  return `${bucket.root}${key}`;
}

/** The key inside the team's folder for a key in the bucket, or null when it is outside. */
function inTeam(bucket: Bucket, key: string): string | null {
  return key.startsWith(bucket.root) ? key.slice(bucket.root.length) : null;
}

export interface BucketObject {
  key: string;
  etag: string;
  size: number;
  lastModified: number;
}

/** What a toolkit says about its bucket, kept with the connection. */
export interface StorageInfo {
  bucket: string;
  endpoint: string | null;
  publicUrl: string | null;
}

export type StorageCheck =
  ({ ok: true } & StorageInfo) | { ok: false; reason: "not_fork" | "storage"; detail: string };

/** Shown when a toolkit does not know the storage requests: it is Stephen's original. */
export const NOT_FORK_DETAIL =
  "This toolkit is the original NCA Toolkit. The dashboard needs the Otaku Solutions version " +
  "(github.com/hamchowderr/no-code-architects-toolkit), which adds the storage it uses.";

export class BucketError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const TOOLKIT_UNREACHABLE =
  "Your toolkit can't be reached right now. Check that it is running, then try again.";

/**
 * What a toolkit's answer means, in plain words. A proxy in front of a toolkit that is down
 * answers 502, 503 or 504; people are told the toolkit can't be reached, not a status number.
 */
export function plainStatus(status: number): string {
  if (status === 0 || status === 502 || status === 503 || status === 504)
    return TOOLKIT_UNREACHABLE;
  if (status === 401 || status === 403) {
    return "The toolkit did not accept the API key. Check it in Settings.";
  }
  if (status >= 500) return "The toolkit ran into a problem of its own. Try again in a moment.";
  return `The toolkit answered ${status}.`;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function ask<T>(
  target: { baseUrl: string; apiKey: string },
  request: string,
  body: Record<string, unknown>,
  timeoutMs = 20_000,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(joinUrl(target.baseUrl, `/v1/storage/${request}`), {
      method: "POST",
      headers: { "X-API-Key": target.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new BucketError(TOOLKIT_UNREACHABLE, 0);
  }
  let json: { response?: T; message?: unknown } | null = null;
  try {
    json = (await res.json()) as { response?: T; message?: unknown };
  } catch {
    json = null;
  }
  if (!res.ok || !json || json.response === undefined || json.response === null) {
    const said = typeof json?.message === "string" && json.message ? json.message : null;
    // A toolkit that answers in its own words is up, and says what is wrong; anything else
    // (a proxy's error page in front of a stopped toolkit) is said in plain words.
    throw new BucketError(said ?? plainStatus(res.status), res.status);
  }
  return json.response;
}

/**
 * Asks a toolkit about its bucket. Stephen's original toolkit has no storage requests and
 * answers 404, which is how it is told apart from the fork.
 */
export async function checkStorage(target: {
  baseUrl: string;
  apiKey: string;
}): Promise<StorageCheck> {
  try {
    const info = await ask<{ bucket?: unknown; endpoint?: unknown; public_url?: unknown }>(
      target,
      "info",
      {},
      15_000,
    );
    if (typeof info.bucket !== "string" || !info.bucket) {
      return { ok: false, reason: "storage", detail: "The toolkit did not name its bucket." };
    }
    return {
      ok: true,
      bucket: info.bucket,
      endpoint: typeof info.endpoint === "string" && info.endpoint ? info.endpoint : null,
      publicUrl: typeof info.public_url === "string" && info.public_url ? info.public_url : null,
    };
  } catch (error) {
    if (error instanceof BucketError && (error.status === 404 || error.status === 405)) {
      return { ok: false, reason: "not_fork", detail: NOT_FORK_DETAIL };
    }
    const detail = error instanceof Error ? error.message : "The toolkit's storage did not answer.";
    return {
      ok: false,
      reason: "storage",
      detail: `The toolkit's storage is not working: ${detail}`,
    };
  }
}

/** The team's toolkit connection that storage goes through: a working one first. */
export async function storageConnection(
  ctx: Pick<QueryCtx, "db">,
  organizationId: string,
): Promise<Doc<"toolkitConnections"> | null> {
  const connections = await ctx.db
    .query("toolkitConnections")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(10);
  const withStorage = connections.filter((one) => one.storage);
  return withStorage.find((one) => one.status === "ok") ?? withStorage[0] ?? null;
}

export async function bucketOf(connection: Doc<"toolkitConnections">): Promise<Bucket> {
  return {
    baseUrl: connection.baseUrl,
    apiKey: await decryptSecret(connection.apiKeyCipher),
    bucket: connection.storage?.bucket ?? "",
    root: teamFolder(connection.organizationId),
  };
}

/** Which storage a file was left on when the team switched servers (schema storedOn). */
export interface StoredOn {
  hosted: boolean;
  bucket: string;
  endpoint: string | null;
}

/** Whether a file left on `on` is on this storage after all. */
export function sameStorage(
  on: StoredOn,
  storage: { bucket: string; endpoint: string | null } | undefined,
): boolean {
  return !!storage && storage.bucket === on.bucket && storage.endpoint === on.endpoint;
}

/** Said when a file is on a storage the team no longer has a way into. */
export const LEFT_BEHIND_MESSAGE =
  "This file is on the storage the team used before it switched servers, which can no longer be reached. Upload it again to use it.";

/**
 * The bucket a team's file is in. Usually the team's own storage now; a file left on the
 * hosted storage after the team moved to its own server is read from there with the
 * operator's server (still the team's own folder). A file left on another earlier storage
 * cannot be reached, and says so.
 */
export async function bucketForFile(
  connection: Doc<"toolkitConnections">,
  file: { storedOn?: StoredOn },
): Promise<Bucket> {
  const on = file.storedOn;
  if (!on || sameStorage(on, connection.storage)) return await bucketOf(connection);
  const baseUrl = process.env.HOSTED_TOOLKIT_URL?.trim();
  const apiKey = process.env.HOSTED_TOOLKIT_API_KEY?.trim();
  if (on.hosted && baseUrl && apiKey) {
    return { baseUrl, apiKey, bucket: on.bucket, root: teamFolder(connection.organizationId) };
  }
  throw new ConvexError({ code: "left_behind", message: LEFT_BEHIND_MESSAGE });
}

/** A link that lets its holder PUT or GET one file for a limited time. */
export async function presign(
  bucket: Bucket,
  method: "PUT" | "GET",
  key: string,
  expiresInSeconds: number,
  // Makes a GET link download the file under this name instead of opening it.
  options: { downloadName?: string } = {},
): Promise<string> {
  const answer = await ask<{ url: string }>(bucket, "sign", {
    key: inBucket(bucket, key),
    method,
    expires_in: expiresInSeconds,
    ...(options.downloadName ? { download_name: options.downloadName } : {}),
  });
  return answer.url;
}

interface Page {
  files: { key: string; etag: string; size: number; last_modified: number }[];
  folders: string[];
  next_token: string | null;
}

function objectsOf(bucket: Bucket, page: Page): BucketObject[] {
  return page.files.flatMap((file) => {
    const key = inTeam(bucket, file.key);
    return key === null
      ? []
      : [{ key, etag: file.etag, size: file.size, lastModified: file.last_modified }];
  });
}

/** Lists what is under a prefix, up to `maxPages` thousand objects. Throws if refused. */
export async function listObjects(
  bucket: Bucket,
  prefix: string,
  maxPages = 5,
): Promise<BucketObject[]> {
  const found: BucketObject[] = [];
  let token: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const answer: Page = await ask<Page>(bucket, "list", {
      prefix: inBucket(bucket, prefix),
      ...(token ? { next_token: token } : {}),
    });
    found.push(...objectsOf(bucket, answer));
    if (!answer.next_token) break;
    token = answer.next_token;
  }
  return found;
}

/**
 * One page of one folder: the files straight inside `prefix` and the folders one level
 * down, which is how a bucket's flat list of keys is read as a tree.
 */
export async function listFolder(
  bucket: Bucket,
  prefix: string,
  token?: string,
): Promise<{ objects: BucketObject[]; folders: string[]; next: string | null }> {
  const answer = await ask<Page>(bucket, "list", {
    prefix: inBucket(bucket, prefix),
    folders: true,
    ...(token ? { next_token: token } : {}),
  });
  const folders = answer.folders.flatMap((folder) => {
    const key = inTeam(bucket, folder);
    return key ? [key] : [];
  });
  return { objects: objectsOf(bucket, answer), folders, next: answer.next_token };
}

/** Whether a file, or anything at all inside a folder, is at this key. */
export async function keyExists(bucket: Bucket, key: string): Promise<boolean> {
  return (await ask<{ exists: boolean }>(bucket, "exists", { key: inBucket(bucket, key) })).exists;
}

/**
 * Copies a file to a new key inside the bucket and returns the copy's etag. The toolkit
 * copies big files in parts, so there is no 5 GB limit; those can take minutes.
 */
export async function copyObject(bucket: Bucket, from: string, to: string): Promise<string> {
  const answer = await ask<{ etag: string }>(
    bucket,
    "copy",
    { source: inBucket(bucket, from), destination: inBucket(bucket, to) },
    // Just under the toolkit's own 300-second limit on a request.
    290_000,
  );
  return answer.etag;
}

export async function deleteObject(bucket: Bucket, key: string): Promise<void> {
  const answer = await ask<{ failed: string[] }>(
    bucket,
    "delete",
    { keys: [inBucket(bucket, key)] },
    30_000,
  );
  if (answer.failed.length > 0)
    throw new BucketError("The toolkit would not delete the file.", 502);
}

/** The most keys the toolkit deletes in one request. */
export const DELETE_AT_ONCE = 1000;

async function deleteInBucket(bucket: Bucket, keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const answer = await ask<{ failed: string[] }>(bucket, "delete", { keys }, 60_000);
  return answer.failed;
}

/**
 * Deletes up to DELETE_AT_ONCE files inside the team's folder in one request, and returns
 * the keys the bucket would not delete.
 */
export async function deleteObjects(bucket: Bucket, keys: string[]): Promise<string[]> {
  const failed = await deleteInBucket(
    bucket,
    keys.slice(0, DELETE_AT_ONCE).map((key) => inBucket(bucket, key)),
  );
  return failed.flatMap((key) => inTeam(bucket, key) ?? []);
}

/**
 * Deletes files the toolkit wrote at the top of the bucket for this team's jobs: the
 * toolkit names each result after its own job, outside any team's folder. Used only when
 * the team is deleted (teamDeletion.ts), with keys taken from the team's own job records.
 * Never touches a key in any team's folder.
 */
export async function deleteJobOutputs(bucket: Bucket, keys: string[]): Promise<string[]> {
  const outside = keys.filter((key) => key && !key.startsWith("teams/"));
  return await deleteInBucket(bucket, outside.slice(0, DELETE_AT_ONCE));
}

/**
 * Writes a small text file, such as a CSV list, through a short-lived upload link. The
 * toolkit has no request for writing a file's contents, so the bytes go straight to the
 * bucket the way a browser upload does.
 */
export async function putText(
  bucket: Bucket,
  key: string,
  text: string,
  contentType = "text/plain; charset=utf-8",
): Promise<void> {
  const url = await presign(bucket, "PUT", key, 300);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: text,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new BucketError("The bucket could not be reached.", 0);
  }
  if (!res.ok) throw new BucketError(`The bucket answered ${res.status}.`, res.status);
}

/** An empty object whose key ends in a slash: what every S3 console shows as an empty folder. */
export async function putFolder(bucket: Bucket, prefix: string): Promise<void> {
  await ask(bucket, "folder", { prefix: inBucket(bucket, prefix) }, 30_000);
}

/** Starts an upload in parts (a file too big for one PUT) and returns the bucket's id for it. */
export async function startPartsUpload(
  bucket: Bucket,
  key: string,
  contentType: string,
): Promise<string> {
  const answer = await ask<{ upload_id: string }>(bucket, "upload/start", {
    key: inBucket(bucket, key),
    content_type: contentType,
  });
  return answer.upload_id;
}

/** One PUT link for each of these parts of an upload in parts. */
export async function signParts(
  bucket: Bucket,
  key: string,
  partsUploadId: string,
  partNumbers: number[],
  expiresInSeconds: number,
): Promise<{ partNumber: number; url: string }[]> {
  const answer = await ask<{ parts: { part_number: number; url: string }[] }>(
    bucket,
    "upload/sign",
    {
      key: inBucket(bucket, key),
      upload_id: partsUploadId,
      part_numbers: partNumbers,
      expires_in: expiresInSeconds,
    },
  );
  return answer.parts.map((part) => ({ partNumber: part.part_number, url: part.url }));
}

/** Joins the parts into one file. Each part comes with the ETag the bucket answered it with. */
export async function completeParts(
  bucket: Bucket,
  key: string,
  partsUploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<void> {
  await ask(
    bucket,
    "upload/complete",
    {
      key: inBucket(bucket, key),
      upload_id: partsUploadId,
      parts: parts.map((part) => ({ part_number: part.partNumber, etag: part.etag })),
    },
    120_000,
  );
}

/** Cancels an upload in parts, dropping the parts already sent. */
export async function abortParts(
  bucket: Bucket,
  key: string,
  partsUploadId: string,
): Promise<void> {
  await ask(bucket, "upload/abort", { key: inBucket(bucket, key), upload_id: partsUploadId });
}
