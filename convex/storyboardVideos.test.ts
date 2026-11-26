import { composeProblem } from "@takewon/step-catalog";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/crypto";
import { CANVAS, sceneRequest, type Segment, segmentLength } from "./lib/storyboardRender";
import { addPerson, addTeam, backend } from "./test.setup";

/**
 * "Make the video": each take of a storyboard is made in its scene by its own job, then the
 * takes are joined in order and the video goes to Files.
 */

const YOU = { url: "https://files.example/take.mp4", kind: "video" as const, start: 2, end: 5.5 };
const GRAPHIC = { url: "https://files.example/chart.png", kind: "image" as const };
const RECORDING = { url: "https://files.example/page.mp4", kind: "video" as const };

const filtersOf = (request: Record<string, unknown>) =>
  (request.filters as { filter: string }[]).map((one) => one.filter);
const optionsOf = (request: Record<string, unknown>) =>
  (request.outputs as { options: { option: string; argument?: unknown }[] }[])[0].options;

describe("the request that makes one take", () => {
  const scenes = ["full", "panel", "centre", "graphic", "circle"] as const;

  test("every scene in every shape is made at the shape's size, with sound, and is safe", () => {
    for (const aspect of ["16:9", "9:16", "1:1", "4:5"] as const) {
      for (const scene of scenes) {
        const request = sceneRequest({ scene, you: YOU, shown: GRAPHIC, hold: 3 }, aspect);
        expect(composeProblem(request)).toBeNull();
        const filters = filtersOf(request);
        expect(filters.some((filter) => filter.endsWith("[v]"))).toBe(true);
        expect(filters.some((filter) => filter.endsWith("[a]"))).toBe(true);
        const { width, height } = CANVAS[aspect];
        const options = optionsOf(request);
        // Every take is made the same way, so they can be joined as they are.
        expect(options).toEqual(
          expect.arrayContaining([
            { option: "-r", argument: 30 },
            { option: "-ar", argument: 48000 },
            { option: "-ac", argument: 2 },
            { option: "-t", argument: "3.5" },
          ]),
        );
        if (scene === "full") {
          expect(filters[0]).toContain(`crop=${width}:${height}`);
        }
      }
    }
  });

  test("your take plays only its stretch, and its sound is the take's sound", () => {
    const request = sceneRequest({ scene: "full", you: YOU, hold: 3 }, "16:9");
    expect(request.inputs).toEqual([
      {
        file_url: YOU.url,
        options: [
          { option: "-ss", argument: "2" },
          { option: "-t", argument: "3.5" },
        ],
      },
    ]);
    expect(filtersOf(request).at(-1)).toContain("[0:a]aresample=48000");
  });

  test("Panel boxes you beside what is shown, under it when the video is tall", () => {
    const wide = filtersOf(
      sceneRequest({ scene: "panel", you: YOU, shown: GRAPHIC, hold: 3 }, "16:9"),
    );
    expect(wide.join(";")).toMatch(/\[base\]\[you\]overlay=\d+:48:shortest=1/);
    const tall = filtersOf(
      sceneRequest({ scene: "panel", you: YOU, shown: GRAPHIC, hold: 3 }, "9:16"),
    );
    expect(tall.join(";")).toMatch(/\[base\]\[you\]overlay=48:\d+:shortest=1/);
  });

  test("Circle puts a round crop of you over the graphic, ringed in the team's colour", () => {
    const filters = filtersOf(
      sceneRequest(
        { scene: "circle", you: YOU, shown: GRAPHIC, hold: 3, accent: "#FFC75A" },
        "16:9",
      ),
    ).join(";");
    expect(filters).toContain("color=c=#FFC75A");
    expect(filters).toContain("hypot(X-W/2,Y-H/2)");
  });

  test("Centre splits the graphic into two sides with you in the middle", () => {
    const filters = filtersOf(
      sceneRequest({ scene: "centre", you: YOU, shown: GRAPHIC, hold: 3 }, "16:9"),
    ).join(";");
    expect(filters).toContain("crop=iw/2:ih:0:0");
    expect(filters).toContain("crop=iw/2:ih:iw/2:0");
  });

  test("a line nobody says is the picture held for the line's time, over silence", () => {
    const request = sceneRequest({ scene: "graphic", shown: GRAPHIC, hold: 4 }, "16:9");
    expect(request.inputs).toEqual([
      {
        file_url: GRAPHIC.url,
        options: [
          { option: "-loop", argument: 1 },
          { option: "-framerate", argument: 30 },
          { option: "-t", argument: "4" },
        ],
      },
    ]);
    expect(filtersOf(request).at(-1)).toBe("anullsrc=r=48000:cl=stereo[a]");
  });

  test("a recording of unknown length shown alone runs for the line's time", () => {
    const segment: Segment = { scene: "full", shown: RECORDING, hold: 3 };
    const request = sceneRequest(segment, "16:9");
    expect((request.inputs as { options: unknown[] }[])[0].options).toEqual([
      { option: "-ss", argument: "0" },
      { option: "-t", argument: "3" },
    ]);
    expect(segmentLength({ ...segment, shown: { ...RECORDING, start: 0, end: 9 } })).toBe(9);
  });

  test("a take of you with no sound gets silence, so every take joins the same way", () => {
    const request = sceneRequest({ scene: "full", you: { ...YOU, audio: false }, hold: 3 }, "16:9");
    expect(filtersOf(request).at(-1)).toBe("anullsrc=r=48000:cl=stereo[a]");
  });

  test("a colour that could break out of the filters is not used", () => {
    const filters = filtersOf(
      sceneRequest(
        { scene: "circle", you: YOU, shown: GRAPHIC, hold: 3, accent: "red;movie=x" },
        "16:9",
      ),
    ).join(";");
    expect(filters).not.toContain("movie");
    expect(filters).toContain("color=c=white");
  });
});

