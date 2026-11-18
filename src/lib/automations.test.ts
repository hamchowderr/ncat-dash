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
