/**
 * How a file is sent to the bucket. One PUT takes up to 5 GiB (R2 and S3), so bigger files,
 * and any file from 100 MiB up, go in parts: side by side, and a part that fails is sent
 * again on its own instead of starting the whole file over.
 */

const MIB = 1024 * 1024;

/** From this size a file goes in parts. */
export const PARTS_FROM_BYTES = 100 * MIB;
/** The size each part aims for. Bigger files get bigger parts, to stay within the part limit. */
export const PART_BYTES = 64 * MIB;
/** S3 and R2 take at most 10,000 parts per file. */
export const MAX_PARTS = 10_000;
/** The largest file R2 takes, in parts: 5 GiB less than 5 TiB. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024 * MIB - 5 * 1024 * MIB;
/** How the largest file size reads in messages. */
export const MAX_FILE_TEXT = "4.9 TB";

export interface PartsPlan {
  partSize: number;
  partCount: number;
}

/** Null for a file that goes up in one PUT; otherwise how big each part is and how many. */
export function planParts(size: number): PartsPlan | null {
  if (!Number.isFinite(size) || size < PARTS_FROM_BYTES) return null;
  // Whole MiB, at least PART_BYTES, and few enough parts.
  const partSize = Math.max(PART_BYTES, Math.ceil(size / MAX_PARTS / MIB) * MIB);
  return { partSize, partCount: Math.ceil(size / partSize) };
}

/** The bytes of part `partNumber` (from 1): where it starts and where it stops (not included). */
export function partRange(plan: PartsPlan, size: number, partNumber: number) {
  const start = (partNumber - 1) * plan.partSize;
  return { start, end: Math.min(size, start + plan.partSize) };
}
