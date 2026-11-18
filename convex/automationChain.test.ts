import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const FILE = "https://files.example/uploads/station_interview.mp4";
const TRIMMED = "https://files.example/out/trimmed.mp4";
const CAPTIONED = "https://files.example/out/captioned.mp4";

type Node = Doc<"automations">["nodes"][number];
type Trigger = Doc<"automations">["trigger"];

const at = (x: number) => ({ x, y: 0 });
const step = (id: string, stepId: string, x: number): Node => ({
  id,
  kind: "step",
  stepId,
  // A caption step with its own look does not stop to read the video's shape first.
  input: stepId === "video-caption" ? { settings: { style: "classic" } } : {},
  position: at(x),
});
const runs = (id: string, automation: string, x: number, wait = true): Node => ({
  id,
  kind: "automation",
  input: { automation, wait },
  position: at(x),
});
const line = (...ids: string[]) =>
  ids.slice(1).map((target, index) => ({ id: `e${index}`, source: ids[index], target }));

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  await t.run(async (ctx) => {
    await ctx.db.insert("toolkitConnections", {
      organizationId: team,
      baseUrl: "https://toolkit.example",
      apiKeyCipher: "x",
      apiKeyHint: "abcd",
      status: "ok",
      buildNumber: null,
      lastCheckedAt: 0,
      lastError: null,
      createdBy: maya.id,
    });
  });

  const add = (
    name: string,
    nodes: Node[],
    edges: Doc<"automations">["edges"] = [],
    trigger: Trigger = { kind: "manual" },
    enabled = false,
  ) =>
    t.run((ctx) =>
      ctx.db.insert("automations", {
        organizationId: team,
        name,
        enabled,
        trigger,
        nodes,
        edges,
        hookToken: `token-${name}`,
        nextRunAt: null,
        createdBy: maya.id,
        updatedAt: Date.now(),
      }),
    );
  const setNodes = (id: Id<"automations">, nodes: Node[], edges: Doc<"automations">["edges"]) =>
    t.run((ctx) => ctx.db.patch(id, { nodes, edges }));

  const start = (automationId: Id<"automations">, fileUrl = FILE) =>
    t.run(async (ctx) => {
      const automation = (await ctx.db.get(automationId))!;
      const started = await startRun(ctx, automation, "manual", { file_url: fileUrl }, maya.id);
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });

  const look = (runId: Id<"runs">) =>
    t.run(async (ctx) => {
      const run = (await ctx.db.get(runId))!;
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect();
      const byNode = Object.fromEntries(steps.map((one) => [one.nodeId, one]));
      const jobs = await Promise.all(
        steps.flatMap((one) => one.jobIds).map((id) => ctx.db.get(id)),
      );
      return { run, byNode, jobs: jobs.filter((job) => job !== null) };
    });

  const runsOf = (automationId: Id<"automations">) =>
    t.run((ctx) =>
      ctx.db
        .query("runs")
        .withIndex("by_automation", (q) => q.eq("automationId", automationId))
        .collect(),
    );

  const finish = (jobId: Id<"jobs">, result: string | null) =>
    t.mutation(internal.jobs.finish, {
      jobId,
      ok: result !== null,
      ...(result !== null ? { result } : { error: "FFmpeg gave up." }),
      permanent: true,
    });

  return { t, maya, add, setNodes, start, look, runsOf, finish };
}

