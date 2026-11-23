import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { encryptSecret } from "./lib/crypto";
import { startRun } from "./lib/runner";
import { STUCK_AFTER_MS, STUCK_ERROR } from "./stuck";
import { addPerson, addTeam, backend } from "./test.setup";

afterEach(() => {
  vi.useRealTimers();
});

// A webhook brings a video in and Best moments works on it. Nothing is sent anywhere:
// held clocks keep every booked call from running, so each test sets the step up by hand.
async function setUp() {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  process.env.CONVEX_SITE_URL = "https://dash.example";
  const apiKeyCipher = await encryptSecret("toolkit-key");
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const runId = await t.run(async (ctx) => {
    await ctx.db.insert("toolkitConnections", {
      organizationId: team,
      baseUrl: "https://toolkit.example",
      apiKeyCipher,
      apiKeyHint: "abcd",
      status: "ok",
      buildNumber: null,
      lastCheckedAt: 0,
      lastError: null,
      createdBy: maya.id,
    });
    const automationId = await ctx.db.insert("automations", {
      organizationId: team,
      name: "Podcast clips",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: [
        {
          id: "split",
          kind: "step",
          stepId: "video-split",
          input: { splits: [{ start: "00:00:00", end: "00:00:06" }] },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      hookToken: "token",
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    });
    const automation = (await ctx.db.get(automationId))!;
    const started = await startRun(
      ctx,
      automation,
      "webhook",
      { file_url: "https://files.example/in.mp4" },
      maya.id,
    );
    if (!started.ok) throw new Error(started.message);
    return started.runId;
  });
  const look = () =>
    t.run(async (ctx) => {
      const step = (await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .first())!;
      return { run: (await ctx.db.get(runId))!, step };
    });
  /** The step started `ago` back; its job is in `job` state and finished then too. */
  const leave = async (
    ago: number,
    job: Doc<"jobs">["status"],
    more: Partial<Doc<"runSteps">> = {},
  ) => {
    const { step } = await look();
    const at = Date.now() - ago;
    await t.run(async (ctx) => {
      await ctx.db.patch(step._id, { startedAt: at, ...more });
      await ctx.db.patch(step.jobIds[0], {
        status: job,
        finishedAt: job === "done" || job === "failed" ? at : null,
      });
    });
  };
  const check = () => t.mutation(internal.stuck.endStuckSteps, {});
  return { t, look, leave, check };
}

describe("a step that stopped moving", () => {
  test("is ended as failed, and the run with it, once nothing has been heard for an hour", async () => {
    const { look, leave, check } = await setUp();
    // Its job finished long ago, but whatever was to move the step on never did.
    await leave(STUCK_AFTER_MS + 60_000, "done", { stage: "listen" });
    await check();
    const { run, step } = await look();
    expect(step).toMatchObject({ status: "failed", error: STUCK_ERROR });
    expect(run.status).toBe("failed");
  });

  test("is left alone while one of its jobs is still going", async () => {
    const { look, leave, check } = await setUp();
    await leave(STUCK_AFTER_MS * 3, "running");
    await check();
    expect((await look()).step.status).toBe("running");
  });

  test("is left alone while it waits to try again", async () => {
    const { look, leave, check } = await setUp();
    await leave(STUCK_AFTER_MS * 3, "failed", { retryAt: Date.now() + 60_000, retries: 1 });
    await check();
    expect((await look()).step.status).toBe("running");
  });

  test("is left alone when its last news is recent", async () => {
    const { look, leave, check } = await setUp();
    await leave(STUCK_AFTER_MS / 2, "done", { stage: "listen" });
    await check();
    expect((await look()).step.status).toBe("running");
  });

  test("is left alone while it holds a Wait", async () => {
    const { look, leave, check } = await setUp();
    await leave(STUCK_AFTER_MS * 3, "done", { stage: "wait" });
    await check();
    expect((await look()).step.status).toBe("running");
  });
});
