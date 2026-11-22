import { vi } from "vitest";
import { encryptSecret } from "./lib/crypto";
import type { backend } from "./test.setup";

// The fetch the test runner started with, before any test put a stand-in in its place.
const NATIVE_FETCH = globalThis.fetch;

/**
 * A stand-in for the toolkit fork's storage requests (/v1/storage/*), answering the way
 * the real ones do, over an in-memory bucket. Other requests go to the real fetch.
 */
export function fakeToolkitStorage({
  baseUrl = "https://toolkit.example",
  bucket = "test-bucket",
  publicUrl = null as string | null,
  // false: answer like Stephen's original toolkit, which has no storage requests.
  fork = true,
  // A message to fail every storage request with, as when the toolkit's bucket is wrong.
  broken = null as string | null,
} = {}) {
  const files = new Map<string, { size: number; etag: string; lastModified: number }>();
  // What was written through an upload link, by key: the CSV lists and other small files.
  const texts = new Map<string, string>();
  const calls: { request: string; body: Record<string, unknown> }[] = [];
  // Uploads in parts still open: upload id -> key.
  const openUploads = new Map<string, string>();
  const realFetch = globalThis.fetch;
  const answer = (response: unknown, status = 200) =>
    new Response(
      JSON.stringify({
        code: status,
        response: status === 200 ? response : null,
        message: status === 200 ? "success" : response,
      }),
      { status, headers: { "content-type": "application/json" } },
    );

  const handle = (request: string, body: Record<string, unknown>): Response => {
    switch (request) {
      case "info":
        return answer({
          provider: "s3",
          bucket,
          endpoint: "https://r2.example",
          public_url: publicUrl,
        });
      case "sign": {
        const key = String(body.key);
        const query = new URLSearchParams({
          method: String(body.method ?? "GET"),
          expires: String(body.expires_in ?? 3600),
          ...(body.download_name ? { download: String(body.download_name) } : {}),
          signature: "fake",
        });
        return answer({ url: `https://r2.example/${bucket}/${key}?${query}` });
      }
      case "list": {
        const prefix = String(body.prefix ?? "");
        const keys = [...files.keys()].filter((key) => key.startsWith(prefix)).sort();
        const folders = new Set<string>();
        const inside = [];
        for (const key of keys) {
          const rest = key.slice(prefix.length);
          if (body.folders && rest.includes("/") && rest.indexOf("/") < rest.length - 1) {
            folders.add(prefix + rest.slice(0, rest.indexOf("/") + 1));
          } else inside.push(key);
        }
        return answer({
          files: inside.map((key) => {
            const file = files.get(key)!;
            return { key, etag: file.etag, size: file.size, last_modified: file.lastModified };
          }),
          folders: [...folders].sort(),
          next_token: null,
        });
      }
      case "exists": {
        const key = String(body.key);
        const exists = key.endsWith("/")
          ? [...files.keys()].some((one) => one.startsWith(key))
          : files.has(key);
        return answer({ exists });
      }
      case "copy": {
        const from = files.get(String(body.source));
        if (!from) return answer("No file at that key.", 404);
        files.set(String(body.destination), { ...from });
        return answer({ key: body.destination, etag: from.etag });
      }
      case "delete": {
        const keys = body.keys as string[];
        for (const key of keys) files.delete(key);
        return answer({ deleted: keys, failed: [] });
      }
      case "folder":
        files.set(String(body.prefix), { size: 0, etag: "folder", lastModified: Date.now() });
        return answer({ prefix: body.prefix });
      case "upload/start": {
        const uploadId = `parts-${openUploads.size + 1}`;
        openUploads.set(uploadId, String(body.key));
        return answer({ key: body.key, upload_id: uploadId });
      }
      case "upload/sign": {
        if (openUploads.get(String(body.upload_id)) !== body.key) {
          return answer("That upload was finished, cancelled or never started.", 404);
        }
        return answer({
          parts: (body.part_numbers as number[]).map((number) => ({
            part_number: number,
            url: `https://r2.example/${bucket}/${String(body.key)}?uploadId=${String(body.upload_id)}&partNumber=${number}&signature=fake`,
          })),
          expires_in: body.expires_in ?? 3600,
        });
      }
      case "upload/complete": {
        if (openUploads.get(String(body.upload_id)) !== body.key) {
          return answer("That upload was finished, cancelled or never started.", 404);
        }
        openUploads.delete(String(body.upload_id));
        const parts = body.parts as { part_number: number }[];
        files.set(String(body.key), {
          size: 0,
          etag: `etag-${String(body.key)}-${parts.length}`,
          lastModified: Date.now(),
        });
        return answer({ key: body.key, etag: `etag-${parts.length}` });
      }
      case "upload/abort":
        openUploads.delete(String(body.upload_id));
        return answer({ key: body.key, cancelled: true });
      default:
        return answer("not found", 404);
    }
  };

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (url.origin === new URL(baseUrl).origin && url.pathname === "/v1/toolkit/authenticate") {
      // Both versions of the toolkit answer the plain connection test.
      return new Response(JSON.stringify({ response: "Authorized", build_number: "210" }), {
        status: 200,
      });
    }
    // A file written through a signed upload link.
    if (
      url.origin === "https://r2.example" &&
      init?.method === "PUT" &&
      url.searchParams.get("method") === "PUT" &&
      url.pathname.startsWith(`/${bucket}/`)
    ) {
      const key = decodeURIComponent(url.pathname.slice(bucket.length + 2));
      const text = String(init.body ?? "");
      texts.set(key, text);
      files.set(key, { size: text.length, etag: `etag-${key}`, lastModified: Date.now() });
      return new Response(null, { status: 200 });
    }
    if (url.origin !== new URL(baseUrl).origin || !url.pathname.startsWith("/v1/storage/")) {
      // The stand-in toolkit has no real address. A request to it that is not about storage
      // (reading an upload's details, say) would otherwise go out to the network and hang
      // until it times out, holding up whatever waits on it. Answer it the way a toolkit
      // that is down does, unless a test put its own stand-in behind this one.
      if (url.origin === new URL(baseUrl).origin && realFetch === NATIVE_FETCH) {
        return new Response("Toolkit stand-in: not a storage request", { status: 503 });
      }
      return realFetch(input, init);
    }
    const request = url.pathname.slice("/v1/storage/".length);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ request, body });
    if (!fork) return new Response("<h1>Not Found</h1>", { status: 404 });
    if (broken) return answer(broken, 502);
    return handle(request, body);
  });

  return {
    baseUrl,
    bucket,
    files,
    texts,
    calls,
    openUploads,
    /** Puts a file in the bucket, as if it had been uploaded. */
    put(key: string, size = 1000) {
      files.set(key, { size, etag: `etag-${key}`, lastModified: Date.now() });
    },
    restore() {
      vi.unstubAllGlobals();
    },
  };
}

/** Saves a working toolkit connection for a team, with its bucket read. */
export async function connectToolkit(
  t: ReturnType<typeof backend>,
  organizationId: string,
  createdBy: string,
  {
    baseUrl = "https://toolkit.example",
    bucket = "test-bucket",
    endpoint = "https://r2.example",
    publicUrl = null as string | null,
  } = {},
) {
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  const apiKeyCipher = await encryptSecret("toolkit-key");
  return await t.run((ctx) =>
    ctx.db.insert("toolkitConnections", {
      organizationId,
      baseUrl,
      apiKeyCipher,
      apiKeyHint: "-key",
      status: "ok",
      buildNumber: "fork",
      lastCheckedAt: Date.now(),
      lastError: null,
      storage: { bucket, endpoint, publicUrl },
      createdBy,
    }),
  );
}
