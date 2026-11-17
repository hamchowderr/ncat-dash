import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const FILE = "https://files.example/uploads/podcast_episode.mp4";

/** A run of one Clips step for `platform`, on a video `duration` seconds long. */
async function clipsFor(platform: string, duration: number) {
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
      name: "Clips",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: [{ id: "clips", kind: "clips", input: { platform }, position: { x: 0, y: 0 } }],
      edges: [],
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
  const look = () =>
    t.run(async (ctx) => {
      const run = (await ctx.db.get(runId))!;
      const step = (await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .first())!;
      const jobs = await Promise.all(step.jobIds.map((id) => ctx.db.get(id)));
      return { run, step, jobs: jobs.filter((job) => job !== null) };
    });

  // The step first reads the video (its length, then its pauses).
  const probes = (await look()).jobs;
  for (const job of probes) {
    await t.mutation(internal.jobs.finish, {
      jobId: job._id as Id<"jobs">,
      ok: true,
      result: job.stepId === "media-metadata" ? { duration, width: 1920, height: 1080 } : [],
      permanent: true,
    });
  }
  return { t, maya, look };
}

type Compose = { filters?: { filter: string }[] };

describe("clips made to fit each platform", () => {
  test("a video too short for the platform fails, saying how short and what it needs", async () => {
    const { look } = await clipsFor("Snapchat Spotlight", 3);
    const { step, run } = await look();
    expect(step.status).toBe("failed");
    expect(step.error).toBe("The video is 3 s long; Snapchat Spotlight needs at least 5 s.");
    expect(run.status).toBe("failed");
  });

  test("Instagram feed clips are made in 4:5", async () => {
    const { look } = await clipsFor("Instagram feed", 400);
    const { step, jobs } = await look();
    expect(step.stage).toBe("cut");
    expect(step.plan).toHaveLength(3);
    for (const job of jobs) {
      expect(job.stepId).toBe("ffmpeg-compose");
      expect((job.input as Compose).filters?.[0]?.filter).toContain("crop=1080:1350");
    }
  });

  test("YouTube parts are wide 16:9, at most 15 min each", async () => {
    const { look } = await clipsFor("YouTube", 1500);
    const { step, jobs } = await look();
    expect(step.plan?.map((clip) => clip.seconds).every((seconds) => seconds <= 900)).toBe(true);
    expect((jobs[0]?.input as Compose).filters?.[0]?.filter).toContain("crop=1920:1080");
  });

  test("X keeps the video's shape but scales it down to what X takes", async () => {
    const { look } = await clipsFor("X", 100);
    const { jobs } = await look();
    expect(jobs).toHaveLength(1);
    const filter = (jobs[0]?.input as Compose).filters?.[0]?.filter;
    expect(filter).toContain("min(iw,1280)");
    expect(filter).toContain("force_original_aspect_ratio=decrease");
  });
});

describe("the platform guide the agent reads", () => {
  test("gives the platforms asked for, from their own specs", async () => {
    const { maya } = await clipsFor("TikTok", 30);
    const { text, unknown } = await maya.as.query(api.automations.platformGuide, {
      platforms: ["TikTok", "instagram reels"],
    });
    expect(unknown).toEqual([]);
    expect(text).toContain("## TikTok");
    expect(text).toContain("## Instagram Reels");
    expect(text).toContain("developers.tiktok.com");
    expect(text).not.toContain("## LinkedIn");
  });

  test("gives every platform when none is named, and names the ones it does not know", async () => {
    const { maya } = await clipsFor("TikTok", 30);
    const all = await maya.as.query(api.automations.platformGuide, {});
    expect(all.text).toContain("## YouTube Shorts");
    expect(all.text).toContain("## Twitch clips");
    const odd = await maya.as.query(api.automations.platformGuide, { platforms: ["Myspace"] });
    expect(odd.unknown).toEqual(["Myspace"]);
  });

  test("is closed to visitors", async () => {
    const { t } = await clipsFor("TikTok", 30);
    await expect(t.query(api.automations.platformGuide, {})).rejects.toThrow(/Sign in/);
  });
});
