import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { type ChatAlert, type ChatSender, type ChatTarget, SENDERS } from "./lib/chatAlerts";
import { wants } from "./lib/notifications";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

/**
 * A stand-in chat app: members in `linked` have linked it, and everything it is asked to
 * send or change is written down.
 */
function standIn(linked: Set<string>) {
  const sent: { alert: ChatAlert; target: ChatTarget }[] = [];
  const settled: { ref: string; text: string; outcome: string }[] = [];
  const sender: ChatSender = {
    app: "telegram",
    isLinked: async (_ctx, _organizationId, userId) => linked.has(userId),
    targets: async (_ctx, _organizationId, userIds) =>
      userIds
        .filter((id) => linked.has(id))
        .map((userId) => ({ userId, address: `chat-${userId}` })),
    send: async (_ctx, alert, target) => {
      sent.push({ alert, target });
      return { ref: `${target.address}:${sent.length}`, text: alert.title };
    },
    settle: async (_ctx, message, outcome) => {
      settled.push({ ...message, outcome });
    },
  };
  SENDERS.push(sender);
  return { sent, settled };
}

// Scheduled work (sending, changing messages) runs only when a test lets it.
beforeEach(() => {
  // Only the stand-in below; each real app has its own tests.
  SENDERS.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  SENDERS.length = 0;
  vi.useRealTimers();
});

/** A team of three with an automation that is one Approval step, and a run waiting on it. */
async function waiting(reviewers?: "ana") {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const olu = await addPerson(t, "Olu Bello", [team], "owner");
  const ana = await addPerson(t, "Ana Reyes", [team]);
  const ben = await addPerson(t, "Ben Cho", [team]);
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
          input: reviewers === "ana" ? { reviewers: [ana.id] } : {},
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
    const started = await startRun(
      ctx,
      automation!,
      "webhook",
      { file_url: "https://files.example/interview.mp4" },
      null,
    );
    if (!started.ok) throw new Error(started.message);
    return started.runId;
  });
  const state = () =>
    t.run(async (ctx) => {
      const step = (await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .unique())!;
      const alerts = await ctx.db
        .query("alerts")
        .withIndex("by_organization", (q) => q.eq("organizationId", team))
        .collect();
      const messages = await ctx.db.query("chatAlertMessages").collect();
      return { step, alerts, messages };
    });
  return { t, team, olu, ana, ben, runId, state };
}

/** Lets everything booked so far run, such as sending alerts and changing messages. */
async function settleDown(t: ReturnType<typeof backend>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("alerts in chat apps", () => {
  test("go to the members who linked the app and want that kind there", async () => {
    const { t, team, olu, ana, ben, state } = await waiting();
    const app = standIn(new Set([olu.id, ana.id]));
    // Ana does not want approvals in this app; Ben never linked it.
    await ana.as.mutation(api.notifications.set, {
      organizationId: team,
      kind: "approval_waiting",
      channel: "telegram",
      enabled: false,
    });
    await settleDown(t);
    expect(app.sent.map((one) => one.target.userId)).toEqual([olu.id]);
    expect(app.sent[0].alert).toMatchObject({
      kind: "approval_waiting",
      title: "Weekly clips is waiting for your approval (Approval)",
      actions: [
        { id: "approve", label: "Approve" },
        { id: "send_back", label: "Send back" },
      ],
    });
    expect(app.sent[0].alert.link).toMatch(/^http:\/\/localhost:3000\/automations\/.+\/runs\//);
    const { messages, step } = await state();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ app: "telegram", userId: olu.id, runStepId: step._id });
    void ben;
  });

  test("with no chat app set up, nothing is sent and nothing breaks", async () => {
    const { t, state } = await waiting();
    await settleDown(t);
    expect((await state()).messages).toEqual([]);
  });

  test("a button press approves as that member, and every message then says so", async () => {
    const { t, olu, ana, state } = await waiting();
    const app = standIn(new Set([olu.id, ana.id]));
    const { step } = await state();
    await settleDown(t);
    const answer = await t.mutation(internal.chatAlerts.decideFromChat, {
      runStepId: step._id,
      userId: ana.id,
      decision: "approve",
      app: "telegram",
    });
    expect(answer).toEqual({ ok: true, message: "Approved." });
    expect((await state()).step).toMatchObject({ status: "done", decidedBy: ana.id });

    await settleDown(t);
    expect(app.settled.map((one) => one.outcome)).toEqual([
      "Approved by Ana Reyes.",
      "Approved by Ana Reyes.",
    ]);
    expect((await state()).messages.every((message) => message.settledAt !== undefined)).toBe(true);

    // Pressing again, or someone else pressing late, changes nothing.
    const late = await t.mutation(internal.chatAlerts.decideFromChat, {
      runStepId: step._id,
      userId: olu.id,
      decision: "send_back",
      app: "telegram",
    });
    expect(late).toEqual({ ok: false, message: "Someone has already decided this." });
    expect((await state()).step.status).toBe("done");
  });

  test("deciding on the run page also changes the chat messages", async () => {
    const { t, olu, state } = await waiting();
    const app = standIn(new Set([olu.id]));
    const { step } = await state();
    await settleDown(t);
    await olu.as.mutation(api.runs.decide, { runStepId: step._id, approved: false });
    await settleDown(t);
    expect(app.settled).toEqual([expect.objectContaining({ outcome: "Sent back by Olu Bello." })]);
  });

  test("someone the approval did not ask is told who can decide", async () => {
    const { t, ben, state } = await waiting("ana");
    const { step } = await state();
    const answer = await t.mutation(internal.chatAlerts.decideFromChat, {
      runStepId: step._id,
      userId: ben.id,
      decision: "approve",
      app: "telegram",
    });
    expect(answer).toEqual({
      ok: false,
      message: "Only Ana Reyes, or a team owner or admin, can decide this.",
    });
    expect((await state()).step.status).toBe("waiting_approval");
  });

  test("someone not on the team cannot decide", async () => {
    const { t, state } = await waiting();
    const outsider = await addPerson(t, "Kai Stone", []);
    const { step } = await state();
    const answer = await t.mutation(internal.chatAlerts.decideFromChat, {
      runStepId: step._id,
      userId: outsider.id,
      decision: "approve",
      app: "telegram",
    });
    expect(answer).toEqual({ ok: false, message: "You are no longer on this team." });
  });
});