const TOOLKIT = "https://toolkit.example";
const SCRIPT = [
  "## Open",
  "[Full Screen] Hello and welcome.",
  "[Panel · Graphic] Here is the plan.",
  "[Circle · Graphic] And here is the chart.",
  "## Close",
  "[Full Graphic · Graphic · No voice] Thanks for watching.",
  "[Full Screen] See you next time.",
].join("\n");

afterEach(() => {
  vi.useRealTimers();
});

async function setUp() {
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  const apiKeyCipher = await encryptSecret("toolkit-key");
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  await t.run(async (ctx) => {
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
      storage: { bucket: "media", endpoint: null, publicUrl: null },
    });
  });
  const projectId = await maya.as.mutation(api.projects.create, {
    organizationId: team,
    name: "Launch Video",
    package: "blank",
  });
  const storyboardId = await maya.as.mutation(api.storyboards.create, {
    projectId,
    script: SCRIPT,
  });
  const board = async () => (await maya.as.query(api.storyboards.get, { projectId }))!;
  const takes = async () => (await board()).chapters.flatMap((chapter) => chapter.takes);
  const setFile = async (number: number, part: "you" | "graphic", url: string) => {
    const take = (await takes()).find((one) => one.number === number)!;
    await maya.as.mutation(api.storyboards.setTakeFile, { takeId: take._id, part, url });
  };
  const jobsOf = (videoId: Id<"storyboardVideos">) =>
    t.run(async (ctx) => {
      const video = (await ctx.db.get(videoId))!;
      const jobs = await Promise.all(video.takes.map((take) => ctx.db.get(take.jobId)));
      return { video, jobs: jobs.map((job) => job!) };
    });
  return { t, team, maya, outsider, projectId, storyboardId, board, setFile, jobsOf };
}

