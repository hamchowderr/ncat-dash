import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { openReviewForApproval } from "./lib/reviews";
import { addPerson, addTeam, backend } from "./test.setup";

const PAGE = { numItems: 10, cursor: null };
const BUCKET = "https://s3.example.com/media";
const JOB = "ca4934e3-5b1f-4c3e-9a77-0d2f1b6e8a10";
const SOURCE = `${BUCKET}/uploads/space-interviews.mp4`;
const made = (n: number) => `${BUCKET}/${JOB}_output_${n}.mp4`;
const captioned = (n: number) => `${BUCKET}/${JOB}${n}_captioned.mp4`;

/**
 * A team whose "Shorts" automation ran on space-interviews.mp4: Cut clips made two clips
 * named after a toolkit job, Add captions captioned both, and an approval handed them on.
 */
async function team() {
  const t = backend();
  const teamId = await addTeam(t, "Salt House");
  const olu = await addPerson(t, "Olu Bello", [teamId], "owner");
  const ids = await t.run(async (ctx) => {
    const automationId = await ctx.db.insert("automations", {
      organizationId: teamId,
      name: "Shorts",
      enabled: true,
      trigger: { kind: "upload", fileType: "video" },
      nodes: [],
      edges: [],
      hookToken: "token",
      nextRunAt: null,
      createdBy: olu.id,
      updatedAt: Date.now(),
    });
    const at = { x: 0, y: 0 };
    const runId = await ctx.db.insert("runs", {
      organizationId: teamId,
      automationId,
      automationName: "Shorts",
      status: "done",
      triggerKind: "upload",
      trigger: { file_url: SOURCE, file_name: "space-interviews.mp4" },
      nodes: [
        { id: "cut", kind: "step", stepId: "video-split", input: {}, position: at },
        { id: "caps", kind: "step", stepId: "video-caption", input: {}, position: at },
        { id: "ok", kind: "approval", input: {}, position: at },
      ],
      edges: [
        { id: "e1", source: "cut", target: "caps" },
        { id: "e2", source: "caps", target: "ok" },
      ],
      error: null,
      startedBy: null,
      finishedAt: Date.now(),
    });
    const step = (nodeId: string, outputs: string[]) =>
      ctx.db.insert("runSteps", {
        runId,
        organizationId: teamId,
        nodeId,
        status: "done",
        jobIds: [],
        outputs,
        error: null,
        startedAt: 0,
        finishedAt: 0,
      });
    await step("cut", [made(0), made(1)]);
    await step("caps", [captioned(0), captioned(1)]);
    const okStep = await step("ok", [captioned(0), captioned(1)]);
    await ctx.db.insert("storageConnections", {
      organizationId: teamId,
      endpoint: "https://s3.example.com",
      region: "auto",
      bucket: "media",
      accessKeyId: "key",
      secretCipher: "x",
      createdBy: olu.id,
    });
    return { automationId, runId, okStep };
  });
  return { t, teamId, olu, ...ids };
}

