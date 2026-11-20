import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const FILE = "https://files.example/uploads/Station Interview.mp4";
const TRIMMED = "https://files.example/out/trimmed.mp4";

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Maya Ortiz", [team], "owner");
  const otherTeam = await addTeam(t, "Far Away");
  const stranger = await addPerson(t, "Ana Cruz", [otherTeam], "owner");
  await t.run(async (ctx) => {
    await ctx.db.insert("toolkitConnections", {
      organizationId: team,
      baseUrl: "https://toolkit.example",
      apiKeyCipher: "x",
      apiKeyHint: "1234",
      status: "ok",
      buildNumber: "204",
      lastCheckedAt: Date.now(),
      lastError: null,
      createdBy: owner.id,
    });
  });
  const make = (starterId: string, name = "") =>
    owner.as.mutation(api.automations.create, { organizationId: team, name, starterId });
  const get = (id: Id<"automations">) => t.run((ctx) => ctx.db.get(id));
  return { t, team, owner, stranger, make, get };
}

describe("ready-made follow-ons", () => {
  test("made from the list, one is wired to the team's automation it is made to follow", async () => {
    const { make, get } = await setUp();
    const clips = await make("social-clips");
    const brand = await make("brand-every-clip");
    expect(await get(clips)).toMatchObject({ starterId: "social-clips" });
    expect(await get(brand)).toMatchObject({
      starterId: "brand-every-clip",
      enabled: false,
      trigger: { kind: "finished", automationId: clips, when: "done" },
    });
  });

  test("with nothing to follow yet, it waits for one to be picked", async () => {
    const { make, get } = await setUp();
    const ready = await make("ready-to-post");
    expect((await get(ready))?.trigger).toEqual({
      kind: "finished",
      automationId: "",
      when: "done",
    });
  });

  test("are suggested after an automation, and built and switched on in one go", async () => {
    const { owner, make, get } = await setUp();
    const lyric = await make("lyric-video");
    expect(await owner.as.query(api.automations.followOns, { automationId: lyric })).toEqual({
      following: [],
      suggestions: ["lyric-video-vertical"],
    });

    const made = await owner.as.mutation(api.automations.setUpFollowOn, {
      automationId: lyric,
      starterId: "lyric-video-vertical",
    });
    expect(made).toMatchObject({ on: true, problem: null });
    expect(await get(made.automationId)).toMatchObject({
      name: "Lyric Video For Reels And Shorts",
      enabled: true,
      trigger: { kind: "finished", automationId: lyric, when: "done" },
    });

    // Once it is set up it is no longer suggested, and shows as running after it instead.
    expect(await owner.as.query(api.automations.followOns, { automationId: lyric })).toEqual({
      following: [
        {
          automationId: made.automationId,
          name: "Lyric Video For Reels And Shorts",
          enabled: true,
          when: "done",
        },
      ],
      suggestions: [],
    });
  });

  test("one that needs the brand is built but left off, saying what is missing", async () => {
    const { owner, make, get } = await setUp();
    const clips = await make("social-clips");
    const made = await owner.as.mutation(api.automations.setUpFollowOn, {
      automationId: clips,
      starterId: "brand-every-clip",
    });
    expect(made.on).toBe(false);
    expect(made.problem).toMatch(/logo/i);
    expect((await get(made.automationId))?.enabled).toBe(false);
  });

  test("the backup starts only when following the speaker fails", async () => {
    const { owner, make, get } = await setUp();
    const follow = await make("follow-speaker-vertical");
    const made = await owner.as.mutation(api.automations.setUpFollowOn, {
      automationId: follow,
      starterId: "backup-follow-speaker",
    });
    expect((await get(made.automationId))?.trigger).toEqual({
      kind: "finished",
      automationId: follow,
      when: "failed",
    });
  });

  test("a second copy after another automation is told apart by name", async () => {
    const { owner, make, get } = await setUp();
    const first = await make("social-clips", "Shorts clips");
    const second = await make("clips-follow-speaker", "Podcast clips");
    await owner.as.mutation(api.automations.setUpFollowOn, {
      automationId: first,
      starterId: "brand-every-clip",
    });
    const again = await owner.as.mutation(api.automations.setUpFollowOn, {
      automationId: second,
      starterId: "brand-every-clip",
    });
    expect((await get(again.automationId))?.name).toBe("Brand Every Clip after Podcast clips");
  });

  test("older automations are recognised by their steps", async () => {
    const { t, team, owner } = await setUp();
    const older = await t.run((ctx) =>
      ctx.db.insert("automations", {
        organizationId: team,
        name: "My episodes",
        enabled: false,
        trigger: { kind: "upload", fileType: "any" },
        nodes: [
          {
            id: "a",
            kind: "step",
            stepId: "media-to-mp3",
            input: {},
            position: { x: 0, y: 0 },
          },
          {
            id: "b",
            kind: "step",
            stepId: "media-transcribe",
            input: {},
            position: { x: 0, y: 150 },
          },
        ],
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: owner.id,
        updatedAt: Date.now(),
      }),
    );
    const followOns = await owner.as.query(api.automations.followOns, { automationId: older });
    expect(followOns.suggestions).toEqual(["episode-video-youtube"]);
    const described = await owner.as.query(api.automations.describe, { automationId: older });
    expect(described.followOns).toEqual([
      expect.objectContaining({ id: "episode-video-youtube", name: "Episode Video For YouTube" }),
    ]);
  });

  test("refuses ready-mades that are not follow-ons, and people outside the team", async () => {
    const { owner, stranger, make } = await setUp();
    const clips = await make("social-clips");
    await expect(
      owner.as.mutation(api.automations.setUpFollowOn, {
        automationId: clips,
        starterId: "caption-uploads",
      }),
    ).rejects.toThrow(/starts by itself/);
    await expect(
      owner.as.mutation(api.automations.setUpFollowOn, {
        automationId: clips,
        starterId: "nothing-like-it",
      }),
    ).rejects.toThrow(/Unknown/);
    await expect(
      stranger.as.mutation(api.automations.setUpFollowOn, {
        automationId: clips,
        starterId: "brand-every-clip",
      }),
    ).rejects.toThrow();
    await expect(
      stranger.as.query(api.automations.followOns, { automationId: clips }),
    ).rejects.toThrow();
  });
});

