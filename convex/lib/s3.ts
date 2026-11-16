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
): Promise<string> {
  const url = objectUrl(config, key);
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
