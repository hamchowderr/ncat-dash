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

  test("a shape on its own adds no code and names files by what it did", async () => {
    const { t, maya, start, jobsOf } = await setUp([{ id: "shape_1", stepId: "recipe-blur-fill" }]);
    toolkit(FACTS);
    const runId = await start({ file_url: VIDEO, file_name: "Boots ad.mp4" });
    const [job] = await jobsOf(runId, "shape_1");
    const file = made("ccccccc1", 0);
    await t.mutation(internal.jobs.finish, { jobId: job._id, ok: true, result: file });
    const run = await maya.as.query(api.runs.get, { runId });
    expect(run?.outputNames[file]).toBe("Boots ad with blurred background");
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

describe("keeping the paid-ad disclosure in a run", () => {
  /** "word" timings as the toolkit's transcript has them, spread from `from` to `to`. */
  const said = (sentence: string, from: number, to: number) => {
    const parts = sentence.split(" ");
    const step = (to - from) / parts.length;
    return parts.map((word, index) => ({
      word: ` ${word}`,
      start: from + index * step,
      end: from + (index + 1) * step - 0.05,
    }));
  };
  const SEGMENTS = [
    { words: said("Stop scrolling right now.", 0.2, 2.7) },
    { words: said("I tried this serum for thirty days and loved it.", 3.5, 8.5) },
    { words: said("This is a paid partnership with Boots.", 9.3, 10.9) },
    { words: said("Link below.", 11, 11.8) },
  ];
  const AD = { ...FACTS, duration: 12 };
  const STEPS: Node[] = [
    {
      id: "lengths_1",
      stepId: "recipe-length-cuts",
      input: { lengths: "6", disclosure: "Keep it in every cut" },
    },
  ];

  test("hears the video first, then every cut keeps the line, shown on the run page", async () => {
    const { t, maya, start, jobsOf } = await setUp(STEPS);
    const calls = toolkit(AD);
    const runId = await start({ file_url: VIDEO });
    const [hearing] = await jobsOf(runId, "lengths_1");
    expect(hearing.stepId).toBe("media-transcribe");
    expect(hearing.input).toMatchObject({ media_url: VIDEO, word_timestamps: true });

    await t.mutation(internal.jobs.finish, {
      jobId: hearing._id,
      ok: true,
      result: { segments: SEGMENTS },
    });
    await t.action(internal.disclosure.hear, { runStepId: hearing.runStepId! });

    const [cut] = await jobsOf(runId, "lengths_1");
    expect(cut.stepId).toBe("recipe-length-cuts");
    await t.action(internal.jobs.dispatch, { jobId: cut._id });
    const compose = calls.find((call) => call.path === "/v1/ffmpeg/compose")!;
    // The 6 s cut is the start, then the disclosure from 9.15 to 11 s.
    expect(JSON.stringify(compose.body)).toContain("trim=start=9.15:end=11");

    const run = await maya.as.query(api.runs.get, { runId });
    expect(run?.steps[0].disclosures).toEqual([
      { source: VIDEO, text: "This is a paid partnership with Boots." },
    ]);
  });

  test("a video heard before is not transcribed again, and one with no disclosure says so", async () => {
    const { t, team, maya, start, jobsOf } = await setUp(STEPS);
    toolkit(AD);
    await t.mutation(internal.moments.saveWords, {
      organizationId: team,
      source: VIDEO,
      duration: 12,
      words: [
        { t: "I", s: 0.2, e: 0.4 },
        { t: "added", s: 0.5, e: 0.9 },
        { t: "this", s: 1, e: 1.3 },
        { t: "daily.", s: 1.4, e: 2 },
      ],
    });
    const runId = await start({ file_url: VIDEO });
    const [cut] = await jobsOf(runId, "lengths_1");
    expect(cut.stepId).toBe("recipe-length-cuts");
    const run = await maya.as.query(api.runs.get, { runId });
    expect(run?.steps[0].disclosures).toEqual([{ source: VIDEO, text: null }]);
  });

  test("with it off, nothing is transcribed and the run is as before", async () => {
    const { start, jobsOf } = await setUp([
      { id: "lengths_1", stepId: "recipe-length-cuts", input: { lengths: "6" } },
    ]);
    toolkit(AD);
    const runId = await start({ file_url: VIDEO });
    const jobs = await jobsOf(runId, "lengths_1");
    expect(jobs.map((job) => job.stepId)).toEqual(["recipe-length-cuts"]);
  });
});

describe("music under each variant in a run", () => {
  const SONG = "https://files.example/uploads/upbeat.mp3";
  const NODES: Node[] = [
    { id: "lengths_1", stepId: "recipe-length-cuts", input: { lengths: "15, 6" } },
    { id: "music_1", stepId: "recipe-variant-music" },
  ];

  async function cutsFinished(setUpRun: Awaited<ReturnType<typeof setUp>>) {
    const { t, start, jobsOf } = setUpRun;
    const runId = await start({ file_url: VIDEO, file_name: "Boots ad.mp4" });
    const [cuts] = await jobsOf(runId, "lengths_1");
    const cutFiles = [made("aaaaaaa1", 0), made("aaaaaaa1", 1)];
    await t.mutation(internal.jobs.finish, { jobId: cuts._id, ok: true, result: cutFiles });
    return { runId, cutFiles };
  }

  const stepOf = (t: Awaited<ReturnType<typeof setUp>>["t"], runId: Id<"runs">, nodeId: string) =>
    t.run(
      async (ctx) =>
        (await ctx.db
          .query("runSteps")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .filter((q) => q.eq(q.field("nodeId"), nodeId))
          .first())!,
    );

  test("without music in Settings it is passed over and the run still finishes", async () => {
    const ready = await setUp(NODES);
    toolkit(FACTS);
    const { runId } = await cutsFinished(ready);
    const music = await stepOf(ready.t, runId, "music_1");
    expect(music.status).toBe("skipped");
    expect(music.jobIds).toEqual([]);
    // Passed over itself (it was reached), not for want of files.
    expect(music.startedAt).toBeDefined();
    const run = await ready.maya.as.query(api.runs.get, { runId });
    expect(run?.status).toBe("done");
  });

  test("with music in Settings each cut also comes back with it, named _music", async () => {
    const ready = await setUp(NODES);
    await ready.t.run((ctx) =>
      ctx.db.insert("teamSettings", {
        organizationId: ready.team,
        maxParallelJobs: 4,
        music: [{ name: "Upbeat", file: SONG }],
      }),
    );
    toolkit(FACTS);
    const { runId, cutFiles } = await cutsFinished(ready);
    const jobs = await ready.jobsOf(runId, "music_1");
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => (job.input as { music_url: string }).music_url)).toEqual([SONG, SONG]);
    const withMusic: Record<string, string> = {};
    for (const [index, job] of jobs.entries()) {
      const file = made(`ddddddd${index}`, 0);
      withMusic[(job.input as { video_url: string }).video_url] = file;
      await ready.t.mutation(internal.jobs.finish, { jobId: job._id, ok: true, result: file });
    }
    const run = await ready.maya.as.query(api.runs.get, { runId });
    expect(run?.status).toBe("done");
    // Both copies are kept: the cut without music and the one with it.
    expect(run?.outputNames[cutFiles[1]]).toBe("Boots ad 15s");
    expect(run?.outputNames[withMusic[cutFiles[1]]]).toBe("Boots ad 15s_music");
    expect(run?.outputNames[withMusic[cutFiles[0]]]).toBe("Boots ad 6s_music");
  });
});
