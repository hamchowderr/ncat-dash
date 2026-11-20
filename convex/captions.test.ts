import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const FILE = "https://files.example/uploads/talk.mp4";

const CAPTIONS = {
  fixes: [
    { find: "chowder", replace: "Chowderr" },
    { find: "otaku", replace: "Otaku" },
  ],
  styles: [
    { name: "Tall", look: { style: "highlight" as const, font_size: 100, word_color: "#FF0000" } },
    { name: "Plain", look: { style: "classic" as const, font_size: 50 } },
  ],
  byShape: { vertical: "Tall", wide: "Plain" },
};

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Maya Ortiz", [team], "owner");
  const member = await addPerson(t, "Sam Lee", [team]);
  return { t, team, owner, member };
}

type Setup = Awaited<ReturnType<typeof setUp>>;

/** A run of one caption step on FILE, started with `trigger`. */
async function captionRun(
  { t, team, owner }: Setup,
  input: Record<string, unknown>,
  trigger: Record<string, unknown> = { file_url: FILE },
  stepId = "video-caption",
) {
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
      createdBy: owner.id,
    });
    const automationId = await ctx.db.insert("automations", {
      organizationId: team,
      name: "Captions",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: [{ id: "caption_1", kind: "step", stepId, input, position: { x: 0, y: 0 } }],
      edges: [],
      hookToken: "token",
      nextRunAt: null,
      createdBy: owner.id,
      updatedAt: Date.now(),
    });
    const automation = (await ctx.db.get(automationId))!;
    const started = await startRun(ctx, automation, "webhook", trigger, owner.id);
    if (!started.ok) throw new Error(started.message);
    return started.runId;
  });
  const caption = () =>
    t.run(async (ctx) => {
      const step = (await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .first())!;
      const jobs = await Promise.all(step.jobIds.map((id) => ctx.db.get(id)));
      return { step, jobs: jobs.filter((job) => job !== null) };
    });
  const finish = (jobId: Id<"jobs">, result: unknown, ok = true) =>
    t.mutation(internal.jobs.finish, {
      jobId,
      ok,
      result,
      ...(ok ? {} : { error: "Could not read the file." }),
      permanent: true,
    });
  return { caption, finish };
}

describe("the team's caption settings", () => {
  test("start empty, with the built-in styles listed", async () => {
    const { team, member } = await setUp();
    const settings = await member.as.query(api.teamSettings.get, { organizationId: team });
    expect(settings.captions).toEqual({ fixes: [], styles: [], byShape: {} });
    expect(settings.builtInCaptionStyles.map((style) => style.name)).toEqual([
      "Bold highlight",
      "Clean",
      "Karaoke",
      "One word",
    ]);
    expect(settings.builtInByShape).toEqual({
      vertical: "Bold highlight",
      square: "Bold highlight",
      wide: "Clean",
    });
  });

  test("are saved tidied by an owner and seen by the team", async () => {
    const setup = await setUp();
    const { team, owner, member } = setup;
    await owner.as.mutation(api.teamSettings.setCaptions, {
      organizationId: team,
      captions: {
        ...CAPTIONS,
        fixes: [...CAPTIONS.fixes, { find: " ", replace: "" }],
        byShape: { vertical: "tall", wide: "Plain", square: "Karaoke" },
      },
    });
    const settings = await member.as.query(api.teamSettings.get, { organizationId: team });
    expect(settings.captions.fixes).toEqual(CAPTIONS.fixes);
    expect(settings.captions.byShape).toEqual({
      vertical: "Tall",
      wide: "Plain",
      square: "Karaoke",
    });
    const brief = await member.as.query(api.teamSettings.agentBrief, { organizationId: team });
    expect(brief.text).toContain('vertical videos get "Tall"');
  });

  test("can only be changed by owners and admins, and must make sense", async () => {
    const { team, owner, member } = await setUp();
    await expect(
      member.as.mutation(api.teamSettings.setCaptions, {
        organizationId: team,
        captions: CAPTIONS,
      }),
    ).rejects.toThrow();
    await expect(
      owner.as.mutation(api.teamSettings.setCaptions, {
        organizationId: team,
        captions: { ...CAPTIONS, fixes: [{ find: "two words", replace: "x" }] },
      }),
    ).rejects.toThrow(/more than one word/);
  });

  test("keep the rest of the team's settings", async () => {
    const { team, owner } = await setUp();
    await owner.as.mutation(api.teamSettings.setBrand, {
      organizationId: team,
      brand: { color: "#FFCC00" },
    });
    await owner.as.mutation(api.teamSettings.setCaptions, {
      organizationId: team,
      captions: CAPTIONS,
    });
    const settings = await owner.as.query(api.teamSettings.get, { organizationId: team });
    expect(settings.brand.color).toBe("#FFCC00");
    expect(settings.captions.styles).toHaveLength(2);
  });
});

