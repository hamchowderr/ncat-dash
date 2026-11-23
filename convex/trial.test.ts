import { afterEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { startRun } from "./lib/runner";
import { DEFAULT_TRIAL_DAYS, TRIAL_ENDED_MESSAGE, daysLeft, trialDays } from "./lib/trial";
import { addPerson, addTeam, backend } from "./test.setup";

// The 3-day free trial on the hosted dashboard: no card, it starts when the team is made,
// and once it is over nothing new runs while everything made is kept.
const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  delete process.env.NCAT_EDITION;
  delete process.env.TRIAL_DAYS;
  delete process.env.BUY_URL;
  vi.useRealTimers();
});

async function setUp(edition: "hosted" | "self-hosted" = "hosted") {
  process.env.NCAT_EDITION = edition;
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  const automation = await t.run((ctx) =>
    ctx.db.insert("automations", {
      organizationId: team,
      name: "Clips",
      enabled: false,
      trigger: { kind: "manual" },
      nodes: [
        { id: "cut", kind: "step", stepId: "video-thumbnail", input: {}, position: { x: 0, y: 0 } },
      ],
      edges: [],
      hookToken: "token-clips",
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    }),
  );
  const start = () =>
    t.run(async (ctx) => {
      const found = (await ctx.db.get(automation))!;
      return await startRun(
        ctx,
        found,
        "manual",
        { file_url: "https://files.example/a.mp4" },
        maya.id,
      );
    });
  const status = () => maya.as.query(api.trial.status, { organizationId: team });
  return { t, team, maya, outsider, automation, start, status };
}

describe("how long a trial lasts", () => {
  test("3 days on the hosted edition, none on a self-hosted copy", () => {
    process.env.NCAT_EDITION = "hosted";
    expect(DEFAULT_TRIAL_DAYS).toBe(3);
    expect(trialDays({})).toBe(3);
    expect(trialDays({ TRIAL_DAYS: "7" })).toBe(7);
    expect(trialDays({ TRIAL_DAYS: "0" })).toBeNull();
    expect(trialDays({ TRIAL_DAYS: "soon" })).toBeNull();
    process.env.NCAT_EDITION = "self-hosted";
    expect(trialDays({ TRIAL_DAYS: "3" })).toBeNull();
  });

  test("days left round up, so the last hours still read as a day", () => {
    const now = 1_000_000;
    expect(daysLeft(now + 3 * DAY, now)).toBe(3);
    expect(daysLeft(now + 2 * DAY + 1, now)).toBe(3);
    expect(daysLeft(now + 60_000, now)).toBe(1);
    expect(daysLeft(now - 1, now)).toBe(0);
  });
});

describe("a new team's trial", () => {
  test("starts when the team is made and lasts 3 days", async () => {
    const { t, team, status } = await setUp();
    expect(await status()).toEqual({ kind: "none" });
    const before = Date.now();
    await t.mutation(internal.trial.begin, { organizationId: team });
    const trial = await status();
    expect(trial.kind).toBe("trial");
    if (trial.kind !== "trial") return;
    expect(trial.daysLeft).toBe(3);
    expect(trial.endsAt).toBeGreaterThanOrEqual(before + 3 * DAY);
    expect(trial.buyUrl).toBeNull();
  });

  test("is not made twice, and never on a self-hosted copy", async () => {
    const { t, team } = await setUp("self-hosted");
    await t.mutation(internal.trial.begin, { organizationId: team });
    expect(await t.run((ctx) => ctx.db.query("teamTrials").collect())).toHaveLength(0);
    process.env.NCAT_EDITION = "hosted";
    await t.mutation(internal.trial.begin, { organizationId: team });
    await t.mutation(internal.trial.begin, { organizationId: team });
    expect(await t.run((ctx) => ctx.db.query("teamTrials").collect())).toHaveLength(1);
  });

  test("is only told to the team's own members", async () => {
    const { team, outsider } = await setUp();
    await expect(outsider.as.query(api.trial.status, { organizationId: team })).rejects.toThrow(
      "You are not on this team.",
    );
  });

  test("a team made before trials were on has none, and keeps running", async () => {
    const { start, status } = await setUp();
    expect(await status()).toEqual({ kind: "none" });
    expect((await start()).ok).toBe(true);
  });
});

