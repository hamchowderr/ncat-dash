import { describe, expect, test } from "vitest";

import { fillQueue, scheduleTimes, slotProblem, slotTimes } from "../src/calendar";

const LA = "America/Los_Angeles";
const at = (iso: string) => Date.parse(iso);

describe("repeating slots", () => {
  const monday = { weekday: 1, time: "10:00", timeZone: LA, platform: "instagram" };

  test("fall on their weekday at their time in their own time zone", () => {
    // 2026-11-02 and 2026-11-09 are Mondays; Los Angeles is UTC-8 in November.
    expect(slotTimes(monday, at("2026-11-01T00:00:00Z"), at("2026-11-15T00:00:00Z"))).toEqual([
      at("2026-11-02T18:00:00Z"),
      at("2026-11-09T18:00:00Z"),
    ]);
  });

  test("keep the wall-clock time across a clock change", () => {
    // Clocks went back on 2026-11-01: 10:00 was 17:00 UTC the Monday before.
    expect(slotTimes(monday, at("2026-10-25T00:00:00Z"), at("2026-11-03T00:00:00Z"))).toEqual([
      at("2026-10-26T17:00:00Z"),
      at("2026-11-02T18:00:00Z"),
    ]);
  });

  test("are checked before they are saved", () => {
    expect(slotProblem(monday)).toBeNull();
    expect(slotProblem({ ...monday, weekday: 7 })).toMatch(/day/);
    expect(slotProblem({ ...monday, platform: "myspace" })).toMatch(/posted/);
    expect(slotProblem({ ...monday, time: "25:00" })).toMatch(/time/);
    expect(slotProblem({ ...monday, timeZone: "Mars/Olympus" })).toMatch(/zone/);
  });
});

describe("scheduled automations", () => {
  const from = at("2026-11-02T00:00:00Z");
  const to = at("2026-11-05T00:00:00Z");

  test("a daily one shows each day it runs", () => {
    const { times, perDay } = scheduleTimes(
      { mode: "daily", time: "09:30", timeZone: "UTC" },
      from,
      to,
      null,
    );
    expect(perDay).toBe(false);
    expect(times).toEqual([
      at("2026-11-02T09:30:00Z"),
      at("2026-11-03T09:30:00Z"),
      at("2026-11-04T09:30:00Z"),
    ]);
  });

  test("one that runs many times a day is shown once a day instead", () => {
    expect(scheduleTimes({ mode: "interval", minutes: 30 }, from, to, from)).toEqual({
      times: [],
      perDay: true,
    });
  });

  test("one every few days steps on from its next run", () => {
    const next = at("2026-10-31T12:00:00Z");
    const { times } = scheduleTimes({ mode: "interval", minutes: 2 * 24 * 60 }, from, to, next);
    expect(times).toEqual([at("2026-11-02T12:00:00Z"), at("2026-11-04T12:00:00Z")]);
  });
});

describe("filling slots from the queue", () => {
  const now = at("2026-11-01T00:00:00Z");
  const slots = [
    { id: "mon", weekday: 1, time: "10:00", timeZone: "UTC", platform: "instagram" },
    { id: "wed", weekday: 3, time: "10:00", timeZone: "UTC", platform: "instagram" },
    {
      id: "acme",
      weekday: 2,
      time: "09:00",
      timeZone: "UTC",
      platform: "tiktok",
      clientId: "acme",
    },
  ];

  test("gives each post the earliest free slot for its platform, in queue order", () => {
    const placed = fillQueue(
      [
        { id: "a", platform: "instagram" },
        { id: "b", platform: "instagram" },
        { id: "c", platform: "instagram" },
      ],
      slots,
      [{ slotId: "mon", at: at("2026-11-02T10:00:00Z") }],
      now,
    );
    expect(placed).toEqual([
      { id: "a", slotId: "wed", at: at("2026-11-04T10:00:00Z") },
      { id: "b", slotId: "mon", at: at("2026-11-09T10:00:00Z") },
      { id: "c", slotId: "wed", at: at("2026-11-11T10:00:00Z") },
    ]);
  });

  test("a client's slot only takes that client's posts, and nothing fits stays queued", () => {
    const placed = fillQueue(
      [
        { id: "other", platform: "tiktok", clientId: "zen" },
        { id: "theirs", platform: "tiktok", clientId: "acme" },
        { id: "nowhere", platform: "youtube" },
      ],
      slots,
      [],
      now,
    );
    expect(placed).toEqual([{ id: "theirs", slotId: "acme", at: at("2026-11-03T09:00:00Z") }]);
  });
});