describe("a follow-on's run", () => {
  test("gets the finished files and the name of the file that started the first run", async () => {
    const { t, team, owner, get } = await setUp();
    const trim = await t.run((ctx) =>
      ctx.db.insert("automations", {
        organizationId: team,
        name: "Trim",
        enabled: true,
        trigger: { kind: "manual" },
        nodes: [
          { id: "trim", kind: "step", stepId: "video-trim", input: {}, position: { x: 0, y: 0 } },
        ],
        edges: [],
        hookToken: "token-trim",
        nextRunAt: null,
        createdBy: owner.id,
        updatedAt: Date.now(),
      }),
    );
    const made = await owner.as.mutation(api.automations.setUpFollowOn, {
      automationId: trim,
      starterId: "every-shape-after-captions",
    });
    expect(made.on).toBe(true);

    const runId = await t.run(async (ctx) => {
      const automation = (await ctx.db.get(trim))!;
      const started = await startRun(
        ctx,
        automation,
        "manual",
        { file_url: FILE, file_name: "Station Interview.mp4" },
        owner.id,
      );
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
    const jobId = await t.run(async (ctx) => {
      const [step] = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect();
      return step.jobIds[0];
    });
    await t.mutation(internal.jobs.finish, { jobId, ok: true, result: TRIMMED, permanent: true });

    const [follower] = await t.run((ctx) =>
      ctx.db
        .query("runs")
        .withIndex("by_automation", (q) => q.eq("automationId", made.automationId))
        .collect(),
    );
    expect(follower).toMatchObject({
      triggerKind: "finished",
      trigger: { file_url: TRIMMED, files: [TRIMMED], file_name: "Station Interview.mp4" },
      parentRunId: runId,
    });
    expect((await get(made.automationId))?.name).toBe("Every Shape After Captions");
  });
});