describe("a caption step in a run", () => {
  test("reads the video's shape, then uses the team's style for it and its word fixes", async () => {
    const setup = await setUp();
    await setup.owner.as.mutation(api.teamSettings.setCaptions, {
      organizationId: setup.team,
      captions: CAPTIONS,
    });
    const { caption, finish } = await captionRun(setup, {});
    const reading = await caption();
    expect(reading.step.stage).toBe("size");
    expect(reading.jobs.map((job) => job.stepId)).toEqual(["media-metadata"]);
    expect(reading.jobs[0].input).toEqual({ media_url: FILE });

    await finish(reading.jobs[0]._id, { width: 2160, height: 3840, duration: 30 });
    const captioning = await caption();
    // First the timed words, with the look and word fixes...
    expect(captioning.step.stage).toBe("listen");
    expect(captioning.step.status).toBe("running");
    expect(captioning.jobs).toHaveLength(1);
    expect(captioning.jobs[0].stepId).toBe("media-generate-ass");
    expect(captioning.jobs[0].input).toEqual({
      media_url: FILE,
      // "Tall" for a vertical video, its text scaled for 4K.
      settings: { style: "highlight", font_size: 200, word_color: "#FF0000" },
      replace: CAPTIONS.fixes,
    });

    await finish(captioning.jobs[0]._id, "https://files.example/out/words.ass");
    // ...then one quick save that burns them into the video.
    const burning = await caption();
    expect(burning.step.stage).toBe("render");
    expect(burning.jobs).toHaveLength(1);
    expect(burning.jobs[0].stepId).toBe("ffmpeg-compose");
    const burn = burning.jobs[0].input as {
      inputs: { file_url: string }[];
      filters: { filter: string }[];
      outputs: { options: { option: string; argument?: unknown }[] }[];
    };
    expect(burn.inputs).toEqual([{ file_url: FILE }]);
    expect(burn.filters[0].filter).toBe(
      "[0:v]ass='https://files.example/out/words.ass',setsar=1[v]",
    );
    expect(burn.outputs[0].options).toContainEqual({ option: "-preset", argument: "veryfast" });

    await finish(burning.jobs[0]._id, { file_url: "https://files.example/out/captioned.mp4" });
    const done = await caption();
    expect(done.step.status).toBe("done");
    expect(done.step.outputs).toEqual(["https://files.example/out/captioned.mp4"]);
  });

  test("uses the details an upload already has, without reading the file again", async () => {
    const setup = await setUp();
    await setup.owner.as.mutation(api.teamSettings.setCaptions, {
      organizationId: setup.team,
      captions: CAPTIONS,
    });
    const { caption } = await captionRun(
      setup,
      {},
      { file_url: FILE, details: { width: 1920, height: 1080 } },
    );
    const { step, jobs } = await caption();
    expect(step.stage).toBe("listen");
    expect(jobs[0].stepId).toBe("media-generate-ass");
    expect(jobs[0].input).toMatchObject({ settings: { style: "classic", font_size: 50 } });
  });

  test("a team with nothing set gets the built-in style for the shape", async () => {
    const setup = await setUp();
    const { caption } = await captionRun(
      setup,
      {},
      { file_url: FILE, details: { width: 1080, height: 1920 } },
    );
    const { jobs } = await caption();
    expect(jobs[0].input).toMatchObject({
      settings: { style: "highlight", all_caps: true, word_color: "#F2B33D" },
    });
    expect(jobs[0].input).not.toHaveProperty("replace");
  });

  test("a picked style and the step's own settings win; the style's name is not sent", async () => {
    const setup = await setUp();
    await setup.owner.as.mutation(api.teamSettings.setCaptions, {
      organizationId: setup.team,
      captions: CAPTIONS,
    });
    const { caption } = await captionRun(
      setup,
      {
        caption_style: "Karaoke",
        settings: { word_color: "#00FF00" },
        replace: [{ find: "otaku", replace: "OTAKU" }],
      },
      { file_url: FILE, details: { width: 1080, height: 1920 } },
    );
    const { jobs } = await caption();
    const input = jobs[0].input as Record<string, unknown>;
    expect(input).not.toHaveProperty("caption_style");
    expect(input.settings).toMatchObject({ style: "karaoke", word_color: "#00FF00" });
    expect(input.replace).toEqual([
      { find: "otaku", replace: "OTAKU" },
      { find: "chowder", replace: "Chowderr" },
    ]);
  });

  test("a step with its own look keeps it, still with the team's word fixes", async () => {
    const setup = await setUp();
    await setup.owner.as.mutation(api.teamSettings.setCaptions, {
      organizationId: setup.team,
      captions: CAPTIONS,
    });
    const { caption } = await captionRun(setup, { settings: { style: "underline" } });
    const { step, jobs } = await caption();
    expect(step.stage).toBe("listen");
    expect(jobs[0].input).toEqual({
      media_url: FILE,
      settings: { style: "underline" },
      replace: CAPTIONS.fixes,
    });
  });

  test("a video that cannot be read is still captioned", async () => {
    const setup = await setUp();
    await setup.owner.as.mutation(api.teamSettings.setCaptions, {
      organizationId: setup.team,
      captions: CAPTIONS,
    });
    const { caption, finish } = await captionRun(setup, {});
    const reading = await caption();
    await finish(reading.jobs[0]._id, null, false);
    const { step, jobs } = await caption();
    expect(step.status).toBe("running");
    expect(jobs[0].stepId).toBe("media-generate-ass");
    // Shapes get different styles, so with no shape the toolkit's own look is used.
    expect(jobs[0].input).toEqual({ media_url: FILE, replace: CAPTIONS.fixes });
  });

  test("captions the team typed itself still go to the caption route, the only one that takes text", async () => {
    const setup = await setUp();
    const { caption } = await captionRun(
      setup,
      { captions: "Hello there", settings: { style: "classic" } },
      { file_url: FILE, details: { width: 1920, height: 1080 } },
    );
    const { step, jobs } = await caption();
    expect(step.stage).toBeUndefined();
    expect(jobs[0].stepId).toBe("video-caption");
    expect(jobs[0].input).toMatchObject({ video_url: FILE, captions: "Hello there" });
  });

  test("when the words can't be found, the step fails with the toolkit's reason", async () => {
    const setup = await setUp();
    const { caption, finish } = await captionRun(setup, { settings: { style: "underline" } });
    const words = await caption();
    await finish(words.jobs[0]._id, null, false);
    const after = await caption();
    // A failed job gets its usual tries again first; it is never burned in without words.
    expect(after.jobs.some((job) => job.stepId === "ffmpeg-compose")).toBe(false);
  });

  test("Generate caption file gets the same treatment", async () => {
    const setup = await setUp();
    await setup.owner.as.mutation(api.teamSettings.setCaptions, {
      organizationId: setup.team,
      captions: CAPTIONS,
    });
    const { caption } = await captionRun(
      setup,
      {},
      { file_url: FILE, details: { width: 1920, height: 1080 } },
      "media-generate-ass",
    );
    const { jobs } = await caption();
    expect(jobs[0].input).toEqual({
      media_url: FILE,
      settings: { style: "classic", font_size: 50 },
      replace: CAPTIONS.fixes,
    });
  });
});