describe("a Run an automation step", () => {
  test("hands its files over, waits, and hands on what the other run finished with", async () => {
    const { maya, add, start, look, runsOf, finish } = await setUp();
    const captions = await add("Captions", [step("caption", "video-caption", 0)]);
    const clips = await add(
      "Clips",
      [
        step("trim", "video-trim", 0),
        runs("run", captions, 220),
        step("thumb", "video-thumbnail", 440),
      ],
      line("trim", "run", "thumb"),
    );

    const runId = await start(clips);
    await finish((await look(runId)).byNode.trim.jobIds[0], TRIMMED);

    const waiting = await look(runId);
    expect(waiting.byNode.run.status).toBe("running");
    const [child] = await runsOf(captions);
    expect(child).toMatchObject({
      triggerKind: "automation",
      trigger: { file_url: TRIMMED, files: [TRIMMED] },
      parentRunId: runId,
      parentRunStepId: waiting.byNode.run._id,
      chain: [clips, captions],
    });
    expect(waiting.byNode.run.childRunId).toBe(child._id);
    const childJob = (await look(child._id)).jobs[0];
    expect(childJob.input).toMatchObject({ video_url: TRIMMED });

    await finish(childJob._id, CAPTIONED);
    const after = await look(runId);
    expect(after.byNode.run).toMatchObject({ status: "done", outputs: [CAPTIONED] });
    const thumbJob = after.jobs.find((job) => job.stepId === "video-thumbnail");
    expect(thumbJob?.input).toMatchObject({ video_url: CAPTIONED });

    // The run pages link the two runs both ways.
    const page = await maya.as.query(api.runs.get, { runId });
    expect(page?.startedRuns).toEqual([
      expect.objectContaining({ runId: child._id, automationName: "Captions", how: "step" }),
    ]);
    expect(page?.steps.find((one) => one.nodeId === "run")?.childRunId).toBe(child._id);
    const childPage = await maya.as.query(api.runs.get, { runId: child._id });
    expect(childPage?.startedByRun).toMatchObject({ runId, automationName: "Clips" });
  });

  test("with wait off, starts the other run and carries on at once with its own files", async () => {
    const { add, start, look, runsOf } = await setUp();
    const captions = await add("Captions", [step("caption", "video-caption", 0)]);
    const clips = await add(
      "Clips",
      [runs("run", captions, 0, false), step("thumb", "video-thumbnail", 220)],
      line("run", "thumb"),
    );
    const runId = await start(clips);
    const now = await look(runId);
    expect(now.byNode.run).toMatchObject({ status: "done", outputs: [FILE] });
    expect(now.jobs[0]).toMatchObject({ stepId: "video-thumbnail", input: { video_url: FILE } });
    const [child] = await runsOf(captions);
    expect(child.parentRunId).toBe(runId);
    expect(child.parentRunStepId).toBeUndefined();
  });

  test("fails, and stops the run, when the other run fails", async () => {
    const { add, start, look, runsOf, finish } = await setUp();
    const captions = await add("Captions", [step("caption", "video-caption", 0)]);
    const clips = await add(
      "Clips",
      [runs("run", captions, 0), step("thumb", "video-thumbnail", 220)],
      line("run", "thumb"),
    );
    const runId = await start(clips);
    const [child] = await runsOf(captions);
    await finish((await look(child._id)).jobs[0]._id, null);
    const after = await look(runId);
    expect(after.byNode.run).toMatchObject({
      status: "failed",
      error: "Captions failed: FFmpeg gave up.",
    });
    expect(after.byNode.thumb.status).toBe("skipped");
    expect(after.run.status).toBe("failed");
  });

  test("never starts an automation already in the chain", async () => {
    const { add, setNodes, start, look, runsOf } = await setUp();
    const first = await add("First", []);
    const second = await add("Second", [runs("back", first, 0)]);
    await setNodes(first, [runs("go", second, 0)], []);

    const runId = await start(first);
    const [child] = await runsOf(second);
    const childNow = await look(child._id);
    expect(childNow.byNode.back).toMatchObject({
      status: "failed",
      error: "First is already part of this chain of runs, so it was not started again.",
    });
    expect((await runsOf(first)).length).toBe(1);
    const parent = await look(runId);
    expect(parent.run.status).toBe("failed");
    expect(parent.byNode.go.error).toMatch(/^Second failed: First is already part/);
  });

  test("stopping a run stops the run it waits on, and the step is told", async () => {
    const { maya, add, start, look, runsOf } = await setUp();
    const captions = await add("Captions", [step("caption", "video-caption", 0)]);
    const clips = await add("Clips", [runs("run", captions, 0)]);
    const runId = await start(clips);
    await maya.as.mutation(api.runs.cancel, { runId });
    const [child] = await runsOf(captions);
    expect(child.status).toBe("cancelled");
    expect((await look(runId)).run.status).toBe("cancelled");

    // Stopping the other run on its own fails the step waiting on it.
    const again = await start(clips);
    const [, second] = await runsOf(captions);
    await maya.as.mutation(api.runs.cancel, { runId: second._id });
    const after = await look(again);
    expect(after.byNode.run).toMatchObject({
      status: "failed",
      error: "Captions was stopped before it finished.",
    });
  });
});

