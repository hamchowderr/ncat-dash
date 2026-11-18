import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ASK_AFTER_MS, LOST_AFTER_MS, LOST_JOB_ERROR } from "./jobs";
import { encryptSecret } from "./lib/crypto";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const FILE = "https://files.example/uploads/station_interview.mp4";
const TOOLKIT = "https://toolkit.example";

/**
 * A stand-in for the toolkit's POST /v1/toolkit/job/status. `answer` is the job's record
 * as the toolkit keeps it, or null for a job it has never heard of.
 */
function toolkitKnows(answer: { job_status: string; response?: unknown } | null) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    // Any other request is a step being handed over: the toolkit takes it.
    if (url !== `${TOOLKIT}/v1/toolkit/job/status`) {
      return new Response(JSON.stringify({ code: 202, job_id: "tk-next" }), { status: 202 });
    }
    asked.push(JSON.parse(String(init?.body)).job_id);
    if (!answer) {
      return new Response(JSON.stringify({ code: 404, response: { error: "Job not found" } }), {
        status: 404,
      });
    }
    return new Response(
      JSON.stringify({ code: 200, response: { job_id: "tk-split", response: null, ...answer } }),
      { status: 200 },
    );
  });
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Weekly clips: a webhook brings a video in, Split video cuts it, then Thumbnail.
async function setUp() {
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  process.env.CONVEX_SITE_URL = "https://dash.example";
  const apiKeyCipher = await encryptSecret("toolkit-key");
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const runId = await t.run(async (ctx) => {
    await ctx.db.insert("toolkitConnections", {
      organizationId: team,
      baseUrl: TOOLKIT,
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
      name: "Weekly clips",
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
        {
          id: "thumbnail",
          kind: "step",
          stepId: "video-thumbnail",
          input: {},
          position: { x: 220, y: 0 },
        },
      ],
      edges: [{ id: "e1", source: "split", target: "thumbnail" }],
      hookToken: "token",
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    });
    const automation = (await ctx.db.get(automationId))!;
    const started = await startRun(ctx, automation, "webhook", { file_url: FILE }, maya.id);
    if (!started.ok) throw new Error(started.message);
    return started.runId;
  });

  const splitJob = () =>
    t.run(async (ctx) => {
      const step = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .filter((q) => q.eq(q.field("nodeId"), "split"))
        .first();
      return (await ctx.db.get(step!.jobIds[0]))!;
    });
  // The toolkit took the job (answered 202) `ago` milliseconds back; no webhook since.
  const handedOver = async (ago: number) => {
    const job = await splitJob();
    await t.run((ctx) =>
      ctx.db.patch(job._id, {
        status: "running",
        toolkitJobId: "tk-split",
        dispatchedAt: Date.now() - ago,
        startedAt: Date.now() - ago,
      }),
    );
    return job._id;
  };
  const look = () =>
    t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect();
      return { run, byNode: Object.fromEntries(steps.map((step) => [step.nodeId, step])) };
    });
  const asks = () =>
    t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (call) => call.name.includes("askToolkit") && call.state.kind === "pending",
      ),
    );
  return { t, splitJob, handedOver, look, asks };
}

