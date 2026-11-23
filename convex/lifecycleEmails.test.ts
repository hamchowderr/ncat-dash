import { afterEach, describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

// The emails that follow a person's first days: a welcome when they make their first
// team, and, on the hosted edition, a word a day before the free trial ends and when it has.
const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  delete process.env.NCAT_EDITION;
});

async function scheduled(t: ReturnType<typeof backend>, name: string) {
  return await t.run(async (ctx) => {
    const all = await ctx.db.system.query("_scheduled_functions").collect();
    return all.filter((job) => job.name.includes(name));
  });
}

describe("welcome", () => {
  test("goes to someone on their first team, saying how long the trial runs", async () => {
    process.env.NCAT_EDITION = "hosted";
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
    await t.mutation(internal.trial.begin, { organizationId: team, ownerId: maya.id });
    const found = await t.query(internal.email.welcomeFor, {
      organizationId: team,
      userId: maya.id,
    });
    expect(found).toEqual({
      email: "maya.ortiz@example.test",
      name: "Maya Ortiz",
      teamName: "Salt House",
      trialDays: 3,
    });
  });

  test("says nothing of a trial when there is none, and skips a second team", async () => {
    const t = backend();
    const first = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [first], "owner");
    expect(
      (await t.query(internal.email.welcomeFor, { organizationId: first, userId: maya.id }))
        ?.trialDays,
    ).toBeNull();

    const second = await addTeam(t, "Second Studio");
    const dev = await addPerson(t, "Dev Patel", [first, second], "owner");
    expect(
      await t.query(internal.email.welcomeFor, { organizationId: second, userId: dev.id }),
    ).toBeNull();
  });
});

describe("trial reminders", () => {
  test("a fresh trial books one a day before it ends and one when it has", async () => {
    process.env.NCAT_EDITION = "hosted";
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
    await t.mutation(internal.trial.begin, { organizationId: team, ownerId: maya.id });
    const trial = await t.run((ctx) => ctx.db.query("teamTrials").first());
    const booked = await scheduled(t, "sendTrialReminder");
    expect(booked.map((job) => [job.args[0].kind, job.scheduledTime])).toEqual([
      ["ending", trial!.endsAt - DAY],
      ["ended", trial!.endsAt],
    ]);

    const found = await t.query(internal.email.trialReminderFor, {
      organizationId: team,
      endsAt: trial!.endsAt,
    });
    expect(found).toEqual({
      email: "maya.ortiz@example.test",
      name: "Maya Ortiz",
      teamName: "Salt House",
    });
  });

  test("says nothing once the team has bought, or its trial moved", async () => {
    process.env.NCAT_EDITION = "hosted";
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
    await t.mutation(internal.trial.begin, { organizationId: team, ownerId: maya.id });
    const trial = (await t.run((ctx) => ctx.db.query("teamTrials").first()))!;
    expect(
      await t.query(internal.email.trialReminderFor, {
        organizationId: team,
        endsAt: trial.endsAt + 1,
      }),
    ).toBeNull();
    await t.mutation(internal.trial.markPaid, { organizationId: team });
    expect(
      await t.query(internal.email.trialReminderFor, {
        organizationId: team,
        endsAt: trial.endsAt,
      }),
    ).toBeNull();
  });

  test("a second team sharing its owner's trial books none", async () => {
    process.env.NCAT_EDITION = "hosted";
    const t = backend();
    const first = await addTeam(t, "Salt House");
    const second = await addTeam(t, "Second Studio");
    const maya = await addPerson(t, "Maya Ortiz", [first, second], "owner");
    await t.mutation(internal.trial.begin, {
      organizationId: first,
      ownerId: maya.id,
      ownerEmail: "maya.ortiz@example.test",
    });
    await t.mutation(internal.trial.begin, {
      organizationId: second,
      ownerId: maya.id,
      ownerEmail: "maya.ortiz@example.test",
    });
    expect(await scheduled(t, "sendTrialReminder")).toHaveLength(2);
  });
});