describe("making a storyboard into a video", () => {
  test("makes each take in its scene, joins them in order and keeps the video in Files", async () => {
    const { t, team, maya, storyboardId, setFile, jobsOf } = await setUp();
    await setFile(1, "you", "https://files.example/all.mp4#t=0,2.5");
    await setFile(2, "you", "https://files.example/all.mp4#t=3,6");
    await setFile(2, "graphic", "https://files.example/plan.png");
    await setFile(3, "you", "https://files.example/all.mp4#t=6,9");
    await setFile(4, "graphic", "https://files.example/thanks.png");
    await setFile(5, "you", "https://files.example/all.mp4#t=9,11");

    const started = await maya.as.mutation(api.storyboardVideos.start, { storyboardId });
    // Take 3's chart is not in yet, so it is made Full Screen for now.
    expect(started).toMatchObject({ takes: 5, skipped: [], plain: [3] });

    const { video, jobs } = await jobsOf(started.videoId);
    expect(video.takes.map((take) => take.number)).toEqual([1, 2, 3, 4, 5]);
    expect(jobs.every((job) => job.stepId === "ffmpeg-compose" && job.status === "queued")).toBe(
      true,
    );
    expect(jobs.every((job) => job.storyboardVideoId === started.videoId)).toBe(true);
    expect(
      (jobs[1].input as { inputs: { file_url: string }[] }).inputs.map((one) => one.file_url),
    ).toEqual(["https://files.example/all.mp4", "https://files.example/plan.png"]);

    // A second press while it is being made is turned down.
    await expect(maya.as.mutation(api.storyboardVideos.start, { storyboardId })).rejects.toThrow(
      /being made/,
    );

    for (const [index, job] of jobs.entries()) {
      await t.mutation(internal.jobs.finish, {
        jobId: job._id,
        ok: true,
        result: [{ file_url: `https://cdn.example/take-${index + 1}.mp4` }],
      });
    }
    const listed = await maya.as.query(api.storyboardVideos.list, { storyboardId });
    expect(listed[0]).toMatchObject({ status: "working", made: 5, total: 5, joining: true });

    const joined = (await jobsOf(started.videoId)).video.joinJobId!;
    const join = await t.run(async (ctx) => (await ctx.db.get(joined))!);
    expect(join.stepId).toBe("video-concatenate");
    expect(join.input).toMatchObject({
      video_urls: [1, 2, 3, 4, 5].map((n) => ({ video_url: `https://cdn.example/take-${n}.mp4` })),
    });
    await t.mutation(internal.jobs.finish, {
      jobId: joined,
      ok: true,
      result: "https://cdn.example/joined.mp4",
    });
    await t.action(internal.storyboardVideos.keep, { videoId: started.videoId });

    const done = await maya.as.query(api.storyboardVideos.list, { storyboardId });
    expect(done[0]).toMatchObject({ status: "done", made: 5, title: "Launch Video" });
    const item = await t.run(async (ctx) => (await ctx.db.get(done[0].file!._id))!);
    expect(item).toMatchObject({
      organizationId: team,
      kind: "video",
      source: "automation",
      url: "https://cdn.example/joined.mp4",
      automationName: "Storyboard",
    });
  });

  test("one chapter can be made on its own, and takes still waiting for you are left out", async () => {
    const { maya, storyboardId, board, setFile, jobsOf } = await setUp();
    await setFile(4, "graphic", "https://files.example/thanks.png");
    const close = (await board()).chapters[1];
    const started = await maya.as.mutation(api.storyboardVideos.start, {
      storyboardId,
      chapterId: close._id,
    });
    expect(started).toMatchObject({ takes: 1, skipped: [5], plain: [] });
    const { video } = await jobsOf(started.videoId);
    expect(video.title).toBe("Launch Video, Close");
  });

  test("a take that cannot be made stops the video and says which", async () => {
    const { t, maya, storyboardId, setFile, jobsOf } = await setUp();
    await setFile(1, "you", "https://files.example/all.mp4#t=0,2.5");
    await setFile(5, "you", "https://files.example/all.mp4#t=9,11");
    const started = await maya.as.mutation(api.storyboardVideos.start, { storyboardId });
    const { jobs } = await jobsOf(started.videoId);
    await t.mutation(internal.jobs.finish, {
      jobId: jobs[1]._id,
      ok: false,
      error: "The file could not be downloaded.",
    });
    const listed = await maya.as.query(api.storyboardVideos.list, { storyboardId });
    expect(listed[0]).toMatchObject({
      status: "failed",
      error: "Take 5 could not be made. The file could not be downloaded.",
    });
    // Once it has stopped, it can be made again.
    const again = await maya.as.mutation(api.storyboardVideos.start, { storyboardId });
    expect(again).toMatchObject({ takes: 2 });
    // A file with no sound is named in plain words.
    await t.mutation(internal.jobs.finish, {
      jobId: (await jobsOf(again.videoId)).jobs[0]._id,
      ok: false,
      error:
        "Stream specifier ':a' in filtergraph description [0:a]aresample=48000 matches no streams.",
    });
    expect((await maya.as.query(api.storyboardVideos.list, { storyboardId }))[0]).toMatchObject({
      status: "failed",
      error: "Take 1 could not be made: its file has no sound. Use a recording with sound in it.",
    });
  });

  test("nothing is made before any file is in, and other teams cannot start it", async () => {
    const { maya, outsider, storyboardId } = await setUp();
    await expect(maya.as.mutation(api.storyboardVideos.start, { storyboardId })).rejects.toThrow(
      /nothing to make/,
    );
    await expect(
      outsider.as.mutation(api.storyboardVideos.start, { storyboardId }),
    ).rejects.toThrow();
    expect(await outsider.as.query(api.storyboardVideos.list, { storyboardId })).toEqual([]);
  });
});
