import { afterEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit, fakeToolkitStorage } from "./test.toolkit";

/**
 * The content library: every file a team brings in or an automation makes, with a short ID,
 * where it came from, tags, stars, and what was said in it, searchable.
 */
let toolkit: ReturnType<typeof fakeToolkitStorage> | null = null;
afterEach(() => {
  toolkit?.restore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const LINK = "https://r2.example/test-bucket";
const JOB = "ca4934e3-5b1f-4c3e-9a77-0d2f1b6e8a10";

async function studio() {
  toolkit = fakeToolkitStorage();
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const sam = await addPerson(t, "Sam Lee", [team], "member");
  const other = await addTeam(t, "Pine Studio");
  const olu = await addPerson(t, "Olu Bello", [other], "owner");
  await connectToolkit(t, team, maya.id);

  /** Uploads a file the way the browser does: start, send the bytes, finish. */
  const upload = async (fileName: string, contentType = "video/mp4", purpose?: "brand") => {
    const { uploadId } = await maya.as.action(api.storage.startUpload, {
      organizationId: team,
      fileName,
      contentType,
      size: 5000,
      ...(purpose ? { purpose } : {}),
    });
    await maya.as.mutation(api.storage.finishUpload, { uploadId });
    return uploadId;
  };
  const items = async () => (await maya.as.query(api.library.list, { organizationId: team })).items;
  const itemOf = async (uploadId: Id<"uploads">) =>
    (await t.run((ctx) =>
      ctx.db
        .query("libraryItems")
        .withIndex("by_upload", (q) => q.eq("uploadId", uploadId))
        .first(),
    ))!;

  /** An automation, and a finished run of it that started from `uploadId`. */
  const finishedRun = async (uploadId: Id<"uploads"> | null, made: string[]) =>
    await t.run(async (ctx) => {
      const automationId = await ctx.db.insert("automations", {
        organizationId: team,
        name: "Podcast clips",
        enabled: true,
        trigger: { kind: "upload", fileType: "video" },
        nodes: [],
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: maya.id,
        updatedAt: Date.now(),
      });
      const at = { x: 0, y: 0 };
      const runId = await ctx.db.insert("runs", {
        organizationId: team,
        automationId,
        automationName: "Podcast clips",
        status: "done",
        triggerKind: "upload",
        trigger: {
          file_url: `${LINK}/teams/${team}/uploads/x/episode.mp4?sig=1`,
          file_name: "episode.mp4",
          ...(uploadId ? { upload_id: uploadId } : {}),
        },
        nodes: [{ id: "cut", kind: "step", stepId: "video-split", input: {}, position: at }],
        edges: [],
        error: null,
        startedBy: null,
        finishedAt: Date.now(),
      });
      await ctx.db.insert("runSteps", {
        runId,
        organizationId: team,
        nodeId: "cut",
        status: "done",
        jobIds: [],
        outputs: made,
        error: null,
        startedAt: 0,
        finishedAt: 0,
      });
      return { runId, automationId };
    });

  return { t, team, maya, sam, other, olu, upload, items, itemOf, finishedRun, toolkit: toolkit! };
}

describe("files join the library", () => {
  test("each upload gets a short ID, a title and its source", async () => {
    const { upload, items } = await studio();
    await upload("episode-4_final.mp4");
    await upload("intro.mp3", "audio/mpeg");
    await upload("talk.mov", "video/quicktime");
    const list = await items();
    expect(list.map((item) => [item.shortId, item.title, item.kind, item.source])).toEqual([
      ["V2", "talk", "video", "upload"],
      ["A1", "intro", "audio", "upload"],
      ["V1", "episode-4 final", "video", "upload"],
    ]);
  });

  test("brand files are not content and stay out", async () => {
    const { upload, items } = await studio();
    await upload("logo.png", "image/png", "brand");
    expect(await items()).toEqual([]);
  });

  test("removing an upload takes it out; its number is never given out again", async () => {
    const { maya, upload, items } = await studio();
    const first = await upload("one.mp4");
    await maya.as.mutation(api.storage.removeUpload, { uploadId: first });
    await upload("two.mp4");
    expect((await items()).map((item) => item.shortId)).toEqual(["V2"]);
  });

  test("a run's finished files join as made from the file it started with", async () => {
    const { t, team, maya, upload, itemOf, finishedRun, toolkit } = await studio();
    const episode = await upload("episode.mp4");
    const { runId } = await finishedRun(episode, [`${LINK}/${JOB}_output_0.mp4`]);
    toolkit.put(`${JOB}_output_0.mp4`);
    await t.action(internal.files.keepFinished, { runId });

    const parent = await itemOf(episode);
    const view = await maya.as.query(api.library.get, { itemId: parent._id });
    expect(view?.made).toBe(1);
    expect(
      view?.children.map((child) => [child.shortId, child.source, child.automationName]),
    ).toEqual([["C1", "automation", "Podcast clips"]]);
    const clip = (await t.run((ctx) =>
      ctx.db
        .query("libraryItems")
        .withIndex("by_organization_and_shortId", (q) =>
          q.eq("organizationId", team).eq("shortId", "C1"),
        )
        .first(),
    ))!;
    // Kept in the team's Finished folder, so its link can always be signed again.
    expect(clip.key).toMatch(/^Finished\/Podcast clips\//);
    const clipView = await maya.as.query(api.library.get, { itemId: clip._id });
    expect(clipView?.parent).toMatchObject({ shortId: "V1", title: "episode" });

    // The same run is never added twice.
    await t.action(internal.files.keepFinished, { runId });
    expect((await maya.as.query(api.library.list, { organizationId: team })).items.length).toBe(2);
  });

  test("a run that hands back the file it started with adds nothing new", async () => {
    const { t, maya, team, upload, finishedRun } = await studio();
    const episode = await upload("episode.mp4");
    const { runId } = await finishedRun(episode, [
      `${LINK}/teams/${team}/uploads/x/episode.mp4?sig=1`,
    ]);
    await t.action(internal.files.keepFinished, { runId });
    expect((await maya.as.query(api.library.list, { organizationId: team })).items).toHaveLength(1);
  });

  test("files the team had before the library are added once, oldest first", async () => {
    const { t, team, maya, finishedRun } = await studio();
    await t.run((ctx) =>
      ctx.db.insert("uploads", {
        organizationId: team,
        key: "uploads/a/old.mp4",
        fileName: "old.mp4",
        contentType: "video/mp4",
        size: 10,
        status: "ready",
        createdBy: maya.id,
      }),
    );
    await finishedRun(null, [`${LINK}/${JOB}_clip.mp4`]);
    await maya.as.mutation(api.library.fill, { organizationId: team });
    await maya.as.mutation(api.library.fill, { organizationId: team });
    const list = await maya.as.query(api.library.list, { organizationId: team });
    expect(list.filled).toBe(true);
    expect(list.items.map((item) => item.shortId)).toEqual(["C1", "V1"]);
  });
});

describe("files follow the Files page", () => {
  test("a renamed file keeps its library entry; a deleted one leaves", async () => {
    const { t, team, upload, itemOf } = await studio();
    const episode = await upload("episode.mp4");
    const item = await itemOf(episode);
    await t.mutation(internal.files.followRecords, {
      organizationId: team,
      moves: [{ from: item.key!, to: "shows/episode.mp4", etag: "e" }],
    });
    expect((await t.run((ctx) => ctx.db.get(item._id)))?.key).toBe("shows/episode.mp4");
    await t.mutation(internal.files.followRecords, {
      organizationId: team,
      moves: [{ from: "shows/episode.mp4", to: null, etag: "" }],
    });
    expect(await t.run((ctx) => ctx.db.get(item._id))).toBeNull();
  });
});

describe("names, tags and stars", () => {
  test("anyone on the team renames, tags and stars a file", async () => {
    const { sam, team, upload, itemOf } = await studio();
    const item = await itemOf(await upload("episode.mp4"));
    await sam.as.mutation(api.library.rename, { itemId: item._id, title: "  Episode 4  " });
    await sam.as.mutation(api.library.setTags, {
      itemId: item._id,
      tags: ["Pricing", "#Q&A", "pricing"],
    });
    await sam.as.mutation(api.library.setRating, { itemId: item._id, rating: 4 });
    const list = await sam.as.query(api.library.list, { organizationId: team });
    expect(list.items[0]).toMatchObject({
      title: "Episode 4",
      tags: ["pricing", "q&a"],
      rating: 4,
    });
    expect(list.tags).toEqual(["pricing", "q&a"]);
    await sam.as.mutation(api.library.setRating, { itemId: item._id, rating: null });
    expect(
      (await sam.as.query(api.library.list, { organizationId: team })).items[0].rating,
    ).toBeNull();
  });

  test("a rating is a whole number of stars from one to five", async () => {
    const { maya, upload, itemOf } = await studio();
    const item = await itemOf(await upload("episode.mp4"));
    await expect(
      maya.as.mutation(api.library.setRating, { itemId: item._id, rating: 6 }),
    ).rejects.toThrow(/one to five/);
    await expect(
      maya.as.mutation(api.library.setRating, { itemId: item._id, rating: 2.5 }),
    ).rejects.toThrow(/one to five/);
  });

  test("another team cannot see or change the files", async () => {
    const { olu, team, upload, itemOf } = await studio();
    const item = await itemOf(await upload("episode.mp4"));
    await expect(olu.as.query(api.library.list, { organizationId: team })).rejects.toThrow();
    await expect(olu.as.query(api.library.get, { itemId: item._id })).rejects.toThrow();
    await expect(
      olu.as.mutation(api.library.rename, { itemId: item._id, title: "Mine" }),
    ).rejects.toThrow();
    await expect(
      olu.as.query(api.library.search, { organizationId: team, text: "episode" }),
    ).rejects.toThrow();
  });
});

describe("searching", () => {
  async function searchable() {
    const setup = await studio();
    const { t, maya, team, upload, itemOf } = setup;
    const episode = await itemOf(await upload("episode.mp4"));
    const sent = await maya.as.action(api.library.makeSearchable, {
      organizationId: team,
      itemIds: [episode._id],
    });
    const job = (await t.run((ctx) =>
      ctx.db
        .query("jobs")
        .filter((q) => q.eq(q.field("libraryItemId"), episode._id))
        .first(),
    ))!;
    return { ...setup, episode, sent, job };
  }

  test("making a file searchable transcribes it on the team's own toolkit", async () => {
    const { maya, team, sent, job, episode } = await searchable();
    expect(sent).toBe(1);
    expect(job.stepId).toBe("media-transcribe");
    expect(job.input).toMatchObject({ include_segments: true, response_type: "cloud" });
    expect(String(job.input.media_url)).toContain(`teams/${team}/${episode.key}`);
    const list = await maya.as.query(api.library.list, { organizationId: team });
    expect(list.items[0].searchable).toBe("working");
    // The job is the library's, not a step someone ran by hand.
    expect(await maya.as.query(api.jobs.outputs, { organizationId: team })).toEqual([]);
  });

  test("finds the moment something was said, and the file by its name, tag or ID", async () => {
    const { t, maya, team, job, episode } = await searchable();
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "https://toolkit.example/segments.json") {
        return new Response(
          JSON.stringify([
            { start: 0, end: 10, text: " Welcome back.", tokens: [1] },
            { start: 61, end: 70, text: " Let's talk about pricing your services.", tokens: [2] },
          ]),
        );
      }
      return realFetch(input, init);
    });
    await t.mutation(internal.jobs.finish, {
      jobId: job._id,
      ok: true,
      result: { text: null, segments: null, segments_url: "https://toolkit.example/segments.json" },
    });
    await t.action(internal.library.readTranscript, { jobId: job._id });

    const view = await maya.as.query(api.library.get, { itemId: episode._id });
    expect(view?.searchable).toBe("ready");
    expect(view?.pieces).toEqual([
      { start: 0, end: 10, text: "Welcome back." },
      { start: 61, end: 70, text: "Let's talk about pricing your services." },
    ]);

    const said = await maya.as.query(api.library.search, { organizationId: team, text: "pricing" });
    expect(said.map((hit) => [hit.shortId, hit.moments])).toEqual([
      ["V1", [{ start: 61, text: "Let's talk about pricing your services." }]],
    ]);

    await maya.as.mutation(api.library.setTags, { itemId: episode._id, tags: ["interviews"] });
    const tagged = await maya.as.query(api.library.search, {
      organizationId: team,
      text: "interviews",
    });
    expect(tagged.map((hit) => hit.shortId)).toEqual(["V1"]);
    const byId = await maya.as.query(api.library.search, { organizationId: team, text: "v1" });
    expect(byId.map((hit) => hit.shortId)).toEqual(["V1"]);
    expect(
      await maya.as.query(api.library.byShortId, { organizationId: team, shortId: "#v1" }),
    ).toMatchObject({ shortId: "V1", title: "episode" });
  });

  test("a failed transcription says so, and can be tried again", async () => {
    const { t, maya, team, job, episode } = await searchable();
    await t.mutation(internal.jobs.finish, { jobId: job._id, ok: false, error: "No sound." });
    await t.action(internal.library.readTranscript, { jobId: job._id });
    const view = await maya.as.query(api.library.get, { itemId: episode._id });
    expect(view?.searchable).toBe("failed");
    expect(view?.transcriptError).toBe("No sound.");
    expect(
      await maya.as.action(api.library.makeSearchable, {
        organizationId: team,
        itemIds: [episode._id],
      }),
    ).toBe(1);
  });

  test("pictures are not transcribed", async () => {
    const { maya, team, upload, itemOf } = await studio();
    const still = await itemOf(await upload("still.png", "image/png"));
    expect(
      await maya.as.action(api.library.makeSearchable, {
        organizationId: team,
        itemIds: [still._id],
      }),
    ).toBe(0);
  });

  test("with the setting on, each new video is transcribed as it arrives", async () => {
    vi.useFakeTimers();
    const { t, maya, sam, team, upload } = await studio();
    await expect(
      sam.as.mutation(api.library.setSearchNewFiles, { organizationId: team, on: true }),
    ).rejects.toThrow(/owner or admin/);
    await maya.as.mutation(api.library.setSearchNewFiles, { organizationId: team, on: true });
    await upload("episode.mp4");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const jobs = await t.run((ctx) => ctx.db.query("jobs").collect());
    expect(jobs.filter((job) => job.stepId === "media-transcribe")).toHaveLength(1);
  });
});

