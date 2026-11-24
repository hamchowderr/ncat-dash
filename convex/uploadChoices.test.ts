import { afterEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit, fakeToolkitStorage } from "./test.toolkit";

/**
 * What runs on an upload: automations set to run by themselves run, those set to ask first
 * only show on the file, one press away, and one unticked for an upload sits it out. The
 * file's page lists every automation that ran on it.
 */
let toolkit: ReturnType<typeof fakeToolkitStorage> | null = null;
afterEach(() => {
  toolkit?.restore();
  vi.useRealTimers();
});

async function studio() {
  toolkit = fakeToolkitStorage();
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const stranger = await addPerson(t, "Ana Cruz");
  await connectToolkit(t, team, maya.id);

  const upload = async (fileName: string, skipAutomations?: Id<"automations">[]) => {
    const { uploadId } = await maya.as.action(api.storage.startUpload, {
      organizationId: team,
      fileName,
      contentType: "video/mp4",
      size: 5000,
      ...(skipAutomations ? { skipAutomations } : {}),
    });
    await maya.as.mutation(api.storage.finishUpload, { uploadId });
    return uploadId;
  };
  const itemOf = async (uploadId: Id<"uploads">) =>
    (await t.run((ctx) =>
      ctx.db
        .query("libraryItems")
        .withIndex("by_upload", (q) => q.eq("uploadId", uploadId))
        .first(),
    ))!;
  /** A switched-on automation started by video uploads, asking first or not. */
  const automation = (name: string, ask: boolean) =>
    t.run((ctx) =>
      ctx.db.insert("automations", {
        organizationId: team,
        name,
        enabled: true,
        trigger: { kind: "upload", fileType: "video", ...(ask ? { ask: true } : {}) },
        nodes: [],
        edges: [],
        hookToken: `token-${name}`,
        nextRunAt: null,
        createdBy: maya.id,
        updatedAt: Date.now(),
      }),
    );
  return { t, team, maya, stranger, upload, itemOf, automation };
}

describe("what starts on an upload", () => {
  test("runs those set to run by themselves, never one set to ask first or unticked", async () => {
    const { t, upload, automation } = await studio();
    const clips = await automation("Podcast clips", false);
    const captions = await automation("Captions", false);
    await automation("Sermon pack", true);
    const uploadId = await upload("episode.mp4", [captions]);
    const found = await t.query(internal.automations.loadUploadForTrigger, { uploadId });
    expect(found?.starts.map((start) => start.automationId)).toEqual([clips]);
    // Nothing set to run by itself is left: nothing starts at all.
    const second = await upload("second.mp4", [clips, captions]);
    expect(await t.query(internal.automations.loadUploadForTrigger, { uploadId: second })).toBe(
      null,
    );
  });

  test("On this upload lists only the ones that run by themselves, for members", async () => {
    const { team, maya, stranger, automation } = await studio();
    await automation("Podcast clips", false);
    await automation("Sermon pack", true);
    expect(await maya.as.query(api.automations.runOnUpload, { organizationId: team })).toEqual([
      expect.objectContaining({ name: "Podcast clips", fileTypes: ["video"] }),
    ]);
    await expect(
      stranger.as.query(api.automations.runOnUpload, { organizationId: team }),
    ).rejects.toThrow();
  });

  test("ready-mades picked while setting up ask first", async () => {
    const { t, team, maya } = await studio();
    const [made] = await maya.as.mutation(api.contentGoals.turnOn, {
      organizationId: team,
      starterIds: ["coaching-session-pack"],
    });
    const saved = await t.run((ctx) => ctx.db.get(made.automationId!));
    expect(saved?.enabled).toBe(true);
    expect(saved?.trigger).toEqual({ kind: "upload", fileType: "video", ask: true });
  });
});

describe("automations on a file", () => {
  test("lists runs on the upload with how they started and what they made, then suggestions", async () => {
    const { t, team, maya, stranger, upload, itemOf } = await studio();
    // A real ready-made, asking first, so it can run.
    const [made] = await maya.as.mutation(api.contentGoals.turnOn, {
      organizationId: team,
      starterIds: ["coaching-session-pack", "recording-pack"],
    });
    const uploadId = await upload("session.mp4");
    const item = await itemOf(uploadId);
    const before = await maya.as.query(api.library.runsOnFile, { itemId: item._id });
    expect(before?.runs).toEqual([]);
    expect(before?.suggested.map((each) => each.name)).toEqual([
      "Coaching session pack",
      "Sermon, webinar or lecture pack",
    ]);

    // Pressing Run starts it on this file, recorded against the upload.
    const runId = await maya.as.mutation(internal.library.startRunOn, {
      itemId: item._id,
      automationId: made.automationId!,
      fileUrl: "https://r2.example/session.mp4",
    });
    expect((await t.run((ctx) => ctx.db.get(runId)))?.uploadId).toBe(uploadId);
    await t.run(async (ctx) => {
      await ctx.db.insert("libraryItems", {
        organizationId: team,
        shortId: "C9",
        title: "Session clip 1",
        kind: "video",
        source: "automation",
        parentId: item._id,
        runId,
        tags: [],
        searchText: "",
        createdBy: null,
      } as never);
    });
    const after = await maya.as.query(api.library.runsOnFile, { itemId: item._id });
    expect(after?.runs).toEqual([
      expect.objectContaining({
        _id: runId,
        automationName: "Coaching session pack",
        byHand: true,
        followed: false,
        made: 1,
      }),
    ]);
    // It ran, so it is no longer suggested.
    expect(after?.suggested.map((each) => each.name)).toEqual(["Sermon, webinar or lecture pack"]);
    expect(
      (await maya.as.query(api.library.runsOnUpload, { uploadId }))?.runs.map((run) => run._id),
    ).toEqual([runId]);

    // A run another one started counts as run on the file too.
    const child = await t.run(async (ctx) => {
      const { startRun } = await import("./lib/runner");
      const automation = (await ctx.db.get(made.automationId!))!;
      const started = await startRun(ctx, automation, "finished", {}, null, {
        parent: { runId, chain: [automation._id] },
      });
      return started.ok ? started.runId : null;
    });
    expect((await t.run((ctx) => ctx.db.get(child!)))?.uploadId).toBe(uploadId);

    await expect(stranger.as.query(api.library.runsOnFile, { itemId: item._id })).rejects.toThrow();
  });

  test("shows nothing for a file an automation made", async () => {
    const { t, team, maya, upload, itemOf, automation } = await studio();
    const uploadId = await upload("episode.mp4");
    const item = await itemOf(uploadId);
    expect(await maya.as.query(api.library.runsOnFile, { itemId: item._id })).not.toBe(null);
    const automationId = await automation("Podcast clips", false);
    const runId = await t.run((ctx) =>
      ctx.db.insert("runs", {
        organizationId: team,
        automationId,
        automationName: "Podcast clips",
        status: "done",
        triggerKind: "manual",
        trigger: {},
        nodes: [],
        edges: [],
        error: null,
        startedBy: null,
        finishedAt: 1,
      }),
    );
    await t.run((ctx) => ctx.db.patch(item._id, { runId }));
    expect(await maya.as.query(api.library.runsOnFile, { itemId: item._id })).toBe(null);
  });
});
