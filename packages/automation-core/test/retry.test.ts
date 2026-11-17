import { describe, expect, it } from "vitest";
import {
  DEFAULT_STEP_RETRIES,
  isTransientStatus,
  MAX_STEP_RETRIES,
  retryDelayMs,
  retryLimit,
  shouldRetry,
} from "../src";

describe("retries", () => {
  it("waits longer before each new try and stops growing at the last wait", () => {
    const waits = [1, 2, 3, 4, 5, 6, 40].map(retryDelayMs);
    expect(waits).toEqual([30_000, 120_000, 300_000, 600_000, 900_000, 900_000, 900_000]);
    expect(retryDelayMs(0)).toBe(30_000);
  });

  it("reads the team's setting, falling back to the default", () => {
    expect(retryLimit(undefined)).toBe(DEFAULT_STEP_RETRIES);
    expect(retryLimit(1.5)).toBe(DEFAULT_STEP_RETRIES);
    expect(retryLimit(0)).toBe(0);
    expect(retryLimit(3)).toBe(3);
    expect(retryLimit(99)).toBe(MAX_STEP_RETRIES);
    expect(retryLimit(-1)).toBe(0);
  });

  it("tries again only while tries are left", () => {
    expect(shouldRetry(0, 2, [{}])).toBe(true);
    expect(shouldRetry(1, 2, [{}])).toBe(true);
    expect(shouldRetry(2, 2, [{}])).toBe(false);
    expect(shouldRetry(0, 0, [{}])).toBe(false);
    expect(shouldRetry(0, 2, [])).toBe(false);
  });

  it("does not try again when a failure cannot be fixed by trying", () => {
    expect(shouldRetry(0, 2, [{}, { permanent: true }])).toBe(false);
    expect(shouldRetry(0, 2, [{ permanent: false }])).toBe(true);
  });

  it("treats server trouble as passing and a refused request as final", () => {
    expect([500, 502, 503, 408, 429].map(isTransientStatus)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect([400, 401, 404, 422].map(isTransientStatus)).toEqual([false, false, false, false]);
  });
});
