import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const FILE = "https://files.example/station_interview.mp4";

/**
 * A team of four (an owner, two members, and Ana who may be named as reviewer), an
 * automation that is one Approval step with the given settings, and a run waiting on it.
 */
async function waitingOn(input: Record<string, unknown>, reviewers?: "ana" | "gone") {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const olu = await addPerson(t, "Olu Bello", [team], "owner");
  const ana = await addPerson(t, "Ana Reyes", [team]);
  const ben = await addPerson(t, "Ben Cho", [team]);
  const named =
    reviewers === "ana" ? [ana.id] : reviewers === "gone" ? ["someone-who-left"] : undefined;
  const runId = await t.run(async (ctx) => {
    const automationId = await ctx.db.insert("automations", {
      organizationId: team,
      name: "Weekly clips",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: [
        {
          id: "approval",
          kind: "approval",
          input: { ...input, ...(named ? { reviewers: named } : {}) },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      hookToken: "token",
      nextRunAt: null,
      createdBy: olu.id,
      updatedAt: Date.now(),
    });
    const automation = await ctx.db.get(automationId);
    const started = await startRun(ctx, automation!, "webhook", { file_url: FILE }, null);
    if (!started.ok) throw new Error(started.message);
    return started.runId;
  });
  const state = () =>
    t.run(async (ctx) => {
      const step = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .unique();
      return {
        run: await ctx.db.get(runId),
        step: step!,
        alerts: await ctx.db
          .query("alerts")
          .withIndex("by_organization", (q) => q.eq("organizationId", team))
          .collect(),
        timers: (await ctx.db.system.query("_scheduled_functions").collect()).filter(
          (job) => job.name === "runs:approvalTimeUp",
        ),
      };
    });
  const kinds = async (person: { as: typeof olu.as }) =>
    (await person.as.query(api.alerts.list, { organizationId: team })).alerts.map(
      (alert) => alert.kind,
    );
  return { t, team, olu, ana, ben, runId, state, kinds };
}

describe("an Approval step with nobody picked", () => {
  test("everyone on the team is told and anyone can decide", async () => {
    const { olu, ana, ben, runId, state, kinds } = await waitingOn({});
    const { alerts, timers } = await state();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("approval_waiting");
    expect(alerts[0].recipients).toBeUndefined();
    expect(timers).toEqual([]);
    for (const person of [olu, ana, ben]) expect(await kinds(person)).toEqual(["approval_waiting"]);

    const run = await ben.as.query(api.runs.get, { runId });
    expect(run?.steps[0].approval).toMatchObject({
      asked: [],
      mayDecide: true,
      decideBy: null,
    });

    const { step } = await state();
    await ben.as.mutation(api.runs.decide, { runStepId: step._id, approved: true });
    const after = await state();
    expect(after.step).toMatchObject({ status: "done", decidedBy: ben.id });
    // The alert asking for a decision goes once it is decided.
    expect(after.alerts).toEqual([]);
  });
});

describe("an Approval step with a named reviewer", () => {
  test("only the reviewer is told", async () => {
    const { ana, ben, olu, state, kinds, team } = await waitingOn({}, "ana");
    const { alerts } = await state();
    expect(alerts[0].recipients).toEqual([ana.id]);
    expect(await kinds(ana)).toEqual(["approval_waiting"]);
    expect(await kinds(ben)).toEqual([]);
    expect(await kinds(olu)).toEqual([]);

    const forAna = await ana.as.query(api.runs.waitingApprovals, { organizationId: team });
    expect(forAna[0]).toMatchObject({ forYou: true, mayDecide: true, asked: ["Ana Reyes"] });
    const forBen = await ben.as.query(api.runs.waitingApprovals, { organizationId: team });
    expect(forBen[0]).toMatchObject({ forYou: false, mayDecide: false });
  });

  test("someone else on the team is refused, with who can decide", async () => {
    const { ben, state } = await waitingOn({}, "ana");
    const { step } = await state();
    await expect(
      ben.as.mutation(api.runs.decide, { runStepId: step._id, approved: true }),
    ).rejects.toThrow("Only Ana Reyes, or a team owner or admin, can decide this.");
    expect((await state()).step.status).toBe("waiting_approval");
  });

  test("a team owner can always decide", async () => {
    const { olu, state, runId } = await waitingOn({}, "ana");
    expect((await olu.as.query(api.runs.get, { runId }))?.steps[0].approval?.mayDecide).toBe(true);
    const { step } = await state();
    await olu.as.mutation(api.runs.decide, { runStepId: step._id, approved: false });
    const after = await state();
    expect(after.step).toMatchObject({ status: "failed", decidedBy: olu.id });
    expect(after.run?.status).toBe("failed");
    const decided = await olu.as.query(api.runs.get, { runId });
    expect(decided?.steps[0].approval?.decidedBy).toBe("Olu Bello");
  });

  test("when the reviewer has left the team, anyone can decide again", async () => {
    const { ben, state } = await waitingOn({}, "gone");
    const { alerts, step } = await state();
    expect(alerts[0].recipients).toBeUndefined();
    await ben.as.mutation(api.runs.decide, { runStepId: step._id, approved: true });
    expect((await state()).step.status).toBe("done");
  });
});

describe("a time limit", () => {
  test("books a decision for when the time is up", async () => {
    const before = Date.now();
    const { state, runId, ana } = await waitingOn({ timeLimit: 2, timeLimitUnit: "hours" });
    const { step, timers, alerts } = await state();
    expect(step.decideBy).toBeGreaterThanOrEqual(before + 2 * 3_600_000);
    expect(timers).toHaveLength(1);
    expect(timers[0].args[0]).toEqual({ runStepId: step._id });
    expect(alerts[0].message).toBe("If nobody decides within 2 hours, it is rejected by itself.");
    const run = await ana.as.query(api.runs.get, { runId });
    expect(run?.steps[0].approval).toMatchObject({ whenTimeUp: "reject" });
  });

  test("rejects by itself and says so under the bell", async () => {
    const { t, state, ana, kinds } = await waitingOn({ timeLimit: 1, timeLimitUnit: "days" });
    await timeUp(t, (await state()).step._id);
    const { step, run, alerts } = await state();
    expect(step).toMatchObject({
      status: "failed",
      decidedAutomatically: true,
      error: "Nobody decided within 1 day, so it was rejected.",
    });
    expect(step.decidedBy).toBeUndefined();
    expect(run?.status).toBe("failed");
    expect(alerts.map((alert) => alert.kind)).toEqual(["run_failed"]);
    expect(await kinds(ana)).toEqual(["run_failed"]);
  });

  test("approves by itself when set to, and the run carries on", async () => {
    const { t, state } = await waitingOn({
      timeLimit: 3,
      timeLimitUnit: "hours",
      whenTimeUp: "approve",
    });
    await timeUp(t, (await state()).step._id);
    const { step, run, alerts } = await state();
    expect(step).toMatchObject({ status: "done", decidedAutomatically: true, outputs: [FILE] });
    expect(run?.status).toBe("done");
    expect(alerts).toEqual([]);
  });

  test("does nothing once someone has decided", async () => {
    const { t, state, ana } = await waitingOn({ timeLimit: 1, timeLimitUnit: "hours" });
    const { step } = await state();
    await ana.as.mutation(api.runs.decide, { runStepId: step._id, approved: true });
    await timeUp(t, step._id);
    expect((await state()).step).toMatchObject({ status: "done", decidedBy: ana.id });
  });

  test("an automation with a limit over 6 days cannot be switched on", async () => {
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const olu = await addPerson(t, "Olu Bello", [team], "owner");
    const automationId = await t.run((ctx) =>
      ctx.db.insert("automations", {
        organizationId: team,
        name: "Too long",
        enabled: false,
        trigger: { kind: "webhook" },
        nodes: [
          {
            id: "approval",
            kind: "approval",
            input: { timeLimit: 7, timeLimitUnit: "days" },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: olu.id,
        updatedAt: Date.now(),
      }),
    );
    const described = await olu.as.query(api.automations.describe, { automationId });
    expect(described.problems.map((problem) => problem.message)).toContain(
      "Approval: The time limit can be 6 days at most, because links to files stop working after a week.",
    );
    // The agent is given the team so it can name reviewers.
    expect(described.team?.map((member) => member.name)).toEqual(["Olu Bello"]);
  });
});

describe("approval emails", () => {
  test("go only to the people asked who still want them", async () => {
    const { t, team, ben, state } = await waitingOn({});
    await ben.as.mutation(api.email.setAlertEmails, {
      organizationId: team,
      enabled: false,
      kind: "approval_waiting",
    });
    const { alerts } = await state();
    const found = await t.query(internal.email.alertRecipients, { alertId: alerts[0]._id });
    expect(found?.recipients.sort()).toEqual(["ana.reyes@example.test", "olu.bello@example.test"]);

    // Turning approval emails off leaves failure emails on.
    const prefs = await ben.as.query(api.email.get, { organizationId: team });
    expect(prefs).toMatchObject({ approvalEmails: false, alertEmails: true });
  });

  test("with a named reviewer, only the reviewer is emailed", async () => {
    const { t, state } = await waitingOn({}, "ana");
    const { alerts } = await state();
    const found = await t.query(internal.email.alertRecipients, { alertId: alerts[0]._id });
    expect(found?.recipients).toEqual(["ana.reyes@example.test"]);
  });
});

function timeUp(t: ReturnType<typeof backend>, runStepId: Id<"runSteps">) {
  return t.mutation(internal.runs.approvalTimeUp, { runStepId });
}
