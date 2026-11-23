import type { Id } from "@convex/_generated/dataModel";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { DiskUpload } from "./desktop";
import { carryOnFromDisk, sendFromDisk, StoppedUpload } from "./send-file";

const MIB = 1024 * 1024;
const uploadId = "u1" as Id<"uploads">;
const FILE = {
  path: "/Users/sam/Movies/talk.mp4",
  name: "talk.mp4",
  size: 200 * MIB,
  contentType: "video/mp4",
};
const PLAN = { partSize: 64 * MIB, partCount: 4 };

type Win = { __TAURI_INTERNALS__?: { invoke: (...args: unknown[]) => Promise<unknown> } };

/** The desktop app as the page sees it: keeps uploads and their parts like uploads.json. */
function fakeApp(failing: Set<number> = new Set()) {
  const records = new Map<string, DiskUpload>();
  const sentParts: number[] = [];
  const invoke = vi.fn(async (command: unknown, args?: unknown) => {
    const a = (args ?? {}) as Record<string, never>;
    switch (command) {
      case "send_file":
        return null;
      case "begin_upload": {
        const record = records.get(a.uploadId) ?? {
          uploadId: a.uploadId,
          path: a.path,
          name: FILE.name,
          size: FILE.size,
          contentType: FILE.contentType,
          plan: a.plan,
          parts: [],
        };
        records.set(a.uploadId, record);
        return record;
      }
      case "send_part": {
        const partNumber = a.partNumber as number;
        if (failing.has(partNumber)) throw "The bucket answered 503.";
        sentParts.push(partNumber);
        const etag = `"e${partNumber}"`;
        records.get(a.uploadId)!.parts.push({ partNumber, etag });
        return etag;
      }
      case "forget_upload":
        records.delete(a.uploadId);
        return null;
      default:
        throw `unknown ${String(command)}`;
    }
  });
  (window as unknown as Win).__TAURI_INTERNALS__ = { invoke };
  return { invoke, records, sentParts };
}

function backend() {
  return {
    signParts: vi.fn(async ({ partNumbers }: { partNumbers: number[] }) =>
      partNumbers.map((n) => ({ partNumber: n, url: `https://r2.example/b?part=${n}` })),
    ),
    completeParts: vi.fn(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async (_args: { uploadId: Id<"uploads">; parts: { partNumber: number; etag: string }[] }) =>
        null,
    ),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    cancel: vi.fn(async (_args: { uploadId: Id<"uploads"> }) => null),
    wait: async () => {},
  };
}

afterEach(() => {
  delete (window as unknown as Win).__TAURI_INTERNALS__;
});

describe("sending a file straight from disk in the desktop app", () => {
  test("a small file goes whole, read by the app", async () => {
    const { invoke } = fakeApp();
    const progress: number[] = [];
    await sendFromDisk(
      { uploadId, uploadUrl: "https://r2.example/one", parts: null },
      { ...FILE, size: 10 },
      (percent) => progress.push(percent),
      backend(),
    );
    expect(invoke).toHaveBeenCalledWith("send_file", {
      path: FILE.path,
      url: "https://r2.example/one",
      contentType: "video/mp4",
    });
    expect(progress.at(-1)).toBe(100);
  });

  test("a big file goes in parts the app reads, then is joined and forgotten", async () => {
    const app = fakeApp();
    const calls = backend();
    await sendFromDisk({ uploadId, uploadUrl: null, parts: PLAN }, FILE, () => {}, calls);
    expect(app.invoke).toHaveBeenCalledWith("begin_upload", {
      uploadId,
      path: FILE.path,
      plan: PLAN,
    });
    expect([...app.sentParts].sort()).toEqual([1, 2, 3, 4]);
    expect(calls.completeParts).toHaveBeenCalledWith({
      uploadId,
      parts: [1, 2, 3, 4].map((n) => ({ partNumber: n, etag: `"e${n}"` })),
    });
    expect(app.records.size).toBe(0);
  });

  test("a part that keeps failing stops the upload, and it carries on with only what's missing", async () => {
    const failing = new Set([3]);
    const app = fakeApp(failing);
    const calls = backend();
    const stopped = await sendFromDisk(
      { uploadId, uploadUrl: null, parts: PLAN },
      FILE,
      () => {},
      calls,
    ).catch((caught: unknown) => caught);
    expect(stopped).toBeInstanceOf(StoppedUpload);
    // Kept, not dropped: the bucket keeps the parts and the app keeps the list.
    expect(calls.cancel).not.toHaveBeenCalled();
    expect(calls.completeParts).not.toHaveBeenCalled();
    const record = app.records.get(uploadId)!;
    expect(record.parts.map((part) => part.partNumber).sort()).toEqual([1, 2, 4]);

    // Later (after a restart, say) the network is back.
    failing.clear();
    app.sentParts.length = 0;
    calls.signParts.mockClear();
    const progress: number[] = [];
    await carryOnFromDisk(record, (percent) => progress.push(percent), calls);
    expect(app.sentParts).toEqual([3]);
    expect(calls.signParts).toHaveBeenCalledWith({ uploadId, partNumbers: [3] });
    // Starts from what was already sent, not from nothing.
    expect(progress[0]).toBeGreaterThanOrEqual(60);
    expect(progress.at(-1)).toBe(100);
    expect(calls.completeParts.mock.calls[0][0].parts.map((part) => part.partNumber)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(app.records.size).toBe(0);
  });
});
