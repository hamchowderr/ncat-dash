import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const FILE = "https://files.example/uploads/station_interview.mp4";

type Node = Doc<"automations">["nodes"][number];

const TRIM: Node = {
  id: "trim",
  kind: "step",
  stepId: "video-trim",
  input: { start: "00:00:05" },
  position: { x: 0, y: 0 },
};
const THUMBNAIL: Node = {
  id: "thumbnail",
  kind: "step",
  stepId: "video-thumbnail",
  input: { second: 1 },
  position: { x: 220, y: 0 },
};
const CAPTION: Node = {
  id: "caption",
  kind: "step",
  stepId: "video-caption",
  // Its own look, so it does not read the video's shape first.
  input: { settings: { style: "classic" } },
  position: { x: 440, y: 0 },
};

// trim -> thumbnail -> caption
async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  const automationId = await t.run(async (ctx) => {
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
    return ctx.db.insert("automations", {
      organizationId: team,
      name: "Weekly clips",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: [TRIM, THUMBNAIL, CAPTION],
      edges: [
        { id: "e1", source: "trim", target: "thumbnail" },
        { id: "e2", source: "thumbnail", target: "caption" },
      ],
      hookToken: "token",
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    });
  });
  const start = () =>
    t.run(async (ctx) => {
      const automation = (await ctx.db.get(automationId))!;
      const started = await startRun(ctx, automation, "webhook", { file_url: FILE }, maya.id);
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
      const byNode = Object.fromEntries(steps.map((step) => [step.nodeId, step]));
      const jobOf = async (nodeId: string) => {
        const ids = byNode[nodeId]?.jobIds ?? [];
        return ids.length ? await ctx.db.get(ids[ids.length - 1]) : null;
      };
      return {
        run,
        byNode,
        jobs: {
          trim: await jobOf("trim"),
          thumbnail: await jobOf("thumbnail"),
          caption: await jobOf("caption"),
        },
      };
    });
  const finishJob = (jobId: Id<"jobs">, ok: boolean, result = "https://files.example/out/a.mp4") =>
    t.mutation(internal.jobs.finish, {
      jobId,
      ok,
      ...(ok ? { result } : { error: "FFmpeg gave up." }),
      permanent: true,
    });
  /** A run whose trim worked and whose thumbnail failed. */
  const failedRun = async () => {
    const runId = await start();
    await finishJob((await look(runId)).jobs.trim!._id, true, "https://files.example/out/trim.mp4");
    await finishJob((await look(runId)).jobs.thumbnail!._id, false);
    return runId;
  };
  return { t, team, maya, outsider, automationId, start, look, finishJob, failedRun };
}