describe("a When another automation finishes trigger", () => {
  test("starts on the finished files after the run works, and only when switched on", async () => {
    const { maya, add, start, look, runsOf, finish } = await setUp();
    const clips = await add("Clips", [step("trim", "video-trim", 0)]);
    const follow = (when: "done" | "failed" | "either", enabled = true) =>
      add(
        `After ${when}${enabled ? "" : " (off)"}`,
        [step("thumb", "video-thumbnail", 0)],
        [],
        { kind: "finished", automationId: clips, when },
        enabled,
      );
    const onDone = await follow("done");
    const onFailed = await follow("failed");
    const onEither = await follow("either");
    const off = await follow("done", false);

    const runId = await start(clips);
    await finish((await look(runId)).byNode.trim.jobIds[0], TRIMMED);
    const [followed] = await runsOf(onDone);
    expect(followed).toMatchObject({
      triggerKind: "finished",
      trigger: { file_url: TRIMMED, files: [TRIMMED] },
      parentRunId: runId,
      chain: [clips, onDone],
    });
    expect(await runsOf(onEither)).toHaveLength(1);
    expect(await runsOf(onFailed)).toHaveLength(0);
    expect(await runsOf(off)).toHaveLength(0);

    const page = await maya.as.query(api.runs.get, { runId });
    expect(page?.startedRuns.map((run) => run.how)).toEqual(["followed", "followed"]);
  });

  test("after a failure, starts on the files the run started with", async () => {
    const { add, start, look, runsOf, finish } = await setUp();
    const clips = await add("Clips", [step("trim", "video-trim", 0)]);
    const onFailed = await add(
      "Rescue",
      [step("thumb", "video-thumbnail", 0)],
      [],
      {
        kind: "finished",
        automationId: clips,
        when: "failed",
      },
      true,
    );
    const runId = await start(clips);
    await finish((await look(runId)).byNode.trim.jobIds[0], null);
    const [followed] = await runsOf(onFailed);
    expect(followed.trigger).toEqual({ file_url: FILE, files: [FILE] });
  });
});

describe("saving links between automations", () => {
  test("refuses links that make automations start each other in a loop", async () => {
    const { maya, add } = await setUp();
    const first = await add("First", []);
    const second = await add("Second", [runs("go", first, 0)]);

    const saved = await maya.as.mutation(api.automations.save, {
      automationId: first,
      name: "First",
      trigger: { kind: "manual" },
      nodes: [runs("go", second, 0)],
      edges: [],
    });
    expect(saved.problem).toBe(
      "This would make automations start each other in a loop: First → Second → First. Remove one of those links.",
    );

    const self = await maya.as.mutation(api.automations.save, {
      automationId: second,
      name: "Second",
      trigger: { kind: "finished", automationId: second, when: "done" },
      nodes: [step("thumb", "video-thumbnail", 0)],
      edges: [],
    });
    expect(self.problem).toBe("Second cannot start itself.");
    expect(self.links).toBe("Second cannot start itself.");

    // The agent is told too, with the rest of what stops it running.
    const changed = await maya.as.mutation(api.automations.change, {
      automationId: second,
      operations: [{ op: "name", name: "Second" }],
    });
    expect(changed.problems.map((problem) => problem.message)).toContain(
      "Second cannot start itself.",
    );
    await expect(
      maya.as.mutation(api.automations.setEnabled, { automationId: second, enabled: true }),
    ).rejects.toThrow(/cannot start itself/);
  });

  test("asks for an automation that exists, and accepts a chain that does not loop", async () => {
    const { maya, add } = await setUp();
    const first = await add("First", [step("thumb", "video-thumbnail", 0)]);
    const second = await add("Second", [step("thumb", "video-thumbnail", 0)]);

    const blank = await maya.as.mutation(api.automations.save, {
      automationId: second,
      name: "Second",
      trigger: { kind: "finished", automationId: "", when: "done" },
      nodes: [step("thumb", "video-thumbnail", 0)],
      edges: [],
    });
    expect(blank.problem).toBe("Pick which automation it waits for.");

    const fine = await maya.as.mutation(api.automations.save, {
      automationId: second,
      name: "Second",
      trigger: { kind: "finished", automationId: first, when: "either" },
      nodes: [step("thumb", "video-thumbnail", 0)],
      edges: [],
    });
    expect(fine.problem).toBeNull();
    expect(fine.links).toBeNull();
    await maya.as.mutation(api.automations.setEnabled, { automationId: second, enabled: true });

    await maya.as.mutation(api.automations.remove, { automationId: first });
    const gone = await maya.as.mutation(api.automations.save, {
      automationId: second,
      name: "Second",
      trigger: { kind: "finished", automationId: first, when: "either" },
      nodes: [step("thumb", "video-thumbnail", 0)],
      edges: [],
    });
    expect(gone.problem).toBe("The automation this one waits for no longer exists. Pick another.");
  });
});