describe("chat app notification settings", () => {
  test("each app starts on for approvals, failures, mentions and finished runs", () => {
    for (const app of ["telegram", "slack", "discord", "teams"] as const) {
      expect(wants(null, "approval_waiting", app)).toBe(true);
      expect(wants(null, "run_failed", app)).toBe(true);
      expect(wants(null, "mention", app)).toBe(true);
      expect(wants(null, "clip_finished", app)).toBe(true);
      expect(wants(null, "client_feedback", app)).toBe(false);
    }
    // Finished runs are not under the bell or emailed unless someone asks.
    expect(wants(null, "clip_finished", "bell")).toBe(false);
    expect(wants(null, "clip_finished", "email")).toBe(false);
  });

  test("list the apps a person linked, with a switch per kind", async () => {
    const { team, olu, ana } = await waiting();
    standIn(new Set([olu.id]));
    const forOlu = await olu.as.query(api.notifications.get, { organizationId: team });
    expect(forOlu.chatApps).toEqual(["telegram"]);
    expect(forOlu.kinds.find((entry) => entry.kind === "approval_waiting")?.telegram).toBe(true);
    const forAna = await ana.as.query(api.notifications.get, { organizationId: team });
    expect(forAna.chatApps).toEqual([]);
  });
});

describe("a finished run", () => {
  async function finished(test?: string) {
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const olu = await addPerson(t, "Olu Bello", [team], "owner");
    const runId = await t.run(async (ctx) => {
      const automationId = await ctx.db.insert("automations", {
        organizationId: team,
        name: "Shorts",
        enabled: true,
        trigger: { kind: "webhook" },
        nodes: [],
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: olu.id,
        updatedAt: Date.now(),
      });
      return await ctx.db.insert("runs", {
        organizationId: team,
        automationId,
        automationName: "Shorts",
        status: "done",
        triggerKind: "webhook",
        trigger: {},
        nodes: [],
        edges: [],
        error: null,
        startedBy: null,
        finishedAt: Date.now(),
        ...(test ? { test } : {}),
      });
    });
    const alerts = () => t.run((ctx) => ctx.db.query("alerts").collect());
    return { t, runId, alerts };
  }

  test("tells the team how many new files are in Files", async () => {
    const { t, runId, alerts } = await finished();
    await t.mutation(internal.alerts.runFinished, { runId, count: 3 });
    expect(await alerts()).toEqual([
      expect.objectContaining({
        kind: "clip_finished",
        automationName: "Shorts",
        message: "3 new files are ready in Files.",
      }),
    ]);
  });

  test("says nothing for a test run or a run that kept no files", async () => {
    const tried = await finished("node-1");
    await tried.t.mutation(internal.alerts.runFinished, { runId: tried.runId, count: 2 });
    expect(await tried.alerts()).toEqual([]);
    const empty = await finished();
    await empty.t.mutation(internal.alerts.runFinished, { runId: empty.runId, count: 0 });
    expect(await empty.alerts()).toEqual([]);
  });
});