describe("running an automation on a library file", () => {
  test("starts the automation on that file, and what it makes is made from it", async () => {
    const { t, maya, team, upload, itemOf, finishedRun } = await studio();
    const episode = await itemOf(await upload("episode.mp4"));
    const { automationId } = await finishedRun(null, []);
    await t.run((ctx) =>
      ctx.db.patch(automationId, {
        nodes: [
          {
            id: "thumb",
            kind: "step",
            stepId: "video-thumbnail",
            input: {},
            position: { x: 0, y: 0 },
          },
        ],
      }),
    );
    const runId = await maya.as.action(api.library.runAutomation, {
      itemId: episode._id,
      automationId,
    });
    const run = (await t.run((ctx) => ctx.db.get(runId)))!;
    expect(run.trigger).toMatchObject({ library_item: episode._id, file_name: "episode" });
    expect(String(run.trigger.file_url)).toContain(`teams/${team}/${episode.key}`);
  });

  test("only the team's own automations", async () => {
    const { t, other, olu, maya, upload, itemOf } = await studio();
    const episode = await itemOf(await upload("episode.mp4"));
    const theirs = await t.run((ctx) =>
      ctx.db.insert("automations", {
        organizationId: other,
        name: "Theirs",
        enabled: true,
        trigger: { kind: "manual" },
        nodes: [],
        edges: [],
        hookToken: "t",
        nextRunAt: null,
        createdBy: olu.id,
        updatedAt: Date.now(),
      }),
    );
    await expect(
      maya.as.action(api.library.runAutomation, { itemId: episode._id, automationId: theirs }),
    ).rejects.toThrow(/not on your team/);
  });
});

