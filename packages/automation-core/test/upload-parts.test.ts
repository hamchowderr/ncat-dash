import { describe, expect, it } from "vitest";
import {
  MAX_FILE_BYTES,
  MAX_PARTS,
  PART_BYTES,
  PARTS_FROM_BYTES,
  partRange,
  planParts,
} from "../src/upload-parts";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

describe("planParts", () => {
  it("sends small files in one go", () => {
    expect(planParts(1000)).toBeNull();
    expect(planParts(PARTS_FROM_BYTES - 1)).toBeNull();
  });

  it("splits a 20 GB file into 64 MiB parts", () => {
    const plan = planParts(20 * GIB)!;
    expect(plan.partSize).toBe(PART_BYTES);
    expect(plan.partCount).toBe(320);
  });

  it("grows the parts so the biggest file still fits in 10,000", () => {
    const plan = planParts(MAX_FILE_BYTES)!;
    expect(plan.partCount).toBeLessThanOrEqual(MAX_PARTS);
    expect(plan.partSize % MIB).toBe(0);
    // Each part stays under one PUT's 5 GiB.
    expect(plan.partSize).toBeLessThan(5 * GIB);
    expect(plan.partSize * plan.partCount).toBeGreaterThanOrEqual(MAX_FILE_BYTES);
  });

  it("gives each part its bytes, the last one shorter", () => {
    const size = 150 * MIB + 7;
    const plan = planParts(size)!;
    expect(plan.partCount).toBe(3);
    expect(partRange(plan, size, 1)).toEqual({ start: 0, end: 64 * MIB });
    expect(partRange(plan, size, 3)).toEqual({ start: 128 * MIB, end: size });
  });
});
