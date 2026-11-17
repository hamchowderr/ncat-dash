import { AwsClient } from "aws4fetch";

export interface BucketConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function client(config: BucketConfig) {
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    service: "s3",
  });
}

/** Path-style URL, which every S3-compatible service accepts (R2, MinIO, Spaces, AWS). */
export function objectUrl(config: BucketConfig, key: string): URL {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return new URL(`${config.endpoint.replace(/\/+$/, "")}/${config.bucket}/${path}`);
}

/** A link that lets its holder PUT or GET one object for a limited time. */
export async function presign(
  config: BucketConfig,
  method: "PUT" | "GET",
  key: string,
  expiresInSeconds: number,
  // Extra signed settings, such as "response-content-disposition" to make a link download.
  query: Record<string, string> = {},
): Promise<string> {
  const url = objectUrl(config, key);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  const signed = await client(config).sign(url.toString(), { method, aws: { signQuery: true } });
  return signed.url;
}

/** Asks the bucket for an empty listing: proves the endpoint, bucket and keys all work. */
export async function checkBucket(
  config: BucketConfig,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const url = new URL(`${config.endpoint.replace(/\/+$/, "")}/${config.bucket}`);
  url.searchParams.set("list-type", "2");
  url.searchParams.set("max-keys", "1");
  try {
    const res = await client(config).fetch(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true };
    if (res.status === 403) return { ok: false, detail: "The bucket refused these keys." };
    if (res.status === 404) return { ok: false, detail: "No bucket with that name was found." };
    return { ok: false, detail: `The storage service answered ${res.status}.` };
  } catch {
    return { ok: false, detail: "The storage address could not be reached." };
  }
}

export interface BucketObject {
  key: string;
  etag: string;
  size: number;
  lastModified: number;
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Reads the objects, and the folders when one level was asked for, out of a ListObjectsV2 answer. */
export function parseListing(xml: string): {
  objects: BucketObject[];
  folders: string[];
  next: string | null;
} {
  const tag = (block: string, name: string) =>
    unescapeXml(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)?.[1] ?? "");
  const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, block]) => ({
    key: tag(block, "Key"),
    etag: tag(block, "ETag").replace(/"/g, ""),
    size: Number(tag(block, "Size")) || 0,
    lastModified: Date.parse(tag(block, "LastModified")) || 0,
  }));
  const folders = [...xml.matchAll(/<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g)].map(
    ([, block]) => tag(block, "Prefix"),
  );
  const truncated = tag(xml, "IsTruncated") === "true";
  return { objects, folders, next: truncated ? tag(xml, "NextContinuationToken") || null : null };
}

/** Lists what is under a prefix, up to `maxPages` thousand objects. Throws if the bucket refuses. */
export async function listObjects(
  config: BucketConfig,
  prefix: string,
  maxPages = 5,
): Promise<BucketObject[]> {
  const found: BucketObject[] = [];
  let token: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const url = new URL(`${config.endpoint.replace(/\/+$/, "")}/${config.bucket}`);
    url.searchParams.set("list-type", "2");
    if (prefix) url.searchParams.set("prefix", prefix);
    if (token) url.searchParams.set("continuation-token", token);
    const res = await client(config).fetch(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`The storage service answered ${res.status}.`);
    const { objects, next } = parseListing(await res.text());
    found.push(...objects);
    if (!next) break;
    token = next;
  }
  return found;
}

function bucketUrl(config: BucketConfig): URL {
  return new URL(`${config.endpoint.replace(/\/+$/, "")}/${config.bucket}`);
}

/**
 * One page of one folder: the files straight inside `prefix` and the folders one level
 * down, which is how a bucket's flat list of keys is read as a tree.
 */
export async function listFolder(
  config: BucketConfig,
  prefix: string,
  token?: string,
): Promise<{ objects: BucketObject[]; folders: string[]; next: string | null }> {
  const url = bucketUrl(config);
  url.searchParams.set("list-type", "2");
  url.searchParams.set("delimiter", "/");
  if (prefix) url.searchParams.set("prefix", prefix);
  if (token) url.searchParams.set("continuation-token", token);
  const res = await client(config).fetch(url.toString(), {
    method: "GET",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`The storage service answered ${res.status}.`);
  return parseListing(await res.text());
}

/** Whether a file, or anything at all inside a folder, is at this key. */
export async function keyExists(config: BucketConfig, key: string): Promise<boolean> {
  if (key.endsWith("/")) {
    const url = bucketUrl(config);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("max-keys", "1");
    url.searchParams.set("prefix", key);
    const res = await client(config).fetch(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`The storage service answered ${res.status}.`);
    return parseListing(await res.text()).objects.length > 0;
  }
  const res = await client(config).fetch(objectUrl(config, key).toString(), {
    method: "HEAD",
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`The storage service answered ${res.status}.`);
  return true;
}

/**
 * Copies an object to a new key inside the bucket and returns the copy's etag. The bytes
 * never leave the storage service. One copy is limited to 5 GB by S3, the same as an upload.
 */
export async function copyObject(config: BucketConfig, from: string, to: string): Promise<string> {
  const source = `/${config.bucket}/${from.split("/").map(encodeURIComponent).join("/")}`;
  const res = await client(config).fetch(objectUrl(config, to).toString(), {
    method: "PUT",
    headers: { "x-amz-copy-source": source },
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.text();
  // S3 can answer 200 and still report a failure in the body.
  if (!res.ok || /<Error>/.test(body)) {
    throw new Error(`The storage service would not copy the file (${res.status}).`);
  }
  return (/<ETag>([\s\S]*?)<\/ETag>/.exec(body)?.[1] ?? "").replace(/&quot;|"/g, "");
}

export async function deleteObject(config: BucketConfig, key: string): Promise<void> {
  const res = await client(config).fetch(objectUrl(config, key).toString(), {
    method: "DELETE",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`The storage service would not delete the file (${res.status}).`);
  }
}

/** An empty object whose key ends in a slash: what every S3 console shows as an empty folder. */
export async function putFolder(config: BucketConfig, prefix: string): Promise<void> {
  const res = await client(config).fetch(objectUrl(config, prefix).toString(), {
    method: "PUT",
    body: "",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`The storage service would not make the folder (${res.status}).`);
}