describe("readable names for a run's files", () => {
  test("Outputs names them after the file that started the run", async () => {
    const { teamId, olu } = await team();
    const { page } = await olu.as.query(api.outputs.byRun, {
      organizationId: teamId,
      paginationOpts: PAGE,
    });
    expect(page[0].names).toEqual({
      [made(0)]: "Space interviews clip 1",
      [made(1)]: "Space interviews clip 2",
      [captioned(0)]: "Space interviews clip 1",
      [captioned(1)]: "Space interviews clip 2",
    });
  });

  test("the run page gets the same names", async () => {
    const { olu, runId } = await team();
    const run = await olu.as.query(api.runs.get, { runId });
    expect(run?.outputNames[captioned(1)]).toBe("Space interviews clip 2");
  });

  test("an approval's review room titles its clips by those names", async () => {
    const { t, runId, okStep } = await team();
    const titles = await t.run(async (ctx) => {
      const run = (await ctx.db.get(runId))!;
      const step = (await ctx.db.get(okStep))!;
      await openReviewForApproval(ctx, run, step, [captioned(0), captioned(1)]);
      const review = await ctx.db
        .query("reviews")
        .withIndex("by_runStep", (q) => q.eq("runStepId", okStep))
        .first();
      const clips = await ctx.db
        .query("reviewClips")
        .withIndex("by_review", (q) => q.eq("reviewId", review!._id))
        .collect();
      return clips.map((clip) => clip.title);
    });
    expect(titles).toEqual(["Space interviews clip 1", "Space interviews clip 2"]);
  });

  test("a review opened from Outputs keeps the names it was sent with", async () => {
    const { t, teamId, olu } = await team();
    const reviewId = await olu.as.mutation(api.reviews.create, {
      organizationId: teamId,
      title: "Shorts",
      urls: [captioned(0), `${BUCKET}/${JOB}.mp4`],
      names: { [captioned(0)]: "Space interviews clip 1" },
    });
    const titles = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("reviewClips")
          .withIndex("by_review", (q) => q.eq("reviewId", reviewId))
          .collect()
      ).map((clip) => clip.title),
    );
    // A file with no name sent and a job id for a name is called by its place.
    expect(titles).toEqual(["Space interviews clip 1", "Clip 2"]);
  });
});

describe("renaming a file on the Files page", () => {
  test("moves the run's steps, the run's starting file and review clips along", async () => {
    const { t, teamId, runId, okStep } = await team();
    // Many steps still waiting elsewhere must not hide this run's finished ones.
    await t.run(async (ctx) => {
      for (let n = 0; n < 600; n++) {
        await ctx.db.insert("runSteps", {
          runId,
          organizationId: teamId,
          nodeId: `waiting-${n}`,
          status: "pending",
          jobIds: [],
          outputs: [],
          error: null,
          startedAt: null,
          finishedAt: null,
        });
      }
      const run = (await ctx.db.get(runId))!;
      const step = (await ctx.db.get(okStep))!;
      await openReviewForApproval(ctx, run, step, [captioned(0)]);
    });

    const renamed = `${BUCKET}/Space%20interviews%20clip%201.mp4`;
    const source = `${BUCKET}/uploads/space%20interviews%20final.mp4`;
    await t.mutation(internal.files.followLinks, {
      organizationId: teamId,
      moves: [
        { from: `${JOB}0_captioned.mp4`, to: "Space interviews clip 1.mp4" },
        { from: "uploads/space-interviews.mp4", to: "uploads/space interviews final.mp4" },
      ],
      folders: [],
    });

    const after = await t.run(async (ctx) => {
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect();
      const run = await ctx.db.get(runId);
      const clips = await ctx.db.query("reviewClips").collect();
      return {
        caps: steps.find((step) => step.nodeId === "caps")?.outputs,
        trigger: run?.trigger as { file_url: string },
        clip: clips[0].versions.map((version) => version.url),
      };
    });
    expect(after.caps).toEqual([renamed, captioned(1)]);
    expect(after.trigger.file_url).toBe(source);
    expect(after.clip).toEqual([renamed]);
  });

  test("a deleted file's review version stays, so its comments keep their place", async () => {
    const { t, teamId, runId, okStep } = await team();
    await t.run(async (ctx) => {
      const run = (await ctx.db.get(runId))!;
      const step = (await ctx.db.get(okStep))!;
      await openReviewForApproval(ctx, run, step, [captioned(0)]);
    });
    await t.mutation(internal.files.followLinks, {
      organizationId: teamId,
      moves: [{ from: `${JOB}0_captioned.mp4`, to: null }],
      folders: [],
    });
    const urls = await t.run(async (ctx) =>
      (await ctx.db.query("reviewClips").collect())[0].versions.map((version) => version.url),
    );
    expect(urls).toEqual([captioned(0)]);
  });
});
