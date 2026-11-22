import { describe, expect, test } from "vitest";

import { dayOf, timeAgo } from "./when";

const NOW = new Date("2026-11-22T12:00:00Z").getTime();
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe("how long ago something happened", () => {
  test("reads like a person would say it", () => {
    expect(timeAgo(NOW - 10_000, NOW)).toBe("just now");
    expect(timeAgo(NOW - 5 * MINUTE, NOW)).toBe("5 minutes ago");
    expect(timeAgo(NOW - 3 * 60 * MINUTE, NOW)).toBe("3 hours ago");
    expect(timeAgo(NOW - DAY, NOW)).toBe("yesterday");
    expect(timeAgo(NOW - 14 * DAY, NOW)).toBe("2 weeks ago");
    expect(timeAgo(NOW - 61 * DAY, NOW)).toBe("2 months ago");
    expect(timeAgo(NOW - 400 * DAY, NOW)).toBe("last year");
  });

  test("a day leaves out the year when it is this year", () => {
    expect(dayOf(new Date("2026-11-06T12:00:00Z").getTime(), NOW)).toBe("6 November");
    expect(dayOf(new Date("2025-03-02T12:00:00Z").getTime(), NOW)).toBe("2 March 2025");
  });
});
