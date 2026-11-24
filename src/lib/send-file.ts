"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { partRange, type PartsPlan } from "@takewon/automation-core";
import { useAction } from "convex/react";
import { useCallback, useMemo } from "react";

import {
  beginDiskUpload,
  type DiskFile,
  type DiskUpload,
  forgetDiskUpload,
  sendFileFromDisk,
  sendPartFromDisk,
} from "@/lib/desktop";
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

/** Where an upload's bytes come from: a file in the page, or a file the desktop app reads. */
export interface Source {
  size: number;
  /** Sends the whole file to one link. */
  whole: (url: string, onProgress: (percent: number) => void) => Promise<void>;
  /** Sends bytes start..end as part `partNumber`; resolves with the bucket's ETag. */
  part: (
    partNumber: number,
    start: number,
    end: number,
    url: string,
    onProgress: (percent: number) => void,
  ) => Promise<string | null>;
  /** Parts the bucket already has, when carrying on an upload that stopped. */
  done?: { partNumber: number; etag: string }[];
  /**
   * When a part keeps failing, keep what was sent so the upload can carry on later,
   * instead of dropping it (the desktop app remembers the file and the parts).
   */
  canCarryOn?: boolean;
}

/** An upload that stopped part way and can carry on from where it got to. */
export class StoppedUpload extends Error {
  constructor(public readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "StoppedUpload";
  }
}

/** A file in the page as a source. */
export function fileSource(file: File): Source {
  return {
    size: file.size,
    whole: async (url, onProgress) => {
      await putWithProgress(url, file, onProgress);
    },
    part: (_partNumber, start, end, url, onProgress) =>
      putWithProgress(url, file.slice(start, end), onProgress),
  };
}

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
 * Sends a started upload's bytes, from a file in the page or another source. A small file
 * goes in one PUT. A big one goes in parts,
 * a few side by side; a part that fails is tried again on its own, and if one keeps
 * failing the parts already sent are dropped. Progress is the share of bytes sent.
 */
export async function sendStartedUpload(
  started: StartedUpload,
  from: File | Source,
  onProgress: (percent: number) => void,
  calls: PartsCalls,
): Promise<void> {
  const source = from instanceof Blob ? fileSource(from) : from;
  const file = { size: source.size };
  if (started.uploadUrl) {
    await source.whole(started.uploadUrl, onProgress);
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
  // Carrying on: the parts the bucket has count as sent and are not sent again.
  for (const part of source.done ?? []) {
    if (part.partNumber < 1 || part.partNumber > plan.partCount) continue;
    const { start, end } = partRange(plan, file.size, part.partNumber);
    sent[part.partNumber - 1] = end - start;
    etags.push(part);
  }
  const already = new Set(etags.map((part) => part.partNumber));
  if (already.size > 0) report();
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
        if (!links.has(n) && !already.has(n)) numbers.push(n);
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
    for (let attempt = 1; ; attempt++) {
      try {
        const url = await linkFor(partNumber);
        const etag = await source.part(partNumber, start, end, url, (percent) => {
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
      if (already.has(partNumber)) continue;
      try {
        await sendPart(partNumber);
      } catch (caught) {
        failed ??= caught;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(PARTS_AT_ONCE, plan.partCount) }, worker));
  if (failed !== null) {
    // A hidden ETag can't get better by trying later, so that upload is dropped too.
    if (source.canCarryOn && (failed as Error).message !== NO_ETAG_MESSAGE) {
      throw new StoppedUpload(failed);
    }
    await calls.cancel({ uploadId: started.uploadId }).catch(() => null);
    throw failed;
  }
  etags.sort((a, b) => a.partNumber - b.partNumber);
  await calls.completeParts({ uploadId: started.uploadId, parts: etags });
}

/**
 * Sends a file chosen in the desktop app straight from disk. A file in parts is written
 * down by the app as it goes, so if it stops (StoppedUpload) it can carry on with
 * `carryOnFromDisk`, even after the app restarts.
 */
export async function sendFromDisk(
  started: StartedUpload,
  file: DiskFile,
  onProgress: (percent: number) => void,
  calls: PartsCalls,
): Promise<void> {
  if (started.uploadUrl) {
    await sendFileFromDisk(file, started.uploadUrl);
    onProgress(100);
    return;
  }
  if (!started.parts) throw new Error("This upload has nowhere to go.");
  const record = await beginDiskUpload(started.uploadId, file.path, started.parts);
  await sendRecorded(record, onProgress, calls);
}

/** Carries on an upload from this computer that stopped part way. */
export function carryOnFromDisk(
  record: DiskUpload,
  onProgress: (percent: number) => void,
  calls: PartsCalls,
): Promise<void> {
  return sendRecorded(record, onProgress, calls);
}

async function sendRecorded(
  record: DiskUpload,
  onProgress: (percent: number) => void,
  calls: PartsCalls,
) {
  const uploadId = record.uploadId as Id<"uploads">;
  const source: Source = {
    size: record.size,
    whole: () => Promise.reject(new Error("This upload goes in parts.")),
    // The app reads the part and says nothing until it is in, so it counts in one go.
    part: async (partNumber, _start, _end, url, partProgress) => {
      const etag = await sendPartFromDisk(record.uploadId, partNumber, url);
      partProgress(100);
      return etag;
    },
    done: record.parts,
    canCarryOn: true,
  };
  try {
    await sendStartedUpload(
      { uploadId, uploadUrl: null, parts: record.plan },
      source,
      onProgress,
      calls,
    );
  } catch (caught) {
    // Dropped (not stopped): there is nothing left to carry on.
    if (!(caught instanceof StoppedUpload)) await forgetDiskUpload(record.uploadId);
    throw caught;
  }
  await forgetDiskUpload(record.uploadId);
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

/** Sending from disk in the desktop app, and carrying on, wired to this app's backend. */
export function useSendFromDisk() {
  const signParts = useAction(api.storage.signUploadParts);
  const completeParts = useAction(api.storage.completeUploadParts);
  const cancel = useAction(api.storage.cancelUpload);
  return useMemo(() => {
    const calls = { signParts, completeParts, cancel };
    return {
      send: (started: StartedUpload, file: DiskFile, onProgress: (percent: number) => void) =>
        sendFromDisk(started, file, onProgress, calls),
      carryOn: (record: DiskUpload, onProgress: (percent: number) => void) =>
        carryOnFromDisk(record, onProgress, calls),
    };
  }, [signParts, completeParts, cancel]);
}
