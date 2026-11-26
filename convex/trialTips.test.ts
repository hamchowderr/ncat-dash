import { afterEach, describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";
import { tipTimes } from "./trialTips";

// The tips between the welcome and the trial's end: each gives one next step, and only
// goes while that step is still undone, once, to the team's owner.
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

afterEach(() => {
  delete process.env.NCAT_EDITION;
});

type Backend = ReturnType<typeof backend>;

async function freshTrial(t: Backend) {
  process.env.NCAT_EDITION = "hosted";
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  await t.mutation(internal.trial.begin, { organizationId: team, ownerId: maya.id });
  const trial = (await t.run((ctx) => ctx.db.query("teamTrials").first()))!;
  return { team, maya, trial };
}

async function booked(t: Backend) {
  return await t.run(async (ctx) => {
    const all = await ctx.db.system.query("_scheduled_functions").collect();
    return all
      .filter((job) => job.name.includes("sendTrialTip"))
      .map((job) => [job.args[0].tip, job.scheduledTime] as const);
  });
}

async function upload(t: Backend, team: string, by: string, purpose?: "brand") {
  await t.run((ctx) =>
    ctx.db.insert("uploads", {
      organizationId: team,
      key: `uploads/${Math.random()}`,
      fileName: "talk.mp4",
      contentType: "video/mp4",
      size: 1000,
      status: "ready",
      createdBy: by,
      ...(purpose ? { purpose } : {}),
    }),
  );
}

async function automation(t: Backend, team: string, by: string, enabled: boolean) {
  await t.run((ctx) =>
    ctx.db.insert("automations", {
      organizationId: team,
      name: "Clips",
      enabled,
      trigger: { kind: "manual" },
      nodes: [],
      edges: [],
      hookToken: `token-${Math.random()}`,
      nextRunAt: null,
      createdBy: by,
      updatedAt: Date.now(),
    }),
  );
}

/** Moves the trial's end, as if the clock had moved on past it. */
async function endTrial(t: Backend) {
  await t.run(async (ctx) => {
    const trial = (await ctx.db.query("teamTrials").first())!;
    await ctx.db.patch(trial._id, { endsAt: Date.now() - 1 });
  });
}

describe("when tips are booked", () => {
  test("a 3-day trial books the first-upload nudge, day one, and two come-backs", () => {
    const start = 1_000_000;
    const end = start + 3 * DAY;
    expect(tipTimes(start, end)).toEqual([
      { tip: "first_upload", at: start + 3 * HOUR },
      { tip: "every_upload", at: start + DAY },
      { tip: "come_back", at: end + 4 * DAY },
      { tip: "come_back_later", at: end + 11 * DAY },
    ]);
  });

  test("a 1-day trial skips day one, which would land beside the ends-tomorrow note", () => {
    const start = 1_000_000;
    expect(tipTimes(start, start + DAY).map((entry) => entry.tip)).toEqual([
      "first_upload",
      "come_back",
      "come_back_later",
    ]);
  });

  test("a fresh trial books them; a second team sharing the owner's trial books none", async () => {
    process.env.NCAT_EDITION = "hosted";
    const t = backend();
    const first = await addTeam(t, "Salt House");
    const second = await addTeam(t, "Second Studio");
    const maya = await addPerson(t, "Maya Ortiz", [first, second], "owner");
    const begin = (organizationId: string) =>
      t.mutation(internal.trial.begin, {
        organizationId,
        ownerId: maya.id,
        ownerEmail: "maya.ortiz@example.test",
      });
    await begin(first);
    const trial = (await t.run((ctx) => ctx.db.query("teamTrials").first()))!;
    expect(await booked(t)).toEqual(
      tipTimes(trial.startedAt, trial.endsAt).map(({ tip, at }) => [tip, at]),
    );
    await begin(second);
    expect(await booked(t)).toHaveLength(4);
  });
});

describe("who a tip goes to", () => {
  test("the first-upload nudge goes to the owner until something is uploaded", async () => {
    const t = backend();
    const { team, maya } = await freshTrial(t);
    const ask = () =>
      t.query(internal.trialTips.tipFor, { organizationId: team, tip: "first_upload" });
    expect(await ask()).toEqual({
      userId: maya.id,
      email: "maya.ortiz@example.test",
      name: "Maya Ortiz",
      teamName: "Salt House",
    });
    // A logo added in Settings is not a video.
    await upload(t, team, maya.id, "brand");
    expect(await ask()).not.toBeNull();
    await upload(t, team, maya.id);
    expect(await ask()).toBeNull();
  });

  test("the every-upload tip needs an upload and no automation switched on", async () => {
    const t = backend();
    const { team, maya } = await freshTrial(t);
    const ask = () =>
      t.query(internal.trialTips.tipFor, { organizationId: team, tip: "every_upload" });
    expect(await ask()).toBeNull();
    await upload(t, team, maya.id);
    await automation(t, team, maya.id, false);
    expect(await ask()).not.toBeNull();
    await automation(t, team, maya.id, true);
    expect(await ask()).toBeNull();
  });

  test("come-backs only go once the trial is over and nothing was bought", async () => {
    const t = backend();
    const { team } = await freshTrial(t);
    const ask = () =>
      t.query(internal.trialTips.tipFor, { organizationId: team, tip: "come_back" });
    expect(await ask()).toBeNull();
    await endTrial(t);
    expect(await ask()).not.toBeNull();
    await t.mutation(internal.trial.markPaid, { organizationId: team });
    expect(await ask()).toBeNull();
  });

  test("a tip goes once", async () => {
    const t = backend();
    const { team } = await freshTrial(t);
    await t.mutation(internal.trialTips.recordSent, { organizationId: team, tip: "first_upload" });
    expect(
      await t.query(internal.trialTips.tipFor, { organizationId: team, tip: "first_upload" }),
    ).toBeNull();
  });

  test("switching tips off in Settings stops them, but not the thanks", async () => {
    const t = backend();
    const { team, maya } = await freshTrial(t);
    await t.run((ctx) =>
      ctx.db.insert("notificationPreferences", {
        organizationId: team,
        userId: maya.id,
        kinds: { trial_tips: { email: false } },
      }),
    );
    expect(
      await t.query(internal.trialTips.tipFor, { organizationId: team, tip: "first_upload" }),
    ).toBeNull();
    expect(
      await t.query(internal.trialTips.tipFor, { organizationId: team, tip: "thanks" }),
    ).toBeNull();
    await t.mutation(internal.trial.markPaid, { organizationId: team });
    expect(
      await t.query(internal.trialTips.tipFor, { organizationId: team, tip: "thanks" }),
    ).not.toBeNull();
  });
});

describe("booked by what happens", () => {
  test("buying books the thanks once", async () => {
    const t = backend();
    const { team } = await freshTrial(t);
    await t.mutation(internal.trial.markPaid, { organizationId: team });
    await t.mutation(internal.trial.markPaid, { organizationId: team });
    const thanks = (await booked(t)).filter(([tip]) => tip === "thanks");
    expect(thanks).toHaveLength(1);
  });

  test("the first run with files books clips-ready, but not after it went", async () => {
    const t = backend();
    const { team, maya } = await freshTrial(t);
    const runId = await t.run(async (ctx) => {
      const automationId = await ctx.db.insert("automations", {
        organizationId: team,
        name: "Clips",
        enabled: true,
        trigger: { kind: "manual" },
        nodes: [],
        edges: [],
        hookToken: "token-run",
        nextRunAt: null,
        createdBy: maya.id,
        updatedAt: Date.now(),
      });
      return await ctx.db.insert("runs", {
        organizationId: team,
        automationId,
        automationName: "Clips",
        status: "done",
        triggerKind: "manual",
        trigger: {},
        nodes: [],
        edges: [],
        error: null,
        startedBy: maya.id,
        finishedAt: Date.now(),
      });
    });
    await t.mutation(internal.alerts.runFinished, { runId, count: 3 });
    expect((await booked(t)).filter(([tip]) => tip === "clips_ready")).toHaveLength(1);

    await t.mutation(internal.trialTips.recordSent, { organizationId: team, tip: "clips_ready" });
    await t.mutation(internal.alerts.runFinished, { runId, count: 3 });
    expect((await booked(t)).filter(([tip]) => tip === "clips_ready")).toHaveLength(1);
  });
});

describe("in Settings > Notifications", () => {
  test("the trial tips row shows only while the team is on a trial it has not bought", async () => {
    const t = backend();
    const { team, maya } = await freshTrial(t);
    const rows = async () =>
      (await maya.as.query(api.notifications.get, { organizationId: team })).kinds.map(
        (entry) => entry.kind,
      );
    expect(await rows()).toContain("trial_tips");
    await t.mutation(internal.trial.markPaid, { organizationId: team });
    expect(await rows()).not.toContain("trial_tips");
  });
});
