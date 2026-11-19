import type { Id } from "@convex/_generated/dataModel";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { NO_ETAG_MESSAGE, PARTS_AT_ONCE, sendStartedUpload, TRIES_PER_PART } from "./send-file";

// The bucket as the browser sees it: each PUT link answers with an ETag, unless told to fail.
const puts: { url: string; size: number }[] = [];
let failTimes = new Map<string, number>();
let hideEtag = false;
let inFlight = 0;
let mostInFlight = 0;
vi.mock("@/lib/upload", () => ({
  putWithProgress: async (url: string, body: Blob, onProgress: (percent: number) => void) => {
    inFlight++;
    mostInFlight = Math.max(mostInFlight, inFlight);
    await new Promise((done) => setTimeout(done, 1));
    inFlight--;
    const left = failTimes.get(url) ?? 0;
    if (left > 0) {
      failTimes.set(url, left - 1);
      throw new Error("network");
    }
    puts.push({ url, size: body.size });
    onProgress(100);
    return hideEtag ? null : `"etag-${new URL(url).searchParams.get("part") ?? "one"}"`;
  },
}));

const MIB = 1024 * 1024;
const uploadId = "u1" as Id<"uploads">;

function bigFile(size: number) {
  return new File([new Uint8Array(size)], "big.mp4", { type: "video/mp4" });
}

function backend() {
  let signRound = 0;
  return {
    signParts: vi.fn(async ({ partNumbers }: { partNumbers: number[] }) => {
      signRound++;
      return partNumbers.map((n) => ({
        partNumber: n,
        url: `https://r2.example/b?part=${n}&round=${signRound}`,
      }));
    }),
    completeParts: vi.fn(async () => null),
    cancel: vi.fn(async () => null),
    wait: async () => {},
  };
}

beforeEach(() => {
  puts.length = 0;
  failTimes = new Map();
  hideEtag = false;
  inFlight = 0;
  mostInFlight = 0;
});

describe("sending a started upload", () => {
  test("a small file goes in one PUT", async () => {
    const calls = backend();
    await sendStartedUpload(
      { uploadId, uploadUrl: "https://r2.example/one", parts: null },
      bigFile(10),
      () => {},
      calls,
    );
    expect(puts).toEqual([{ url: "https://r2.example/one", size: 10 }]);
    expect(calls.signParts).not.toHaveBeenCalled();
  });

  test("a big file goes in parts, a few at a time, then is joined in order", async () => {
    const calls = backend();
    const size = 10 * MIB + 5;
    const progress: number[] = [];
    await sendStartedUpload(
      { uploadId, uploadUrl: null, parts: { partSize: MIB, partCount: 11 } },
      bigFile(size),
      (percent) => progress.push(percent),
      calls,
    );
    expect(puts).toHaveLength(11);
    expect(puts.reduce((sum, put) => sum + put.size, 0)).toBe(size);
    expect(mostInFlight).toBeLessThanOrEqual(PARTS_AT_ONCE);
    expect(mostInFlight).toBeGreaterThan(1);
    // Every link was signed in one request.
    expect(calls.signParts).toHaveBeenCalledTimes(1);
    const joined = calls.completeParts.mock.calls[0][0] as unknown as {
      parts: { partNumber: number; etag: string }[];
    };
    expect(joined.parts.map((part) => part.partNumber)).toEqual(
      Array.from({ length: 11 }, (_, i) => i + 1),
    );
    expect(joined.parts[0].etag).toBe('"etag-1"');
    expect(progress.at(-1)).toBe(100);
    expect(calls.cancel).not.toHaveBeenCalled();
  });

  test("a part that fails once is sent again with a fresh link", async () => {
    const calls = backend();
    failTimes.set("https://r2.example/b?part=2&round=1", 1);
    await sendStartedUpload(
      { uploadId, uploadUrl: null, parts: { partSize: MIB, partCount: 3 } },
      bigFile(3 * MIB),
      () => {},
      calls,
    );
    expect(puts.map((put) => put.url)).toContain("https://r2.example/b?part=2&round=2");
    expect(calls.completeParts).toHaveBeenCalledTimes(1);
  });

  test("a part that keeps failing drops the upload's parts and says why", async () => {
    const calls = backend();
    for (let round = 1; round <= TRIES_PER_PART + 1; round++) {
      failTimes.set(`https://r2.example/b?part=1&round=${round}`, 1);
    }
    await expect(
      sendStartedUpload(
        { uploadId, uploadUrl: null, parts: { partSize: MIB, partCount: 2 } },
        bigFile(2 * MIB),
        () => {},
        calls,
      ),
    ).rejects.toThrow("network");
    expect(calls.cancel).toHaveBeenCalledWith({ uploadId });
    expect(calls.completeParts).not.toHaveBeenCalled();
  });

  test("a bucket that hides the ETag is named as the cause, without retrying", async () => {
    const calls = backend();
    hideEtag = true;
    await expect(
      sendStartedUpload(
        { uploadId, uploadUrl: null, parts: { partSize: MIB, partCount: 2 } },
        bigFile(2 * MIB),
        () => {},
        calls,
      ),
    ).rejects.toThrow(NO_ETAG_MESSAGE);
    expect(calls.signParts).toHaveBeenCalledTimes(1);
    expect(calls.cancel).toHaveBeenCalled();
  });
});
