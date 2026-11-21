import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/crypto";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const TOOLKIT = "https://toolkit.example";
const VIDEO = "https://files.example/uploads/skate_park.mp4";
const SONG = "https://files.example/uploads/upbeat.mp3";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

type Node = { id: string; stepId: string; input?: Record<string, unknown> };

/** A team with a toolkit, a manager, and an automation of `nodes` in a row. */
async function setUp(nodes: Node[]) {
  // Scheduled dispatches stay put, so each test sends its job once, itself, however
  // slow the machine: otherwise the scheduler can send the same job a second time.
  vi.useFakeTimers({ toFake: ["setTimeout"] });
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
      name: "Skate edit",
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

/** A stand-in toolkit that hears a beat every half second from 0.25 s, unless `noBeats`. */
function toolkit({ noBeats = false } = {}) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
    const answer = (response: unknown) =>
      new Response(JSON.stringify({ code: 200, response }), { status: 200 });
    if (path === "/v1/media/metadata") {
      return answer({ duration: 30, has_video: false, has_audio: true });
    }
    if (path === "/v1/audio/beats") {
      if (noBeats) return new Response("Not Found", { status: 404 });
      const beats = Array.from({ length: 59 }, (_, i) => 0.25 + i * 0.5);
      return answer({
        tempo: 120,
        steadiness: 0.9,
        beats,
        downbeats: beats.filter((_, i) => i % 4 === 0),
      });
    }
    return new Response(JSON.stringify({ code: 202, job_id: "tk-1" }), { status: 202 });
  });
  return calls;
}

const NODES: Node[] = [{ id: "beat_1", stepId: "recipe-beat-cut", input: { length: 8 } }];

async function withMusic(ready: Awaited<ReturnType<typeof setUp>>) {
  await ready.t.run((ctx) =>
    ctx.db.insert("teamSettings", {
      organizationId: ready.team,
      maxParallelJobs: 4,
      music: [{ name: "Upbeat", file: SONG }],
    }),
  );
}

describe("Cut To The Beat in a run", () => {
  test("uses the team's music, reads its beat, then cuts every two beats", async () => {
    const ready = await setUp(NODES);
    await withMusic(ready);
    const calls = toolkit();
    const runId = await ready.start({ file_url: VIDEO, file_name: "Skate park.mp4" });
    const [job] = await ready.jobsOf(runId, "beat_1");
    expect(job.input).toMatchObject({ music_url: SONG, video_urls: [{ video_url: VIDEO }] });
    await ready.t.action(internal.jobs.dispatch, { jobId: job._id });
    expect(calls.map((call) => call.path)).toEqual([
      "/v1/media/metadata",
      "/v1/audio/beats",
      "/v1/ffmpeg/compose",
    ]);
    expect(calls[1].body).toMatchObject({ media_url: SONG });
    const compose = JSON.stringify(calls[2].body);
    // Eight one-second pieces, the song starting on its first beat.
    expect(compose).toContain("trim=start_frame=210:end_frame=240");
    expect(compose).toContain("concat=n=8:v=1:a=0");
    expect(compose).toContain("atrim=start=0.25:duration=8");
    const after = await ready.t.run((ctx) => ctx.db.get(job._id));
    expect(after?.status).toBe("running");
  });

  test("a toolkit without the beat finder fails the step plainly, without trying again", async () => {
    const ready = await setUp(NODES);
    await withMusic(ready);
    const calls = toolkit({ noBeats: true });
    const runId = await ready.start({ file_url: VIDEO });
    const [job] = await ready.jobsOf(runId, "beat_1");
    await ready.t.action(internal.jobs.dispatch, { jobId: job._id });
    expect(calls.map((call) => call.path)).not.toContain("/v1/ffmpeg/compose");
    const after = await ready.t.run((ctx) => ctx.db.get(job._id));
    expect(after?.status).toBe("failed");
    expect(after?.error).toMatch(/beat could not be read\. Update your toolkit/);
    const run = await ready.maya.as.query(api.runs.get, { runId });
    expect(run?.status).toBe("failed");
  });
});
