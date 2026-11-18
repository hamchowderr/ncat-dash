import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const FILE = "https://files.example/uploads/interview.mp4";
type Compose = { filters?: { filter: string }[]; outputs: { options: { option: string }[] }[] };

/** A run of Clips for `platform` feeding Follow the speaker (with `follow` as its settings). */
async function clipsThenFollow(platform: string, follow: Record<string, unknown> = {}) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const runId = await t.run(async (ctx) => {
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
    const automationId = await ctx.db.insert("automations", {
      organizationId: team,
      name: "Interviews",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: [
        { id: "clips", kind: "clips", input: { platform }, position: { x: 0, y: 0 } },
        {
          id: "follow_1",
          kind: "step",
          stepId: "video-reframe",
          input: follow,
          position: { x: 300, y: 0 },
        },
      ],
      edges: [{ id: "clips>follow_1", source: "clips", target: "follow_1" }],
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
  const stepOf = (nodeId: string) =>
    t.run(async (ctx) => {
      const step = (await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .filter((q) => q.eq(q.field("nodeId"), nodeId))
        .first())!;
      const jobs = await Promise.all(step.jobIds.map((id) => ctx.db.get(id)));
      return { step, jobs: jobs.filter((job) => job !== null) };
    });
  const finish = async (jobId: Id<"jobs">, result: unknown) =>
    t.mutation(internal.jobs.finish, { jobId, ok: true, result, permanent: true });

  // Clips reads the video (its length, then its pauses), then cuts it.
  for (const job of (await stepOf("clips")).jobs) {
    await finish(
      job._id,
      job.stepId === "media-metadata" ? { duration: 150, width: 1920, height: 1080 } : [],
    );
  }
  return { t, stepOf, finish };
}

describe("Clips into Follow the speaker", () => {
  test("cuts the clips in the video's own shape, then follows the speaker in the platform's", async () => {
    const { stepOf, finish } = await clipsThenFollow("TikTok");
    const cut = await stepOf("clips");
    expect(cut.jobs.length).toBeGreaterThan(0);
    for (const job of cut.jobs) {
      // No blurred-background reshape: the whole wide picture is kept to follow someone across.
      expect((job.input as Compose).filters).toBeUndefined();
    }
    for (const [index, job] of cut.jobs.entries()) {
      await finish(job._id, [{ file_url: `https://files.example/out/clip_${index + 1}.mp4` }]);
    }
    const follow = await stepOf("follow_1");
    expect(follow.jobs).toHaveLength(cut.jobs.length);
    for (const [index, job] of follow.jobs.entries()) {
      expect(job.stepId).toBe("video-reframe");
      expect(job.input).toMatchObject({
        video_url: `https://files.example/out/clip_${index + 1}.mp4`,
        aspect: "9:16",
      });
    }
  });

  test("takes 4:5 after Clips for the Instagram feed", async () => {
    const { stepOf, finish } = await clipsThenFollow("Instagram feed");
    const cut = await stepOf("clips");
    for (const job of cut.jobs)
      await finish(job._id, [{ file_url: "https://files.example/c.mp4" }]);
    const follow = await stepOf("follow_1");
    expect(follow.jobs[0]?.input).toMatchObject({ aspect: "4:5" });
  });

  test("keeps a shape that was picked on the step", async () => {
    const { stepOf, finish } = await clipsThenFollow("TikTok", {
      aspect: "1:1",
      follow: "largest_face",
    });
    const cut = await stepOf("clips");
    for (const job of cut.jobs)
      await finish(job._id, [{ file_url: "https://files.example/c.mp4" }]);
    const follow = await stepOf("follow_1");
    expect(follow.jobs[0]?.input).toMatchObject({ aspect: "1:1", follow: "largest_face" });
  });

  test("the followed clip is what the step hands on", async () => {
    const { stepOf, finish } = await clipsThenFollow("TikTok");
    const cut = await stepOf("clips");
    for (const job of cut.jobs)
      await finish(job._id, [{ file_url: "https://files.example/c.mp4" }]);
    const follow = await stepOf("follow_1");
    for (const [index, job] of follow.jobs.entries()) {
      await finish(job._id, {
        file_url: `https://files.example/out/followed_${index + 1}.mp4`,
        faces: 2,
        switches: 1,
        speakers: [{ start: 0, end: 4, face: 0 }],
        path: [{ time: 0, x: 120 }],
      });
    }
    const done = await stepOf("follow_1");
    expect(done.step.status).toBe("done");
    expect(done.step.outputs[0]).toBe("https://files.example/out/followed_1.mp4");
    expect(done.step.outputs.every((url) => url.includes("followed_"))).toBe(true);
  });
});
