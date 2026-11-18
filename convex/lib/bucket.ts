import { teamFolder } from "@ncat-dash/automation-core";
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
    throw new BucketError("The toolkit could not be reached.", 0);
  }
  let json: { response?: T; message?: unknown } | null = null;
  try {
    json = (await res.json()) as { response?: T; message?: unknown };
  } catch {
    json = null;
  }
  if (!res.ok || !json || json.response === undefined || json.response === null) {
    const message =
      typeof json?.message === "string" && json.message
        ? json.message
        : `The toolkit answered ${res.status}.`;
    throw new BucketError(message, res.status);
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

/** Copies a file to a new key inside the bucket and returns the copy's etag. Up to 5 GB. */
export async function copyObject(bucket: Bucket, from: string, to: string): Promise<string> {
  const answer = await ask<{ etag: string }>(
    bucket,
    "copy",
    { source: inBucket(bucket, from), destination: inBucket(bucket, to) },
    120_000,
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

/** An empty object whose key ends in a slash: what every S3 console shows as an empty folder. */
export async function putFolder(bucket: Bucket, prefix: string): Promise<void> {
  await ask(bucket, "folder", { prefix: inBucket(bucket, prefix) }, 30_000);
}
