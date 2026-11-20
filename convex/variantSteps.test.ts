import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/crypto";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const TOOLKIT = "https://toolkit.example";
const VIDEO = "https://files.example/uploads/boots_ad.mp4";
const made = (job: string, n: number) =>
  `https://files.example/teams/x/${job}-5b1f-4c3e-9a77-0d2f1b6e8a10_output_${n}.mp4`;

afterEach(() => vi.unstubAllGlobals());

type Node = { id: string; stepId: string; input?: Record<string, unknown> };

/** A team with a toolkit, a manager, and an automation of `nodes` in a row. */
async function setUp(nodes: Node[]) {
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  process.env.CONVEX_SITE_URL = "https://dash.example";
  const apiKeyCipher = await encryptSecret("toolkit-key");
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const automationId = await t.run(async (ctx) => {
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
    return ctx.db.insert("automations", {
      organizationId: team,
      name: "Ad cuts",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: nodes.map((node, index) => ({
        id: node.id,
        kind: "step" as const,
        stepId: node.stepId,
        input: node.input ?? {},
        position: { x: index * 300, y: 0 },
      })),
      edges: nodes
        .slice(1)
        .map((node, index) => ({ id: `e${index}`, source: nodes[index].id, target: node.id })),
      hookToken: "token",
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    });
  });
  const start = (trigger: Record<string, unknown>) =>
    t.run(async (ctx) => {
      const automation = (await ctx.db.get(automationId))!;
      const started = await startRun(ctx, automation, "webhook", trigger, maya.id);
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
  const jobsOf = (runId: Id<"runs">, nodeId: string) =>
    t.run(async (ctx) => {
      const step = (await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .filter((q) => q.eq(q.field("nodeId"), nodeId))
        .first())!;
      const jobs = await Promise.all(step.jobIds.map((id) => ctx.db.get(id)));
      return jobs.filter((job) => job !== null);
    });
  return { t, team, maya, start, jobsOf };
}

/** A stand-in toolkit: metadata answers with `facts`, silence with one pause, the rest 202. */
function toolkit(facts: Record<string, unknown>) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
    if (path === "/v1/media/metadata") {
      return new Response(JSON.stringify({ code: 200, response: facts }), { status: 200 });
    }
    if (path === "/v1/media/silence") {
      const response = [{ start: "00:00:04.600", end: "00:00:05.200", duration: 0.6 }];
      return new Response(JSON.stringify({ code: 200, response }), { status: 200 });
    }
    return new Response(JSON.stringify({ code: 202, job_id: "tk-1" }), { status: 202 });
  });
  return calls;
}

const FACTS = {
  duration: 40,
  width: 1080,
  height: 1920,
  video_fps: 30,
  has_video: true,
  has_audio: true,
};

describe("length cuts in a run", () => {
  test("reads the video's pauses first and cuts in them", async () => {
    const { t, start, jobsOf } = await setUp([
      { id: "lengths_1", stepId: "recipe-length-cuts", input: { lengths: "6, 15" } },
    ]);
    const calls = toolkit(FACTS);
    const runId = await start({ file_url: VIDEO });
    const [job] = await jobsOf(runId, "lengths_1");
    await t.action(internal.jobs.dispatch, { jobId: job._id });
    const mine = calls.filter((call) => JSON.stringify(call.body).includes(VIDEO));
    expect(mine.map((call) => call.path)).toEqual([
      "/v1/media/metadata",
      "/v1/media/silence",
      "/v1/ffmpeg/compose",
    ]);
    // The 6 s cut ends just into the pause at 4.6 s, not on the sixth second mid-word.
    const filters = JSON.stringify(mine[2].body);
    expect(filters).toContain("end=4.85");
    expect((mine[2].body.outputs as unknown[]).length).toBe(2);
  });

  test("names each file for its length, then its shape, all the way to the run page", async () => {
    const { t, maya, start, jobsOf } = await setUp([
      { id: "lengths_1", stepId: "recipe-length-cuts", input: { lengths: "15, 6" } },
      { id: "shape_1", stepId: "recipe-blur-fill", input: { width: 1080, height: 1350 } },
    ]);
    toolkit(FACTS);
    const runId = await start({ file_url: VIDEO, file_name: "Boots ad.mp4" });
    const [cuts] = await jobsOf(runId, "lengths_1");
    const cutFiles = [made("aaaaaaa1", 0), made("aaaaaaa1", 1)];
    await t.mutation(internal.jobs.finish, { jobId: cuts._id, ok: true, result: cutFiles });
    const shapes = await jobsOf(runId, "shape_1");
    expect(shapes).toHaveLength(2);
    const shapeFiles: string[] = [];
    for (const [index, job] of shapes.entries()) {
      const file = made(`bbbbbbb${index}`, 0);
      shapeFiles.push(file);
      await t.mutation(internal.jobs.finish, { jobId: job._id, ok: true, result: file });
    }
    const run = await maya.as.query(api.runs.get, { runId });
    expect(run?.outputNames[cutFiles[0]]).toBe("Boots ad 6s");
    expect(run?.outputNames[cutFiles[1]]).toBe("Boots ad 15s");
    const names = shapes.map((job, index) => [
      (job.input as { video_url: string }).video_url,
      run?.outputNames[shapeFiles[index]],
    ]);
    expect(Object.fromEntries(names)).toEqual({
      [cutFiles[0]]: "Boots ad 6s_4x5",
      [cutFiles[1]]: "Boots ad 15s_4x5",
    });
  });

  test("a shape on its own adds no code and names files as before", async () => {
    const { t, maya, start, jobsOf } = await setUp([{ id: "shape_1", stepId: "recipe-blur-fill" }]);
    toolkit(FACTS);
    const runId = await start({ file_url: VIDEO, file_name: "Boots ad.mp4" });
    const [job] = await jobsOf(runId, "shape_1");
    const file = made("ccccccc1", 0);
    await t.mutation(internal.jobs.finish, { jobId: job._id, ok: true, result: file });
    const run = await maya.as.query(api.runs.get, { runId });
    expect(run?.outputNames[file]).toBe("Boots ad clip");
    const labels = await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("runSteps")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .first()
        )?.labels,
    );
    expect(labels ?? null).toBeNull();
  });
});
