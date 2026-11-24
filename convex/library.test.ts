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

describe("files for a client", () => {
  test("what a client's run makes is for that client; the episode can be moved, clips follow", async () => {
    const { t, team, maya, olu, other, upload, itemOf, finishedRun, toolkit } = await studio();
    const acme = await maya.as.mutation(api.clients.create, {
      organizationId: team,
      name: "Acme Coffee",
    });
    const episode = await upload("episode.mp4");
    const { runId } = await finishedRun(episode, [`${LINK}/${JOB}_output_0.mp4`]);
    await t.run((ctx) => ctx.db.patch(runId, { clientId: acme }));
    toolkit.put(`${JOB}_output_0.mp4`);
    await t.action(internal.files.keepFinished, { runId });

    let list = await maya.as.query(api.library.list, { organizationId: team });
    expect(list.clients).toEqual([{ _id: acme, name: "Acme Coffee" }]);
    expect(list.items.map((item) => [item.shortId, item.client?.name ?? null])).toEqual([
      ["C1", "Acme Coffee"],
      ["V1", null],
    ]);

    // The episode is for Acme too; its clip already is, and stays.
    const parent = await itemOf(episode);
    await maya.as.mutation(api.library.setClient, { itemId: parent._id, clientId: acme });
    // Back to the team: the clip that went with Acme follows.
    await maya.as.mutation(api.library.setClient, { itemId: parent._id, clientId: null });
    list = await maya.as.query(api.library.list, { organizationId: team });
    expect(list.items.map((item) => item.client)).toEqual([null, null]);
    await maya.as.mutation(api.library.setClient, { itemId: parent._id, clientId: acme });
    list = await maya.as.query(api.library.list, { organizationId: team });
    expect(list.items.map((item) => item.client?.name)).toEqual(["Acme Coffee", "Acme Coffee"]);

    // Another team's client, or someone from another team, is turned away.
    const theirs = await olu.as.mutation(api.clients.create, {
      organizationId: other,
      name: "Birch",
    });
    await expect(
      maya.as.mutation(api.library.setClient, { itemId: parent._id, clientId: theirs }),
    ).rejects.toThrow(/client is gone/);
    await expect(
      olu.as.mutation(api.library.setClient, { itemId: parent._id, clientId: theirs }),
    ).rejects.toThrow();

    // Search results say who a file is for.
    const hits = await maya.as.query(api.library.search, { organizationId: team, text: "C1" });
    expect(hits[0]?.client?.name).toBe("Acme Coffee");
  });

  test("deleting a client keeps its files, as the team's own", async () => {
    const { team, maya, upload, itemOf, items } = await studio();
    const acme = await maya.as.mutation(api.clients.create, {
      organizationId: team,
      name: "Acme Coffee",
    });
    const episode = await upload("episode.mp4");
    await maya.as.mutation(api.library.setClient, {
      itemId: (await itemOf(episode))._id,
      clientId: acme,
    });
    await maya.as.mutation(api.clients.remove, { clientId: acme });
    const left = await items();
    expect(left.map((item) => [item.shortId, item.client])).toEqual([["V1", null]]);
    expect((await itemOf(episode)).clientId).toBeUndefined();
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
    vi.useFakeTimers();
    const setup = await studio();
    const { t, upload, itemOf } = setup;
    const episode = await itemOf(await upload("episode.mp4"));
    // Brought in, so it is sent to be transcribed straight away. The toolkit queues it.
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === "https://toolkit.example/v1/media/transcribe"
        ? new Response(JSON.stringify({ code: 202, job_id: "tk-transcribe" }), { status: 202 })
        : realFetch(input, init),
    );
    // A second at a time: the pools (lib/pools.ts) take a few to hand work on.
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000));
    vi.stubGlobal("fetch", realFetch);
    vi.useRealTimers();
    const job = (await t.run((ctx) =>
      ctx.db
        .query("jobs")
        .filter((q) => q.eq(q.field("libraryItemId"), episode._id))
        .first(),
    ))!;
    return { ...setup, episode: (await itemOf(episode.uploadId!))!, job };
  }

  test("a file brought in is transcribed on the team's own toolkit", async () => {
    const { maya, team, job, episode } = await searchable();
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

  test("Uploads knows where each file's transcript is", async () => {
    const { maya, team, episode } = await searchable();
    const uploads = await maya.as.query(api.storage.listUploads, { organizationId: team });
    expect(uploads[0]).toMatchObject({ libraryItemId: episode._id, transcript: "working" });
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

  test("every video or sound brought in is transcribed as it arrives, with word timings", async () => {
    vi.useFakeTimers();
    const { t, upload } = await studio();
    // The team never turned the setting on: what comes in is transcribed anyway.
    await upload("episode.mp4");
    await upload("intro.mp3", "audio/mpeg");
    await upload("still.png", "image/png");
    await upload("logo.png", "image/png", "brand");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const jobs = (await t.run((ctx) => ctx.db.query("jobs").collect())).filter(
      (job) => job.stepId === "media-transcribe",
    );
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(job.input).toMatchObject({ word_timestamps: true, include_segments: true });
    }
  });

  test("a file an automation made is transcribed only with the setting on", async () => {
    vi.useFakeTimers();
    const { t, team, upload, finishedRun, toolkit } = await studio();
    const episode = await upload("episode.mp4");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const { runId } = await finishedRun(episode, [`${LINK}/${JOB}_output_0.mp4`]);
    toolkit.put(`${JOB}_output_0.mp4`);
    await t.action(internal.files.keepFinished, { runId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const transcribed = async () =>
      (await t.run((ctx) => ctx.db.query("jobs").collect())).filter(
        (job) => job.stepId === "media-transcribe",
      ).length;
    expect(await transcribed()).toBe(1);

    // Set straight in the table: the fake clock has run far past the sign-in by now.
    await t.run((ctx) =>
      ctx.db.insert("librarySettings", { organizationId: team, searchNewFiles: true }),
    );
    const second = await finishedRun(episode, [`${LINK}/${JOB}_output_1.mp4`]);
    toolkit.put(`${JOB}_output_1.mp4`);
    await t.action(internal.files.keepFinished, { runId: second.runId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await transcribed()).toBe(2);
  });

  test("the words are kept with their timing, for subtitles and for the steps", async () => {
    const { t, maya, team, job, episode } = await searchable();
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "https://toolkit.example/segments.json") {
        return new Response(
          JSON.stringify([
            {
              start: 0,
              end: 1.6,
              text: " Welcome back everyone.",
              words: [
                { word: " Welcome", start: 0, end: 0.5 },
                { word: " back", start: 0.6, end: 0.9 },
                { word: " everyone.", start: 1, end: 1.6 },
              ],
            },
          ]),
        );
      }
      return realFetch(input, init);
    });
    await t.mutation(internal.jobs.finish, {
      jobId: job._id,
      ok: true,
      result: { segments_url: "https://toolkit.example/segments.json" },
    });
    await t.action(internal.library.readTranscript, { jobId: job._id });

    const view = await maya.as.query(api.library.get, { itemId: episode._id });
    expect(view?.pieces).toEqual([
      {
        start: 0,
        end: 1.6,
        text: "Welcome back everyone.",
        words: [
          { t: "Welcome", s: 0, e: 0.5 },
          { t: "back", s: 0.6, e: 0.9 },
          { t: "everyone.", s: 1, e: 1.6 },
        ],
      },
    ]);
    // Kept under the file's address too, where Best moments, Chapters and Clean Up Pauses
    // And Retakes look before transcribing it again.
    const source = String(job.input.media_url).split("?")[0];
    const kept = await t.run((ctx) =>
      ctx.db
        .query("spokenWords")
        .withIndex("by_source", (q) => q.eq("organizationId", team).eq("source", source))
        .first(),
    );
    expect(kept?.words.map((word) => word.t)).toEqual(["Welcome", "back", "everyone."]);
  });

  test("only owners and admins change the setting", async () => {
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

describe("catching up files brought in before every upload was transcribed", () => {
  test("each older video and sound brought in is transcribed once, by itself", async () => {
    vi.useFakeTimers();
    const { t, team, maya, sam } = await studio();
    const old = (title: string, kind: "video" | "audio" | "image", extra = {}) =>
      t.run((ctx) =>
        ctx.db.insert("libraryItems", {
          organizationId: team,
          kind,
          source: "upload",
          title,
          key: `uploads/old/${title}`,
          shortId: title,
          tags: [],
          searchText: title,
          createdBy: maya.id,
          ...extra,
        }),
      );
    const episode = await old("episode.mp4", "video");
    const theme = await old("theme.mp3", "audio");
    await old("still.png", "image");
    await old("clip.mp4", "video", { source: "automation" });
    await old("done.mp4", "video", { transcript: { status: "ready", at: 1 } });
    await old("failed.mp4", "video", {
      transcript: { status: "failed", error: "No sound.", at: 1 },
    });

    // Anyone on the team may set it off; it is what opening the dashboard does.
    expect(await sam.as.mutation(api.library.catchUpTranscripts, { organizationId: team })).toBe(2);
    // Already on their way: a second visit sends nothing more.
    expect(await maya.as.mutation(api.library.catchUpTranscripts, { organizationId: team })).toBe(
      0,
    );
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === "https://toolkit.example/v1/media/transcribe"
        ? new Response(JSON.stringify({ code: 202, job_id: "tk-transcribe" }), { status: 202 })
        : realFetch(input, init),
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(5_000));

    const jobs = (await t.run((ctx) => ctx.db.query("jobs").collect())).filter(
      (job) => job.stepId === "media-transcribe",
    );
    expect(jobs.map((job) => job.libraryItemId).sort()).toEqual([episode, theme].sort());
    for (const itemId of [episode, theme]) {
      const item = await t.run((ctx) => ctx.db.get(itemId));
      expect(item?.transcript).toMatchObject({ status: "working" });
      expect(item?.transcript?.jobId).toBeTruthy();
    }
  });

  test("another team cannot set it off", async () => {
    const { team, olu } = await studio();
    await expect(
      olu.as.mutation(api.library.catchUpTranscripts, { organizationId: team }),
    ).rejects.toThrow();
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

describe("renaming an upload renames what was made from it", () => {
  async function madeFromUpload(fileName = "IMG_4521.mp4") {
    vi.useFakeTimers();
    const s = await studio();
    const shot = await s.upload(fileName);
    await s.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000));
    const parts = [0, 1].map((n) => `${LINK}/${JOB}_output_${n}.mp4`);
    const { runId } = await s.finishedRun(shot, parts);
    // The run started from the upload under the name it had then.
    await s.t.run(async (ctx) => {
      const run = (await ctx.db.get(runId))!;
      await ctx.db.patch(runId, {
        trigger: { ...(run.trigger as object), file_name: fileName },
      });
    });
    for (const n of [0, 1]) s.toolkit.put(`${JOB}_output_${n}.mp4`);
    await s.t.action(internal.files.keepFinished, { runId });
    await s.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000));
    const parent = await s.itemOf(shot);
    const made = async () =>
      (
        await s.t.run((ctx) =>
          ctx.db
            .query("libraryItems")
            .withIndex("by_parent", (q) => q.eq("parentId", parent._id))
            .collect(),
        )
      ).sort((a, b) => a.title.localeCompare(b.title));
    return { ...s, shot, runId, parent, made };
  }

  test("each made file is named after the upload and what the step did", async () => {
    const { made } = await madeFromUpload();
    const files = await made();
    expect(files.map((one) => one.title)).toEqual(["IMG 4521 part 1", "IMG 4521 part 2"]);
    expect(files.map((one) => one.key)).toEqual([
      "Finished/Podcast clips/IMG 4521 part 1.mp4",
      "Finished/Podcast clips/IMG 4521 part 2.mp4",
    ]);
  });

  test("renaming it in the library renames the made files, their copies and the run", async () => {
    const { t, maya, team, runId, parent, made, toolkit } = await madeFromUpload();
    const result = await maya.as.mutation(api.library.rename, {
      itemId: parent._id,
      title: "Moon interview",
    });
    expect(result).toEqual({ followed: 2 });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000));
    const files = await made();
    expect(files.map((one) => one.title)).toEqual([
      "Moon interview part 1",
      "Moon interview part 2",
    ]);
    expect(files.map((one) => one.key)).toEqual([
      "Finished/Podcast clips/Moon interview part 1.mp4",
      "Finished/Podcast clips/Moon interview part 2.mp4",
    ]);
    const root = `teams/${team}/`;
    expect(toolkit.files.has(`${root}Finished/Podcast clips/Moon interview part 1.mp4`)).toBe(true);
    expect(toolkit.files.has(`${root}Finished/Podcast clips/IMG 4521 part 1.mp4`)).toBe(false);
    // The run's pages name its files after the new name too.
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect((run!.trigger as { file_name: string }).file_name).toBe("Moon interview.mp4");
    const view = await maya.as.query(api.library.get, { itemId: files[0]._id });
    expect(view?.parent).toMatchObject({ title: "Moon interview" });
  });

  test("a made file someone renamed keeps their name", async () => {
    const { maya, parent, made } = await madeFromUpload();
    const [first] = await made();
    await maya.as.mutation(api.library.rename, { itemId: first._id, title: "Best bit" });
    await maya.as.mutation(api.library.rename, { itemId: parent._id, title: "Moon interview" });
    expect((await made()).map((one) => one.title)).toEqual(["Best bit", "Moon interview part 2"]);
  });

  test("renaming the upload on the Files page carries over the same way", async () => {
    const { t, team, parent, made } = await madeFromUpload();
    await t.mutation(internal.files.followRecords, {
      organizationId: team,
      moves: [{ from: parent.key!, to: "uploads/x/moon-interview.mp4", etag: "e" }],
    });
    expect((await t.run((ctx) => ctx.db.get(parent._id)))?.title).toBe("moon-interview");
    expect((await made()).map((one) => one.title)).toEqual([
      "Moon interview part 1",
      "Moon interview part 2",
    ]);
  });
});

describe("a run started by hand from an upload", () => {
  test("carries the upload, so what it makes is named after it and made from it", async () => {
    const { t, maya, olu, upload, finishedRun } = await studio();
    const shot = await upload("IMG_4521.mp4");
    const { automationId } = await finishedRun(null, []);
    await t.run((ctx) =>
      ctx.db.patch(automationId, {
        nodes: [
          {
            id: "caps",
            kind: "step",
            stepId: "video-caption",
            input: {},
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      }),
    );
    const runId = await maya.as.mutation(api.automations.runNow, {
      automationId,
      fileUrl: `${LINK}/uploads/x/IMG_4521.mp4?sig=1`,
      uploadId: shot,
    });
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.trigger).toMatchObject({ file_name: "IMG_4521.mp4", upload_id: shot });

    // Another team's upload is not carried.
    const theirs = await t.run((ctx) =>
      ctx.db.insert("uploads", {
        organizationId: "someone-else",
        key: "uploads/y/theirs.mp4",
        fileName: "theirs.mp4",
        contentType: "video/mp4",
        size: 10,
        status: "ready",
        createdBy: olu.id,
      }),
    );
    const other = await maya.as.mutation(api.automations.runNow, {
      automationId,
      fileUrl: `${LINK}/uploads/y/theirs.mp4?sig=1`,
      uploadId: theirs,
    });
    const otherRun = await t.run((ctx) => ctx.db.get(other));
    expect(otherRun?.trigger).toEqual({ file_url: `${LINK}/uploads/y/theirs.mp4?sig=1` });
  });
});
