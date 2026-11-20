import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { notify } from "./lib/alerts";
import { alertHref, digestDue, hourIn, wants } from "./lib/notifications";
import { addPerson, addTeam, backend } from "./test.setup";

type Backend = ReturnType<typeof backend>;

/** A team of three with email set up, and an automation to raise alerts about. */
async function team() {
  const t = backend();
  const teamId = await addTeam(t, "Salt House");
  const olu = await addPerson(t, "Olu Bello", [teamId], "owner");
  const ana = await addPerson(t, "Ana Reyes", [teamId]);
  const ben = await addPerson(t, "Ben Cho", [teamId]);
  const automationId = await t.run(async (ctx) => {
    await ctx.db.insert("emailConnections", {
      organizationId: teamId,
      apiKeyCipher: "x",
      apiKeyHint: "abcd",
      fromEmail: "alerts@example.test",
      createdBy: olu.id,
      status: "ok",
      lastError: null,
    });
    return await ctx.db.insert("automations", {
      organizationId: teamId,
      name: "Weekly clips",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: [],
      edges: [],
      hookToken: "token",
      nextRunAt: null,
      createdBy: olu.id,
      updatedAt: Date.now(),
    });
  });
  const runId = await t.run((ctx) =>
    ctx.db.insert("runs", {
      organizationId: teamId,
      automationId,
      automationName: "Weekly clips",
      status: "failed",
      triggerKind: "webhook",
      trigger: {},
      nodes: [],
      edges: [],
      error: "boom",
      startedBy: null,
      finishedAt: Date.now(),
    }),
  );
  const raise = (kind: "run_failed" | "approval_waiting", recipients?: string[]) =>
    t.run((ctx) =>
      notify(ctx, {
        organizationId: teamId,
        kind,
        recipients,
        runId,
        automationId,
        automationName: "Weekly clips",
        stepName: "Captions",
        message: "The toolkit could not be reached.",
        retries: 1,
      }),
    );
  return { t, teamId, olu, ana, ben, automationId, runId, raise };
}

const emailed = (t: Backend, alertId: Id<"alerts">) =>
  t.query(internal.email.alertRecipients, { alertId }).then((found) => found?.recipients.sort());

describe("notification settings", () => {
  test("start with everything on, bell and email (finished runs aside), emails as they happen", async () => {
    const { ana, teamId } = await team();
    const settings = await ana.as.query(api.notifications.get, { organizationId: teamId });
    expect(settings.kinds.map((entry) => entry.kind)).toEqual([
      "run_failed",
      "approval_waiting",
      "approval_timed_out",
      "mention",
      "client_feedback",
      "ready_for_review",
      "clip_finished",
    ]);
    // Finished runs start off for the bell and email; every other kind starts on.
    expect(
      settings.kinds
        .filter((entry) => entry.kind !== "clip_finished")
        .every((entry) => entry.bell && entry.email),
    ).toBe(true);
    expect(settings).toMatchObject({ emailTiming: "now", digestHour: 8, emailReady: true });
  });

  test("are each person's own, per team", async () => {
    const { t, ana, ben, teamId } = await team();
    await ana.as.mutation(api.notifications.set, {
      organizationId: teamId,
      kind: "run_failed",
      channel: "email",
      enabled: false,
    });
    const other = await addTeam(t, "Other team");
    await t.run(async (ctx) => {
      await ctx.db.insert("notificationPreferences", {
        organizationId: other,
        userId: ana.id,
        kinds: { run_failed: { bell: false } },
      });
    });
    const mine = await ana.as.query(api.notifications.get, { organizationId: teamId });
    const theirs = await ben.as.query(api.notifications.get, { organizationId: teamId });
    expect(mine.kinds[0]).toMatchObject({ kind: "run_failed", bell: true, email: false });
    expect(theirs.kinds[0]).toMatchObject({ kind: "run_failed", bell: true, email: true });
  });

  test("only members can read or change them", async () => {
    const { t, teamId } = await team();
    const stranger = await addPerson(t, "Stranger");
    await expect(
      stranger.as.query(api.notifications.get, { organizationId: teamId }),
    ).rejects.toThrow();
    await expect(
      stranger.as.mutation(api.notifications.set, {
        organizationId: teamId,
        kind: "mention",
        channel: "bell",
        enabled: false,
      }),
    ).rejects.toThrow();
  });

  test("refuse an hour that is not one, and a made-up time zone", async () => {
    const { ana, teamId } = await team();
    await expect(
      ana.as.mutation(api.notifications.setEmailTiming, {
        organizationId: teamId,
        emailTiming: "daily",
        digestHour: 25,
      }),
    ).rejects.toThrow("Pick an hour of the day.");
    await expect(
      ana.as.mutation(api.notifications.setEmailTiming, {
        organizationId: teamId,
        emailTiming: "daily",
        timeZone: "Mars/Olympus_Mons",
      }),
    ).rejects.toThrow("That time zone is not one we know.");
  });
});

describe("the bell follows the settings", () => {
  test("a kind switched off for the bell is not listed or counted", async () => {
    const { ana, ben, teamId, raise } = await team();
    await raise("run_failed");
    await ana.as.mutation(api.notifications.set, {
      organizationId: teamId,
      kind: "run_failed",
      channel: "bell",
      enabled: false,
    });
    expect(await ana.as.query(api.alerts.list, { organizationId: teamId })).toEqual({
      alerts: [],
      unseen: 0,
    });
    const bens = await ben.as.query(api.alerts.list, { organizationId: teamId });
    expect(bens.unseen).toBe(1);
    expect(bens.alerts[0].href).toMatch(/^\/automations\/.+\/runs\/.+$/);
  });

  test("switching the bell off leaves the email on, and the other way round", async () => {
    const { t, ana, teamId, raise } = await team();
    await ana.as.mutation(api.notifications.set, {
      organizationId: teamId,
      kind: "run_failed",
      channel: "bell",
      enabled: false,
    });
    const alertId = await raise("run_failed");
    expect(await emailed(t, alertId)).toContain("ana.reyes@example.test");
  });
});

