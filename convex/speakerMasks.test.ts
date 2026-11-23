import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { maskFor } from "./lib/masks";
import { enqueueJob } from "./lib/queue";
import { addPerson, addTeam, backend } from "./test.setup";

const VIDEO = "https://files.example/uploads/talk.mp4";
const MASK = "https://files.example/out/job_mask.mp4";

// The speaker's cut-out is made once per video: a job that made one keeps it for the video,
// it is never handed on as one of the job's files, and the next New Background or motion job
// on the same video is sent it so the toolkit does not cut the speaker out again.
describe("the speaker's cut-out", () => {
  async function team() {
    const t = backend();
    const organizationId = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [organizationId]);
    await t.run(async (ctx) => {
      await ctx.db.insert("toolkitConnections", {
        organizationId,
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
    const enqueue = (stepId: string, input: Record<string, unknown>) =>
      t.run(async (ctx) => {
        const queued = await enqueueJob(ctx, { organizationId, stepId, input, createdBy: maya.id });
        if (!queued.ok) throw new Error(queued.message);
        return queued.jobId;
      });
    const job = (jobId: Id<"jobs">) => t.run(async (ctx) => (await ctx.db.get(jobId))!);
    return { t, organizationId, enqueue, job };
  }

  test("is kept for its video and is not one of the job's files", async () => {
    const { t, organizationId, enqueue, job } = await team();
    const jobId = await enqueue("video-background", { video_url: `${VIDEO}?sig=1` });
    expect((await job(jobId)).input).not.toHaveProperty("mask_url");
    await t.mutation(internal.jobs.finish, {
      jobId,
      ok: true,
      result: { file_url: "https://files.example/out/job_background.mp4", mask_url: MASK },
    });
    const done = await job(jobId);
    expect(done.outputs).toEqual(["https://files.example/out/job_background.mp4"]);
    expect(done.result).not.toHaveProperty("mask_url");
    // A fresh signed link to the same file finds it.
    expect(await t.run((ctx) => maskFor(ctx, organizationId, `${VIDEO}?sig=2`))).toBe(MASK);
  });

  test("is sent with the next job on the same video, and only that video", async () => {
    const { t, enqueue, job } = await team();
    const first = await enqueue("video-background", { video_url: VIDEO, background: "color" });
    await t.mutation(internal.jobs.finish, {
      jobId: first,
      ok: true,
      result: { file_url: "https://files.example/out/a.mp4", mask_url: MASK },
    });
    const motion = await enqueue("video-motion", {
      video_url: VIDEO,
      pieces: [{ type: "big_text", start: 1, title: "Takewon", layer: "behind" }],
    });
    expect((await job(motion)).input).toMatchObject({ mask_url: MASK });
    const other = await enqueue("video-background", { video_url: "https://files.example/b.mp4" });
    expect((await job(other)).input).not.toHaveProperty("mask_url");
    // Steps that do not take one are left alone.
    const trim = await enqueue("video-trim", { video_url: VIDEO, start: "00:00:01" });
    expect((await job(trim)).input).not.toHaveProperty("mask_url");
  });

  test("made again replaces the one kept", async () => {
    const { t, organizationId, enqueue } = await team();
    for (const mask of [MASK, "https://files.example/out/newer_mask.mp4"]) {
      const jobId = await enqueue("video-background", { video_url: VIDEO });
      await t.mutation(internal.jobs.finish, {
        jobId,
        ok: true,
        result: { file_url: "https://files.example/out/x.mp4", mask_url: mask },
      });
    }
    const kept = await t.run((ctx) => ctx.db.query("speakerMasks").collect());
    expect(kept).toHaveLength(1);
    expect(await t.run((ctx) => maskFor(ctx, organizationId, VIDEO))).toBe(
      "https://files.example/out/newer_mask.mp4",
    );
  });
});