describe("caption files", () => {
  const SRT =
    "1\n00:00:01,000 --> 00:00:03,000\nWelcome back.\n\n2\n00:00:04,500 --> 00:00:07,000\nToday we talk about pricing.\n";

  /** Answers the bucket's links to caption files with `body` (or a 404 when it is null). */
  function captionFiles(body: string | null) {
    const before = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://r2.example/") && /\.(srt|vtt|ass)\?/.test(url)) {
        return body === null ? new Response("gone", { status: 404 }) : new Response(body);
      }
      return before(input, init);
    });
  }

  /**
   * Lets what was just scheduled (reading the caption file) run to its end, on the real clock:
   * moving a fake clock far ahead would run the sign-in clean-up too.
   */
  async function settle(t: ReturnType<typeof backend>) {
    for (let round = 0; round < 3; round++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await t.finishInProgressScheduledFunctions();
    }
  }

  test("an uploaded SRT shows its lines with their times, and they can be searched", async () => {
    const { t, team, maya, upload, itemOf } = await studio();
    captionFiles(SRT);
    const uploadId = await upload("episode 4.srt", "application/x-subrip");
    await settle(t);

    const file = await itemOf(uploadId);
    const view = await maya.as.query(api.library.get, { itemId: file._id });
    expect(view).toMatchObject({ shortId: "F1", captionFormat: "srt", searchable: "ready" });
    expect(view?.pieces).toEqual([
      { start: 1, end: 3, text: "Welcome back." },
      { start: 4.5, end: 7, text: "Today we talk about pricing." },
    ]);
    const hits = await maya.as.query(api.library.search, { organizationId: team, text: "pricing" });
    expect(hits.map((hit) => [hit.shortId, hit.moments])).toEqual([
      ["F1", [{ start: 4.5, text: "Today we talk about pricing." }]],
    ]);
  });

  test("captions a run made go with the clip made alongside them", async () => {
    const { t, maya, upload, finishedRun, toolkit } = await studio();
    captionFiles("WEBVTT\n\n00:01.000 --> 00:02.000\nHi\n");
    const episode = await upload("episode.mp4");
    const { runId } = await finishedRun(episode, [
      `${LINK}/${JOB}_output_0.mp4`,
      `${LINK}/${JOB}_output_0.vtt`,
    ]);
    toolkit.put(`${JOB}_output_0.mp4`);
    toolkit.put(`${JOB}_output_0.vtt`);
    await t.action(internal.files.keepFinished, { runId });
    await settle(t);

    const made = await t.run((ctx) =>
      ctx.db
        .query("libraryItems")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect(),
    );
    const captions = made.find((item) => item.kind === "other")!;
    const clip = made.find((item) => item.kind === "video")!;
    const view = await maya.as.query(api.library.get, { itemId: captions._id });
    expect(view?.captionFormat).toBe("vtt");
    expect(view?.captionsFor).toEqual({ _id: clip._id, shortId: clip.shortId, title: clip.title });
    expect(view?.pieces).toEqual([{ start: 1, end: 2, text: "Hi" }]);
  });

  test("a caption file that cannot be read says so, and can be read again", async () => {
    const { t, team, maya, upload, itemOf } = await studio();
    captionFiles(null);
    const uploadId = await upload("broken.ass", "text/x-ssa");
    await settle(t);
    const file = await itemOf(uploadId);
    expect(await maya.as.query(api.library.get, { itemId: file._id })).toMatchObject({
      searchable: "failed",
      transcriptError: "The caption file could not be read.",
    });

    vi.unstubAllGlobals();
    toolkit!.restore();
    toolkit = fakeToolkitStorage();
    captionFiles(
      "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\an2}Fixed\n",
    );
    const sent = await maya.as.action(api.library.makeSearchable, {
      organizationId: team,
      itemIds: [file._id],
    });
    expect(sent).toBe(1);
    await settle(t);
    const view = await maya.as.query(api.library.get, { itemId: file._id });
    expect(view?.searchable).toBe("ready");
    expect(view?.pieces).toEqual([{ start: 1, end: 2, text: "Fixed" }]);
    // No transcription job: the lines were already in the file.
    const jobs = await t.run((ctx) => ctx.db.query("jobs").collect());
    expect(jobs.filter((job) => job.stepId === "media-transcribe")).toEqual([]);
  });
});