describe("emails follow the settings", () => {
  test("a kind switched off by email is not emailed to that person", async () => {
    const { t, ana, teamId, raise } = await team();
    await ana.as.mutation(api.notifications.set, {
      organizationId: teamId,
      kind: "run_failed",
      channel: "email",
      enabled: false,
    });
    const alertId = await raise("run_failed");
    expect(await emailed(t, alertId)).toEqual(["ben.cho@example.test", "olu.bello@example.test"]);
  });

  test("a daily summary holds failures back but still sends approvals at once", async () => {
    const { t, ana, teamId, raise } = await team();
    await ana.as.mutation(api.notifications.setEmailTiming, {
      organizationId: teamId,
      emailTiming: "daily",
      digestHour: 9,
      timeZone: "America/Los_Angeles",
    });
    expect(await emailed(t, await raise("run_failed"))).not.toContain("ana.reyes@example.test");
    expect(await emailed(t, await raise("approval_waiting", [ana.id]))).toEqual([
      "ana.reyes@example.test",
    ]);
  });
});

describe("the daily summary", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("goes out at the person's hour with what they chose, once", async () => {
    // 2026-11-17 16:30 UTC is 08:30 in Los Angeles.
    vi.setSystemTime(new Date("2026-11-17T06:00:00Z"));
    const { t, ana, ben, teamId, raise } = await team();
    await ana.as.mutation(api.notifications.setEmailTiming, {
      organizationId: teamId,
      emailTiming: "daily",
      digestHour: 8,
      timeZone: "America/Los_Angeles",
    });
    await ana.as.mutation(api.notifications.set, {
      organizationId: teamId,
      kind: "mention",
      channel: "email",
      enabled: false,
    });
    vi.setSystemTime(new Date("2026-11-17T07:00:00Z"));
    await raise("run_failed");
    await raise("run_failed", [ben.id]); // not for Ana

    // Not her hour yet: nothing is booked.
    vi.setSystemTime(new Date("2026-11-17T15:00:00Z"));
    await t.mutation(internal.notifications.bookDigests, {});
    expect(await digestsBooked(t)).toHaveLength(0);

    vi.setSystemTime(new Date("2026-11-17T16:00:00Z"));
    await t.mutation(internal.notifications.bookDigests, {});
    const booked = await digestsBooked(t);
    expect(booked).toHaveLength(1);
    const found = await t.query(internal.email.digestFor, booked[0].args[0] as never);
    expect(found?.email).toBe("ana.reyes@example.test");
    expect(found?.items.map((item) => item.title)).toEqual(["Weekly clips failed"]);
    expect(found?.items[0].url).toMatch(/^http:\/\/localhost:3000\/automations\//);

    // The same hour again books nothing more.
    await t.mutation(internal.notifications.bookDigests, {});
    expect(await digestsBooked(t)).toHaveLength(1);
  });
});

describe("the rules", () => {
  test("defaults stand until a person changes them", () => {
    expect(wants(null, "mention", "email")).toBe(true);
    expect(wants({ kinds: { mention: { bell: false } } }, "mention", "bell")).toBe(false);
    expect(wants({ kinds: { mention: { bell: false } } }, "mention", "email")).toBe(true);
  });

  test("the hour is read in the person's own time zone", () => {
    const at = Date.parse("2026-11-17T16:00:00Z");
    expect(hourIn("America/Los_Angeles", at)).toBe(8);
    expect(hourIn("Asia/Tokyo", at)).toBe(1);
    expect(hourIn(undefined, at)).toBe(16);
    expect(hourIn("Nowhere/Special", at)).toBe(16);
  });

  test("a summary is not due twice in the same hour", () => {
    const at = Date.parse("2026-11-17T16:00:00Z");
    const daily = { emailTiming: "daily" as const, digestHour: 8, timeZone: "America/Los_Angeles" };
    expect(digestDue(daily, at)).toBe(true);
    expect(digestDue({ ...daily, lastDigestAt: at - 3_600_000 }, at)).toBe(false);
    expect(digestDue({ ...daily, emailTiming: "now" }, at)).toBe(false);
  });

  test("a mention links to its thread in the review", () => {
    expect(
      alertHref({
        kind: "mention",
        reviewId: "r1" as Id<"reviews">,
        clipId: "c1" as Id<"reviewClips">,
        commentId: "m1" as Id<"reviewComments">,
      }),
    ).toBe("/review/r1?clip=c1&comment=m1");
  });

  test("client feedback links to the review, and to the thread when there is one", () => {
    expect(alertHref({ kind: "client_feedback", reviewId: "r1" as Id<"reviews"> })).toBe(
      "/review/r1",
    );
    expect(
      alertHref({
        kind: "client_feedback",
        reviewId: "r1" as Id<"reviews">,
        clipId: "c1" as Id<"reviewClips">,
        commentId: "m1" as Id<"reviewComments">,
      }),
    ).toBe("/review/r1?clip=c1&comment=m1");
  });
});

async function digestsBooked(t: Backend) {
  return (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter(
    (job) => job.name === "email:sendDigest",
  );
}
