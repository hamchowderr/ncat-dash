"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { partRange, type PartsPlan } from "@ncat-dash/automation-core";
import { useAction } from "convex/react";
import { useCallback } from "react";

import { putWithProgress } from "@/lib/upload";

/** What starting an upload hands back: one link, or the plan for sending it in parts. */
export interface StartedUpload {
  uploadId: Id<"uploads">;
  uploadUrl: string | null;
  parts: PartsPlan | null;
}

/** Parts sent side by side. */
export const PARTS_AT_ONCE = 4;
/** Tries for each part before the upload gives up. */
export const TRIES_PER_PART = 3;
/** Parts signed per request. */
const SIGN_BATCH = 100;

export const NO_ETAG_MESSAGE =
  "Your bucket's CORS rule has to expose the ETag header for big files to upload.";

interface PartsCalls {
  signParts: (args: {
    uploadId: Id<"uploads">;
    partNumbers: number[];
  }) => Promise<{ partNumber: number; url: string }[]>;
  completeParts: (args: {
    uploadId: Id<"uploads">;
    parts: { partNumber: number; etag: string }[];
  }) => Promise<null>;
  cancel: (args: { uploadId: Id<"uploads"> }) => Promise<null>;
  /** Waits before a part is tried again. */
  wait?: (ms: number) => Promise<void>;
}

/**
 * Sends a started upload's bytes. A small file goes in one PUT. A big one goes in parts,
 * a few side by side; a part that fails is tried again on its own, and if one keeps
 * failing the parts already sent are dropped. Progress is the share of bytes sent.
 */
export async function sendStartedUpload(
  started: StartedUpload,
  file: File,
  onProgress: (percent: number) => void,
  calls: PartsCalls,
): Promise<void> {
  if (started.uploadUrl) {
    await putWithProgress(started.uploadUrl, file, onProgress);
    return;
  }
  const plan = started.parts;
  if (!plan) throw new Error("This upload has nowhere to go.");
  const wait = calls.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const sent = new Array<number>(plan.partCount).fill(0);
  const report = () =>
    onProgress(Math.min(100, Math.floor((sent.reduce((a, b) => a + b, 0) / file.size) * 100)));
  const links = new Map<number, string>();
  const etags: { partNumber: number; etag: string }[] = [];
  let next = 1;
  let failed: unknown = null;

  // One signing request at a time, so parts sent side by side share a batch of links.
  let signing: Promise<void> | null = null;
  async function linkFor(partNumber: number): Promise<string> {
    while (!links.has(partNumber)) {
      if (signing) {
        await signing;
        continue;
      }
      const numbers = [];
      for (let n = partNumber; n < partNumber + SIGN_BATCH && n <= plan!.partCount; n++) {
        if (!links.has(n)) numbers.push(n);
      }
      signing = calls
        .signParts({ uploadId: started.uploadId, partNumbers: numbers })
        .then((signed) => {
          for (const link of signed) links.set(link.partNumber, link.url);
        })
        .finally(() => {
          signing = null;
        });
      await signing;
    }
    return links.get(partNumber)!;
  }

  async function sendPart(partNumber: number) {
    const { start, end } = partRange(plan!, file.size, partNumber);
    const bytes = file.slice(start, end);
    for (let attempt = 1; ; attempt++) {
      try {
        const etag = await putWithProgress(await linkFor(partNumber), bytes, (percent) => {
          sent[partNumber - 1] = ((end - start) * percent) / 100;
          report();
        });
        if (!etag) throw new Error(NO_ETAG_MESSAGE);
        sent[partNumber - 1] = end - start;
        report();
        etags.push({ partNumber, etag });
        return;
      } catch (caught) {
        sent[partNumber - 1] = 0;
        // A hidden ETag is the bucket's setting, not a hiccup: trying again cannot help.
        if (attempt >= TRIES_PER_PART || (caught as Error).message === NO_ETAG_MESSAGE)
          throw caught;
        // A fresh link, in case the old one ran out.
        links.delete(partNumber);
        await wait(1000 * attempt);
      }
    }
  }

  async function worker() {
    while (failed === null && next <= plan!.partCount) {
      const partNumber = next++;
      try {
        await sendPart(partNumber);
      } catch (caught) {
        failed ??= caught;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(PARTS_AT_ONCE, plan.partCount) }, worker));
  if (failed !== null) {
    await calls.cancel({ uploadId: started.uploadId }).catch(() => null);
    throw failed;
  }
  etags.sort((a, b) => a.partNumber - b.partNumber);
  await calls.completeParts({ uploadId: started.uploadId, parts: etags });
}

/** `sendStartedUpload` wired to this app's backend. */
export function useSendFile() {
  const signParts = useAction(api.storage.signUploadParts);
  const completeParts = useAction(api.storage.completeUploadParts);
  const cancel = useAction(api.storage.cancelUpload);
  return useCallback(
    (started: StartedUpload, file: File, onProgress: (percent: number) => void) =>
      sendStartedUpload(started, file, onProgress, { signParts, completeParts, cancel }),
    [signParts, completeParts, cancel],
  );
}
