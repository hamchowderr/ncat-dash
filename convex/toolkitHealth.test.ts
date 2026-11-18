import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/crypto";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const REPORT = {
  build_number: 220,
  cpus: 4,
  cpu_percent: 37.5,
  memory: { used: 2 * 2 ** 30, limit: 16 * 2 ** 30 },
  disk: { free: 50 * 2 ** 30, total: 100 * 2 ** 30 },
  uptime_seconds: 5400,
  queue: { shared: true, waiting: 3, workers: 4, busy: 4 },
  jobs: { queued: 3, running: 4, done: 120 },
};

afterEach(() => vi.unstubAllGlobals());

async function setUp({ toolkit = true } = {}) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  const apiKeyCipher = await encryptSecret("toolkit-key");
  if (toolkit) {
    await t.run((ctx) =>
      ctx.db.insert("toolkitConnections", {
        organizationId: team,
        baseUrl: "https://toolkit.example",
        apiKeyCipher,
        apiKeyHint: "-key",
        status: "ok",
        buildNumber: "219",
        lastCheckedAt: 0,
        lastError: null,
        createdBy: maya.id,
      }),
    );
  }
  return { t, team, maya, outsider };
}

describe("the toolkit's health", () => {
  test("reads the toolkit's load with the team's own key", async () => {
    const { team, maya } = await setUp();
    const calls: { url: string; key: string | null }[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        key: new Headers(init?.headers).get("X-API-Key"),
      });
      return new Response(JSON.stringify({ code: 200, response: REPORT }), { status: 200 });
    });
    const reading = await maya.as.action(api.toolkitHealth.read, { organizationId: team });
    expect(calls).toEqual([
      { url: "https://toolkit.example/v1/toolkit/health", key: "toolkit-key" },
    ]);
    expect(reading).toMatchObject({
      ok: true,
      health: {
        buildNumber: "220",
        cpus: 4,
        cpuPercent: 37.5,
        memory: REPORT.memory,
        disk: REPORT.disk,
        uptimeSeconds: 5400,
        queue: REPORT.queue,
        jobs: REPORT.jobs,
      },
    });
  });

  test("says when the toolkit build has no health request, or does not answer", async () => {
    const { team, maya } = await setUp();
    vi.stubGlobal("fetch", async () => new Response("Not Found", { status: 404 }));
    expect(await maya.as.action(api.toolkitHealth.read, { organizationId: team })).toMatchObject({
      ok: false,
      reason: "no_health",
    });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    expect(await maya.as.action(api.toolkitHealth.read, { organizationId: team })).toMatchObject({
      ok: false,
      reason: "unreachable",
    });
  });

  test("without a toolkit there is nothing to read, and other teams cannot read it", async () => {
    const empty = await setUp({ toolkit: false });
    expect(
      await empty.maya.as.action(api.toolkitHealth.read, { organizationId: empty.team }),
    ).toMatchObject({ ok: false, reason: "no_toolkit" });
    const { team, outsider } = await setUp();
    await expect(
      outsider.as.action(api.toolkitHealth.read, { organizationId: team }),
    ).rejects.toThrow();
    await expect(
      outsider.as.query(api.toolkitHealth.activity, { organizationId: team }),
    ).rejects.toThrow();
  });
});

describe("what the toolkit is working on for the team", () => {
  test("lists each job in flight with its run, where it is, and the last day", async () => {
    const { t, team, maya } = await setUp();
    // Allow one job at once, so a second one is held back.
    await t.run((ctx) =>
      ctx.db.insert("teamSettings", { organizationId: team, maxParallelJobs: 1 } as never),
    );
    const runId = await t.run(async (ctx) => {
      const automationId = await ctx.db.insert("automations", {
        organizationId: team,
        name: "Weekly clips",
        enabled: true,
        trigger: { kind: "webhook" },
        nodes: [
          {
            id: "a",
            kind: "step",
            stepId: "video-thumbnail",
            label: "Cover picture",
            input: {},
            position: { x: 0, y: 0 },
          },
          { id: "b", kind: "step", stepId: "media-metadata", input: {}, position: { x: 0, y: 99 } },
        ],
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: maya.id,
        updatedAt: Date.now(),
      });
      const started = await startRun(
        ctx,
        (await ctx.db.get(automationId))!,
        "webhook",
        { file_url: "https://files.example/a.mp4" },
        maya.id,
      );
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
    const jobs = await t.run(async (ctx) => {
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect();
      return steps.flatMap((step) => step.jobIds);
    });
    // The first was handed to the toolkit and accepted.
    await t.mutation(internal.jobs.markRunning, { jobId: jobs[0], toolkitJobId: "tk-1" });
    // A job from earlier today that finished.
    await t.run(async (ctx) => {
      const old = await ctx.db.get(jobs[0]);
      await ctx.db.insert("jobs", {
        ...old!,
        _id: undefined,
        _creationTime: undefined,
        status: "done",
        startedAt: 1_000,
        finishedAt: 61_000,
        runStepId: undefined,
      } as never);
    });

    const activity = await maya.as.query(api.toolkitHealth.activity, { organizationId: team });
    expect(activity.limit).toBe(1);
    expect(activity.counts).toEqual({ toolkit: 1, sending: 0, held: 1 });
    const byId = Object.fromEntries(activity.jobs.map((job: { _id: string }) => [job._id, job]));
    expect(byId[jobs[0] as Id<"jobs">]).toMatchObject({
      step: "Cover picture",
      state: "toolkit",
      run: { runId, automationName: "Weekly clips" },
    });
    expect(byId[jobs[1] as Id<"jobs">]).toMatchObject({ step: "Media metadata", state: "held" });
    expect(activity.lastDay).toEqual({ done: 1, failed: 0, typicalMs: 60_000 });
  });
});