describe("when the trial is over", () => {
  async function ended() {
    const setup = await setUp();
    process.env.BUY_URL = "https://ncat-site.vercel.app/#early";
    await setup.t.mutation(internal.trial.begin, { organizationId: setup.team });
    await setup.t.run(async (ctx) => {
      const [trial] = await ctx.db.query("teamTrials").collect();
      await ctx.db.patch(trial._id, { endsAt: Date.now() - 1 });
    });
    return setup;
  }

  test("runs still start during the trial", async () => {
    const { t, team, start } = await setUp();
    await t.mutation(internal.trial.begin, { organizationId: team });
    expect((await start()).ok).toBe(true);
  });

  test("nothing new starts, and the team is told why and where to buy", async () => {
    const { start, status } = await ended();
    expect(await start()).toEqual({ ok: false, message: TRIAL_ENDED_MESSAGE });
    const trial = await status();
    expect(trial).toMatchObject({
      kind: "ended",
      daysLeft: 0,
      buyUrl: "https://ncat-site.vercel.app/#early",
    });
  });

  test("everything the team made is kept", async () => {
    const { t, automation } = await ended();
    expect(await t.run((ctx) => ctx.db.get(automation as Id<"automations">))).not.toBeNull();
  });

  test("once marked paid, runs start again", async () => {
    const { t, team, start, status } = await ended();
    expect(await t.mutation(internal.trial.markPaid, { organizationId: team })).toBe(true);
    expect(await status()).toEqual({ kind: "paid" });
    expect((await start()).ok).toBe(true);
  });

  test("extending gives the team the days from now", async () => {
    const { t, team, start, status } = await ended();
    const endsAt = await t.mutation(internal.trial.extend, { organizationId: team, days: 2 });
    expect(endsAt).toBeGreaterThan(Date.now() + 2 * DAY - 60_000);
    expect(await status()).toMatchObject({ kind: "trial", daysLeft: 2 });
    expect((await start()).ok).toBe(true);
    expect(await t.mutation(internal.trial.extend, { organizationId: team, days: 0 })).toBeNull();
  });

  test("a BUY_URL that is not a web address is not shown", async () => {
    const { status } = await ended();
    process.env.BUY_URL = "javascript:alert(1)";
    expect(await status()).toMatchObject({ buyUrl: null });
  });
});

describe("making a team", () => {
  test("the new team's trial and welcome are set off by the team being made", async () => {
    const { createAuthOptions } = await import("./auth");
    const scheduled: unknown[] = [];
    const ctx = {
      runMutation: vi.fn(),
      runQuery: vi.fn(),
      runAction: vi.fn(),
      scheduler: { runAfter: vi.fn(async (...args: unknown[]) => scheduled.push(args)) },
    };
    const options = createAuthOptions(ctx as never);
    const organization = options.plugins.find(
      (plugin) => plugin.id === "organization",
    ) as unknown as {
      options: {
        organizationHooks: {
          afterCreateOrganization: (data: {
            organization: { id: string };
            user: { id: string; email: string };
          }) => Promise<void>;
        };
      };
    };
    await organization.options.organizationHooks.afterCreateOrganization({
      organization: { id: "team_9" },
      user: { id: "user_1", email: "maya@example.com" },
    });
    expect(scheduled).toEqual([
      [
        0,
        internal.trial.begin,
        { organizationId: "team_9", ownerId: "user_1", ownerEmail: "maya@example.com" },
      ],
      // And a welcome, once the trial has started.
      [5_000, internal.email.sendWelcome, { organizationId: "team_9", userId: "user_1" }],
    ]);
  });
});