describe("a job whose result is late", () => {
  test("is not asked about while it is still young", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { t, handedOver, asks } = await setUp();
    await handedOver(ASK_AFTER_MS / 2);
    await t.mutation(internal.jobs.checkLate, {});
    expect(await asks()).toHaveLength(0);
  });

  test("is asked about once it is late, and not again straight away", async () => {
    // Held clocks keep the booked question from running, so it can be looked at.
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { t, handedOver, splitJob, asks } = await setUp();
    const jobId = await handedOver(ASK_AFTER_MS + 1000);
    await t.mutation(internal.jobs.checkLate, {});
    const booked = await asks();
    expect(booked).toHaveLength(1);
    expect(booked[0].args[0]).toEqual({ jobId });
    expect((await splitJob()).lastAskedAt).toBeGreaterThan(0);

    await t.mutation(internal.jobs.checkLate, {});
    expect(await asks()).toHaveLength(1);
  });

  test("takes the result the toolkit kept when its webhook never arrived, and the run moves on", async () => {
    const { t, handedOver, splitJob, look } = await setUp();
    const jobId = await handedOver(ASK_AFTER_MS + 1000);
    const asked = toolkitKnows({
      job_status: "done",
      response: {
        endpoint: "/v1/video/split",
        code: 200,
        response: [{ file_url: "https://files.example/out/split_1.mp4" }],
        message: "success",
      },
    });
    await t.action(internal.jobs.askToolkit, { jobId });
    expect(asked).toEqual(["tk-split"]);
    expect(await splitJob()).toMatchObject({
      status: "done",
      outputs: ["https://files.example/out/split_1.mp4"],
    });
    const after = await look();
    expect(after.byNode.split.status).toBe("done");
    expect(after.byNode.thumbnail.status).toBe("running");
  });

  test("fails with the toolkit's own words when the toolkit kept a failure", async () => {
    const { t, handedOver, splitJob } = await setUp();
    const jobId = await handedOver(ASK_AFTER_MS + 1000);
    toolkitKnows({
      job_status: "done",
      response: { code: 500, response: null, message: { error: "Could not download the file." } },
    });
    await t.action(internal.jobs.askToolkit, { jobId });
    expect(await splitJob()).toMatchObject({
      status: "failed",
      error: "Could not download the file.",
    });
  });

  test("is left alone while the toolkit is still working on it", async () => {
    const { t, handedOver, splitJob } = await setUp();
    const jobId = await handedOver(LOST_AFTER_MS * 3);
    toolkitKnows({ job_status: "running" });
    await t.action(internal.jobs.askToolkit, { jobId });
    expect((await splitJob()).status).toBe("running");
  });

  test("is left alone when the toolkit cannot be reached", async () => {
    const { t, handedOver, splitJob } = await setUp();
    const jobId = await handedOver(LOST_AFTER_MS * 3);
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await t.action(internal.jobs.askToolkit, { jobId });
    expect((await splitJob()).status).toBe("running");
  });

  test("fails as lost, so it can be tried again, when the toolkit has no record of it", async () => {
    const { t, handedOver, splitJob, look } = await setUp();
    const jobId = await handedOver(LOST_AFTER_MS + 1000);
    toolkitKnows(null);
    await t.action(internal.jobs.askToolkit, { jobId });
    const job = await splitJob();
    expect(job).toMatchObject({ status: "failed", error: LOST_JOB_ERROR });
    expect(job.permanent).toBeUndefined();
    // The run does not hang: the step books another try, with the reason on it.
    expect((await look()).byNode.split).toMatchObject({ retries: 1, retryError: LOST_JOB_ERROR });
  });

  test("is not called lost straight away; the toolkit may still be writing it down", async () => {
    const { t, handedOver, splitJob } = await setUp();
    const jobId = await handedOver(ASK_AFTER_MS + 1000);
    toolkitKnows(null);
    await t.action(internal.jobs.askToolkit, { jobId });
    expect((await splitJob()).status).toBe("running");
  });

  test("a webhook that arrives after the answer changes nothing", async () => {
    const { t, handedOver, splitJob } = await setUp();
    const jobId = await handedOver(ASK_AFTER_MS + 1000);
    toolkitKnows({
      job_status: "done",
      response: { code: 200, response: [{ file_url: "https://files.example/out/a.mp4" }] },
    });
    await t.action(internal.jobs.askToolkit, { jobId });
    const job = await splitJob();
    const outcome = await t.mutation(internal.jobs.finish, {
      jobId: jobId as Id<"jobs">,
      token: job.webhookToken,
      ok: false,
      error: "late",
    });
    expect(outcome).toBe("ignored");
    expect((await splitJob()).status).toBe("done");
  });
});
