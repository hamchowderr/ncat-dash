import { describe, expect, test } from "vitest";

import { triggerSummary } from "./automations";

describe("what a project slot trigger says", () => {
  test("names the slots and the status in plain words", () => {
    expect(triggerSummary({ kind: "slot", status: "approved", slotKind: "any" })).toBe(
      "Starts when a project slot moves to Approved",
    );
    expect(triggerSummary({ kind: "slot", status: "review", slotKind: "video" })).toBe(
      "Starts when a full video slot moves to In review",
    );
    expect(triggerSummary({ kind: "slot", status: "published", slotKind: "short" })).toBe(
      "Starts when a short slot moves to Published",
    );
  });
});

describe("what a daily schedule says", () => {
  test("names the city of the time zone, not its code", () => {
    expect(
      triggerSummary({
        kind: "schedule",
        schedule: { mode: "daily", time: "09:00", timeZone: "America/New_York" },
      }),
    ).toBe("Every day at 09:00, New York time");
    expect(
      triggerSummary({
        kind: "schedule",
        schedule: { mode: "daily", time: "18:30", timeZone: "UTC" },
      }),
    ).toBe("Every day at 18:30, UTC time");
  });

  test("an upload trigger that asks first says it is offered, not started", () => {
    expect(triggerSummary({ kind: "upload", fileType: "video", ask: true })).toBe(
      "Offered on each video upload, to run with one press",
    );
    expect(triggerSummary({ kind: "upload", fileType: "video" })).toBe(
      "Starts when a video file is uploaded",
    );
  });
});