describe("picking a failed run up where it stopped", () => {
  test("keeps what worked, runs the failed step again and carries on to the end", async () => {
    const { maya, look, finishJob, failedRun } = await setUp();
    const runId = await failedRun();
    const before = await look(runId);
    expect(before.run.status).toBe("failed");
    expect(before.byNode.caption.status).toBe("skipped");

    const page = await maya.as.query(api.runs.get, { runId });
    expect(page?.pickUp).toMatchObject({ ok: true, stepName: "Video thumbnail" });

    await expect(maya.as.mutation(api.runs.pickUp, { runId })).resolves.toEqual({
      withCurrentSettings: true,
    });
    const after = await look(runId);
    expect(after.run).toMatchObject({ status: "running", error: null, pickedUp: 1 });
    // Trim is not done twice: same job, same file.
    expect(after.byNode.trim.jobIds).toEqual(before.byNode.trim.jobIds);
    expect(after.byNode.trim.status).toBe("done");
    // The thumbnail starts over on trim's file; caption waits for it.
    expect(after.byNode.thumbnail.status).toBe("running");
    expect(after.jobs.thumbnail!._id).not.toBe(before.jobs.thumbnail!._id);
    expect(after.jobs.thumbnail!.input.video_url).toBe("https://files.example/out/trim.mp4");
    expect(after.byNode.caption.status).toBe("pending");

    await finishJob(after.jobs.thumbnail!._id, true, "https://files.example/out/thumb.mp4");
    await finishJob((await look(runId)).jobs.caption!._id, true);
    const done = await look(runId);
    expect(done.run.status).toBe("done");
    expect(done.byNode.thumbnail.retries).toBeUndefined();
  });

  test("uses a setting fixed in the automation since it failed", async () => {
    const { t, maya, automationId, look, failedRun } = await setUp();
    const runId = await failedRun();
    await t.run(async (ctx) => {
      await ctx.db.patch(automationId, {
        nodes: [TRIM, { ...THUMBNAIL, input: { second: 4 } }, CAPTION],
      });
    });
    await maya.as.mutation(api.runs.pickUp, { runId });
    expect((await look(runId)).jobs.thumbnail!.input.second).toBe(4);
  });

  test("keeps the run's own steps when the automation's steps have changed", async () => {
    const { t, maya, automationId, look, failedRun } = await setUp();
    const runId = await failedRun();
    await t.run(async (ctx) => {
      await ctx.db.patch(automationId, {
        nodes: [TRIM, { ...THUMBNAIL, input: { second: 4 } }],
        edges: [{ id: "e1", source: "trim", target: "thumbnail" }],
      });
    });
    await expect(maya.as.mutation(api.runs.pickUp, { runId })).resolves.toEqual({
      withCurrentSettings: false,
    });
    const after = await look(runId);
    expect(after.jobs.thumbnail!.input.second).toBe(1);
    expect(after.byNode.caption.status).toBe("pending");
  });

  test("refuses runs it cannot pick up, and other teams' runs", async () => {
    const { maya, outsider, start, failedRun } = await setUp();
    const going = await start();
    await expect(maya.as.mutation(api.runs.pickUp, { runId: going })).rejects.toThrow(
      /Only a run that failed/,
    );
    const failed = await failedRun();
    await expect(outsider.as.mutation(api.runs.pickUp, { runId: failed })).rejects.toThrow();
    await maya.as.mutation(api.runs.pickUp, { runId: failed });
    // Once going again, it cannot be picked up twice.
    await expect(maya.as.mutation(api.runs.pickUp, { runId: failed })).rejects.toThrow(
      /Only a run that failed/,
    );
  });

  test("a rejection at an approval step is not something to pick up", async () => {
    const { t, maya, failedRun } = await setUp();
    const runId = await failedRun();
    await t.run(async (ctx) => {
      const step = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .filter((q) => q.eq(q.field("nodeId"), "thumbnail"))
        .first();
      await ctx.db.patch(step!._id, { decidedBy: maya.id });
    });
    const page = await maya.as.query(api.runs.get, { runId });
    expect(page?.pickUp).toMatchObject({ ok: false, reason: expect.stringMatching(/rejected/) });
  });

  test("the Runs page lists failed runs across the team and picks them all up at once", async () => {
    const { t, team, maya, outsider, start, look, failedRun } = await setUp();
    const first = await failedRun();
    const second = await failedRun();
    const going = await start();
    const rejected = await failedRun();
    await t.run(async (ctx) => {
      const step = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", rejected))
        .filter((q) => q.eq(q.field("nodeId"), "thumbnail"))
        .first();
      await ctx.db.patch(step!._id, { decidedAutomatically: true });
    });

    const all = await maya.as.query(api.runs.listForTeam, { organizationId: team, status: "all" });
    expect(all.runs.map((run) => run._id)).toEqual([rejected, going, second, first]);
    expect(all.failedCount).toBe(3);
    const failed = await maya.as.query(api.runs.listForTeam, {
      organizationId: team,
      status: "failed",
    });
    expect(failed.runs.map((run) => [run._id, run.canPickUp])).toEqual([
      [rejected, false],
      [second, true],
      [first, true],
    ]);
    expect(failed.runs[1]).toMatchObject({
      failedStep: "Video thumbnail",
      startedWith: "station_interview.mp4",
      whyNot: null,
    });
    expect(failed.runs[0].whyNot).toMatch(/rejected/);
    await expect(
      outsider.as.query(api.runs.listForTeam, { organizationId: team, status: "all" }),
    ).rejects.toThrow();

    await expect(maya.as.mutation(api.runs.pickUpMany, { organizationId: team })).resolves.toEqual({
      pickedUp: 2,
      passedOver: 1,
      more: false,
    });
    expect((await look(first)).run.status).toBe("running");
    expect((await look(second)).run.status).toBe("running");
    expect((await look(rejected)).run.status).toBe("failed");
  });

  test("picks up only the runs chosen, and only the team's own", async () => {
    const { t, team, maya, look, failedRun } = await setUp();
    const first = await failedRun();
    const second = await failedRun();
    const theirs = await failedRun();
    const otherTeam = await addTeam(t, "Harbour Films");
    await t.run((ctx) => ctx.db.patch(theirs, { organizationId: otherTeam }));
    await expect(
      maya.as.mutation(api.runs.pickUpMany, {
        organizationId: team,
        runIds: [second, theirs],
      }),
    ).resolves.toEqual({ pickedUp: 1, passedOver: 0, more: false });
    expect((await look(first)).run.status).toBe("failed");
    expect((await look(second)).run.status).toBe("running");
    expect((await look(theirs)).run.status).toBe("failed");
  });
});
