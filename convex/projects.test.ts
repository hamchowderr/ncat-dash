import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { slotsFor } from "./lib/packages";
import { addPerson, addTeam, backend } from "./test.setup";

const VIDEO = "https://files.example/episode-12.mp4";
const VIDEO_2 = "https://files.example/episode-12-v2.mp4";
const PICTURE = "https://files.example/cover.png";

async function podcast(shorts = 2) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const dev = await addPerson(t, "Dev Patel", [team]);
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  const projectId = await dev.as.mutation(api.projects.create, {
    organizationId: team,
    name: "Episode 12",
    package: "video_podcast",
    shorts,
  });
  const project = (await dev.as.query(api.projects.get, { projectId }))!;
  const slot = (label: string) => project.slots.find((entry) => entry.label === label)!;
  return { t, team, maya, dev, outsider, projectId, project, slot };
}

describe("packages", () => {
  test("a video podcast lays out the episode, its thumbnail, audio and shorts with thumbnails", () => {
    expect(slotsFor("video_podcast", 2).map((slot) => slot.label)).toEqual([
      "Full episode",
      "Episode thumbnail",
      "Audio version",
      "Short 1",
      "Short 1 thumbnail",
      "Short 2",
      "Short 2 thumbnail",
    ]);
    expect(slotsFor("youtube_video").filter((slot) => slot.kind === "short")).toHaveLength(3);
    expect(slotsFor("shorts_batch", 1000)).toHaveLength(60);
    expect(slotsFor("blank")).toEqual([]);
    expect(slotsFor("nope")).toEqual([]);
  });
});

describe("a project", () => {
  test("starts with every slot empty, To do, and shows what is filled", async () => {
    const { project, team, dev } = await podcast();
    expect(project.package).toBe("Video podcast");
    expect(project.slots).toHaveLength(7);
    expect(project.slots.every((slot) => slot.status === "todo" && slot.url === null)).toBe(true);
    expect(project).toMatchObject({ total: 7, filled: 0 });
    const [listed] = await dev.as.query(api.projects.list, { organizationId: team });
    expect(listed).toMatchObject({ name: "Episode 12", total: 7, filled: 0, client: null });
  });

  test("is only for its team", async () => {
    const { outsider, projectId, team, slot } = await podcast();
    expect(await outsider.as.query(api.projects.get, { projectId })).toBeNull();
    await expect(outsider.as.query(api.projects.list, { organizationId: team })).rejects.toThrow();
    await expect(
      outsider.as.mutation(api.projects.addVersion, {
        deliverableId: slot("Full episode")._id,
        url: VIDEO,
      }),
    ).rejects.toThrow();
  });

  test("needs a name and a known package", async () => {
    const { team, dev } = await podcast();
    await expect(
      dev.as.mutation(api.projects.create, { organizationId: team, name: " ", package: "blank" }),
    ).rejects.toThrow(/name/);
    await expect(
      dev.as.mutation(api.projects.create, { organizationId: team, name: "X", package: "nope" }),
    ).rejects.toThrow(/package/);
  });

  test("can be for a client, and a client's list shows only its projects", async () => {
    const { team, dev } = await podcast();
    const acme = await dev.as.mutation(api.clients.create, { organizationId: team, name: "Acme" });
    await dev.as.mutation(api.projects.create, {
      organizationId: team,
      name: "Acme launch",
      package: "youtube_video",
      clientId: acme,
    });
    const forAcme = await dev.as.query(api.projects.list, { organizationId: team, clientId: acme });
    expect(forAcme.map((project) => project.name)).toEqual(["Acme launch"]);
    expect(forAcme[0].client?.name).toBe("Acme");
    expect(await dev.as.query(api.projects.list, { organizationId: team })).toHaveLength(2);
  });
});

describe("putting a file in a slot", () => {
  test("sets it to review, opens the project's review room with it, and pings the team", async () => {
    const { t, dev, maya, projectId, slot } = await podcast();
    await dev.as.mutation(api.projects.addVersion, {
      deliverableId: slot("Full episode")._id,
      url: VIDEO,
    });
    const project = (await dev.as.query(api.projects.get, { projectId }))!;
    const episode = project.slots.find((entry) => entry.label === "Full episode")!;
    expect(episode).toMatchObject({ status: "review", url: VIDEO, versions: 1 });
    expect(project.filled).toBe(1);
    expect(project.review?.status).toBe("open");

    const room = (await dev.as.query(api.reviews.get, { reviewId: project.review!._id }))!;
    expect(room.title).toBe("Episode 12");
    expect(room.clips.map((clip) => clip.title)).toEqual(["Full episode"]);
    expect(room.clips[0]._id).toBe(episode.clipId);

    const alerts = await t.run((ctx) => ctx.db.query("alerts").collect());
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: "ready_for_review",
      automationName: "Episode 12",
      stepName: "Full episode",
      from: "Dev Patel",
      recipients: [maya.id],
      reviewId: room._id,
      clipId: episode.clipId,
    });
  });

  test("a second version goes in as the next version of the same clip", async () => {
    const { dev, projectId, slot } = await podcast();
    const deliverableId = slot("Full episode")._id;
    await dev.as.mutation(api.projects.addVersion, { deliverableId, url: VIDEO });
    await dev.as.mutation(api.projects.addVersion, { deliverableId, url: VIDEO_2 });
    const project = (await dev.as.query(api.projects.get, { projectId }))!;
    const room = (await dev.as.query(api.reviews.get, { reviewId: project.review!._id }))!;
    expect(room.clips).toHaveLength(1);
    expect(room.clips[0].versions.map((version) => version.url)).toEqual([VIDEO, VIDEO_2]);
    expect(await dev.as.query(api.projects.versions, { deliverableId })).toHaveLength(2);
  });

  test("only takes the kind of file the slot is for", async () => {
    const { dev, slot } = await podcast();
    await expect(
      dev.as.mutation(api.projects.addVersion, {
        deliverableId: slot("Episode thumbnail")._id,
        url: VIDEO,
      }),
    ).rejects.toThrow(/picture/);
    await expect(
      dev.as.mutation(api.projects.addVersion, {
        deliverableId: slot("Full episode")._id,
        url: PICTURE,
      }),
    ).rejects.toThrow(/video/);
    await expect(
      dev.as.mutation(api.projects.addVersion, {
        deliverableId: slot("Full episode")._id,
        url: "not a link",
      }),
    ).rejects.toThrow();
  });

  test("approving the room approves the slots in review; asking for changes sends them back", async () => {
    const { dev, projectId, slot } = await podcast();
    await dev.as.mutation(api.projects.addVersion, {
      deliverableId: slot("Full episode")._id,
      url: VIDEO,
    });
    const reviewId = (await dev.as.query(api.projects.get, { projectId }))!.review!._id;
    await dev.as.mutation(api.reviews.decide, { reviewId, approved: false });
    let project = (await dev.as.query(api.projects.get, { projectId }))!;
    expect(project.slots.find((entry) => entry.label === "Full episode")?.status).toBe(
      "in_progress",
    );

    // A new version opens the decided room again for the next round.
    await dev.as.mutation(api.projects.addVersion, {
      deliverableId: slot("Full episode")._id,
      url: VIDEO_2,
    });
    expect((await dev.as.query(api.reviews.get, { reviewId }))?.status).toBe("open");
    await dev.as.mutation(api.reviews.decide, { reviewId, approved: true });
    project = (await dev.as.query(api.projects.get, { projectId }))!;
    expect(project.slots.find((entry) => entry.label === "Full episode")?.status).toBe("approved");
    // Slots that were never in review stay where they were.
    expect(project.slots.find((entry) => entry.label === "Short 1")?.status).toBe("todo");
  });

  test("a version added in the review room goes into the slot too", async () => {
    const { dev, projectId, slot } = await podcast();
    await dev.as.mutation(api.projects.addVersion, {
      deliverableId: slot("Short 1")._id,
      url: VIDEO,
    });
    const clipId = (await dev.as.query(api.projects.get, { projectId }))!.slots.find(
      (entry) => entry.label === "Short 1",
    )!.clipId!;
    await dev.as.mutation(api.reviews.addVersion, { clipId, url: VIDEO_2 });
    const short = (await dev.as.query(api.projects.get, { projectId }))!.slots.find(
      (entry) => entry.label === "Short 1",
    )!;
    expect(short).toMatchObject({ url: VIDEO_2, versions: 2, status: "review" });
  });

  test("deleting the room lets go of it; the next version opens a new one", async () => {
    const { dev, maya, projectId, slot } = await podcast();
    await dev.as.mutation(api.projects.addVersion, {
      deliverableId: slot("Short 1")._id,
      url: VIDEO,
    });
    const reviewId = (await dev.as.query(api.projects.get, { projectId }))!.review!._id;
    await maya.as.mutation(api.reviews.remove, { reviewId });
    expect((await dev.as.query(api.projects.get, { projectId }))!.review).toBeNull();
    await dev.as.mutation(api.projects.addVersion, {
      deliverableId: slot("Short 1")._id,
      url: VIDEO_2,
    });
    const project = (await dev.as.query(api.projects.get, { projectId }))!;
    const room = (await dev.as.query(api.reviews.get, { reviewId: project.review!._id }))!;
    // The new room's clip keeps every version the slot had.
    expect(room.clips[0].versions.map((version) => version.url)).toEqual([VIDEO, VIDEO_2]);
  });
});

describe("the board and slots", () => {
  test("a slot moves between columns, but not past In progress while it is empty", async () => {
    const { dev, slot } = await podcast();
    const deliverableId = slot("Short 1")._id;
    await dev.as.mutation(api.projects.setStatus, { deliverableId, status: "in_progress" });
    await expect(
      dev.as.mutation(api.projects.setStatus, { deliverableId, status: "approved" }),
    ).rejects.toThrow(/file/);
    await dev.as.mutation(api.projects.addVersion, { deliverableId, url: VIDEO });
    await dev.as.mutation(api.projects.setStatus, { deliverableId, status: "published" });
  });

  test("slots can be added, renamed and removed; renaming renames the clip in review", async () => {
    const { dev, projectId, slot } = await podcast(1);
    const added = await dev.as.mutation(api.projects.addSlot, { projectId, kind: "short" });
    let project = (await dev.as.query(api.projects.get, { projectId }))!;
    expect(project.slots.at(-1)).toMatchObject({ _id: added, label: "Short 2", status: "todo" });

    await dev.as.mutation(api.projects.addVersion, {
      deliverableId: slot("Short 1")._id,
      url: VIDEO,
    });
    await dev.as.mutation(api.projects.renameSlot, {
      deliverableId: slot("Short 1")._id,
      label: "Cold open",
    });
    project = (await dev.as.query(api.projects.get, { projectId }))!;
    const room = (await dev.as.query(api.reviews.get, { reviewId: project.review!._id }))!;
    expect(room.clips[0].title).toBe("Cold open");

    await dev.as.mutation(api.projects.removeSlot, { deliverableId: added });
    project = (await dev.as.query(api.projects.get, { projectId }))!;
    expect(project.slots.map((entry) => entry.label)).not.toContain("Short 2");
  });

  test("renaming a project renames its review room; only owners and admins delete it", async () => {
    const { dev, maya, projectId, slot, team } = await podcast();
    await dev.as.mutation(api.projects.addVersion, {
      deliverableId: slot("Full episode")._id,
      url: VIDEO,
    });
    await dev.as.mutation(api.projects.rename, { projectId, name: "Episode 12: Space" });
    const reviewId = (await dev.as.query(api.projects.get, { projectId }))!.review!._id;
    expect((await dev.as.query(api.reviews.get, { reviewId }))?.title).toBe("Episode 12: Space");

    await expect(dev.as.mutation(api.projects.remove, { projectId })).rejects.toThrow(
      /owner or admin/,
    );
    await maya.as.mutation(api.projects.remove, { projectId });
    expect(await maya.as.query(api.projects.list, { organizationId: team })).toEqual([]);
    // The review room stays, with its clips.
    expect(await maya.as.query(api.reviews.get, { reviewId })).not.toBeNull();
  });
});

const SHORT_A = "https://files.example/clip-1.mp4";
const SHORT_B = "https://files.example/clip-2.mp4";

/** A switched-on automation with one step, waiting for a slot to move. */
async function waitingFor(
  t: Awaited<ReturnType<typeof podcast>>["t"],
  team: string,
  by: string,
  trigger: { kind: "slot"; status: "review" | "approved"; slotKind: "any" | "video" | "short" },
) {
  return await t.run((ctx) =>
    ctx.db.insert("automations", {
      organizationId: team,
      name: "Make the shorts",
      enabled: true,
      trigger,
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
      hookToken: "token",
      nextRunAt: null,
      createdBy: by,
      updatedAt: Date.now(),
    }),
  );
}

/** Ends a run's only step with these files, the way a finished job would. */
async function finish(t: Awaited<ReturnType<typeof podcast>>["t"], runId: string, files: string[]) {
  const { advance } = await import("./lib/runner");
  await t.run(async (ctx) => {
    const id = ctx.db.normalizeId("runs", runId)!;
    // No toolkit here, so the step is ended by hand as if its job had worked.
    await ctx.db.patch(id, { status: "running", error: null, finishedAt: null });
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_run", (q) => q.eq("runId", id))
      .collect();
    for (const step of steps) {
      await ctx.db.patch(step._id, {
        status: "done",
        outputs: files,
        startedAt: 0,
        finishedAt: Date.now(),
      });
    }
    await advance(ctx, id);
  });
}

describe("automations and projects", () => {
  test("a slot moving to a status starts the automations waiting for it, for the project's client", async () => {
    const { t, team, maya, dev, projectId, slot } = await podcast();
    const acme = await dev.as.mutation(api.clients.create, { organizationId: team, name: "Acme" });
    await dev.as.mutation(api.projects.setClient, { projectId, clientId: acme });
    await waitingFor(t, team, maya.id, { kind: "slot", status: "approved", slotKind: "video" });
    const onShorts = await waitingFor(t, team, maya.id, {
      kind: "slot",
      status: "approved",
      slotKind: "short",
    });
    const episode = slot("Full episode")._id;
    await dev.as.mutation(api.projects.addVersion, { deliverableId: episode, url: VIDEO });
    // In review is not what they wait for.
    expect(await t.run((ctx) => ctx.db.query("runs").collect())).toHaveLength(0);

    await dev.as.mutation(api.projects.setStatus, { deliverableId: episode, status: "approved" });
    const runs = await t.run((ctx) => ctx.db.query("runs").collect());
    expect(runs).toHaveLength(1);
    expect(runs[0].automationId).not.toBe(onShorts);
    expect(runs[0]).toMatchObject({
      triggerKind: "slot",
      projectId,
      deliverableId: episode,
      clientId: acme,
      trigger: { file_url: VIDEO, project: "Episode 12", slot: "Full episode", status: "approved" },
    });
  });

  test("approving the review room starts them too; a switched-off one never starts", async () => {
    const { t, team, maya, dev, projectId, slot } = await podcast();
    const automationId = await waitingFor(t, team, maya.id, {
      kind: "slot",
      status: "approved",
      slotKind: "any",
    });
    await dev.as.mutation(api.projects.addVersion, {
      deliverableId: slot("Full episode")._id,
      url: VIDEO,
    });
    const project = (await dev.as.query(api.projects.get, { projectId }))!;
    await t.run((ctx) => ctx.db.patch(automationId, { enabled: false }));
    await maya.as.mutation(api.reviews.decide, { reviewId: project.review!._id, approved: true });
    expect(await t.run((ctx) => ctx.db.query("runs").collect())).toHaveLength(0);
    // A new version opens the room again for the next round.
    await dev.as.mutation(api.projects.addVersion, {
      deliverableId: slot("Full episode")._id,
      url: VIDEO_2,
    });
    await t.run((ctx) => ctx.db.patch(automationId, { enabled: true }));
    await maya.as.mutation(api.reviews.decide, { reviewId: project.review!._id, approved: true });
    expect(await t.run((ctx) => ctx.db.query("runs").collect())).toHaveLength(1);
  });

  test("a project run's videos fill the empty shorts, and its picture the thumbnail", async () => {
    const { t, team, maya, dev, projectId, slot } = await podcast();
    await waitingFor(t, team, maya.id, { kind: "slot", status: "approved", slotKind: "video" });
    const episode = slot("Full episode")._id;
    await dev.as.mutation(api.projects.addVersion, { deliverableId: episode, url: VIDEO });
    await dev.as.mutation(api.projects.setStatus, { deliverableId: episode, status: "approved" });
    const [run] = await t.run((ctx) => ctx.db.query("runs").collect());
    await finish(t, run._id, [SHORT_A, SHORT_B, PICTURE]);

    const project = (await dev.as.query(api.projects.get, { projectId }))!;
    const shown = Object.fromEntries(project.slots.map((entry) => [entry.label, entry]));
    expect(shown["Short 1"]).toMatchObject({ url: SHORT_A, status: "review" });
    expect(shown["Short 2"]).toMatchObject({ url: SHORT_B, status: "review" });
    expect(shown["Episode thumbnail"]).toMatchObject({ url: PICTURE, status: "review" });
    // The episode itself stays as it was, and nothing waiting for In review started.
    expect(shown["Full episode"]).toMatchObject({ url: VIDEO, status: "approved", versions: 1 });
    expect(await t.run((ctx) => ctx.db.query("runs").collect())).toHaveLength(1);
    // The team hears about each, from the automation.
    const alerts = await t.run((ctx) =>
      ctx.db
        .query("alerts")
        .filter((q) => q.eq(q.field("from"), "Make the shorts"))
        .collect(),
    );
    expect(alerts.map((alert) => alert.stepName).sort()).toEqual([
      "Episode thumbnail",
      "Short 1",
      "Short 2",
    ]);
  });

  test("one file that fits the slot a run started from becomes its next version", async () => {
    const { t, dev, projectId, slot } = await podcast();
    const automationId = await waitingFor(t, "unused", "nobody", {
      kind: "slot",
      status: "approved",
      slotKind: "any",
    });
    const team = (await dev.as.query(api.projects.get, { projectId }))!.organizationId;
    await t.run((ctx) => ctx.db.patch(automationId, { organizationId: team, enabled: false }));
    const episode = slot("Full episode")._id;
    await dev.as.mutation(api.projects.addVersion, { deliverableId: episode, url: VIDEO });
    const runId = await dev.as.mutation(api.projects.runOnSlot, {
      deliverableId: episode,
      automationId,
    });
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({ projectId, deliverableId: episode, trigger: { file_url: VIDEO } });
    await finish(t, runId, [VIDEO_2]);
    const project = (await dev.as.query(api.projects.get, { projectId }))!;
    const shown = project.slots.find((entry) => entry._id === episode)!;
    expect(shown).toMatchObject({ url: VIDEO_2, versions: 2, status: "review" });
  });

  test("running on a slot needs a file in it, and the team's own automation", async () => {
    const { t, dev, outsider, slot } = await podcast();
    const theirs = await waitingFor(t, "other-team", outsider.id, {
      kind: "slot",
      status: "approved",
      slotKind: "any",
    });
    const episode = slot("Full episode")._id;
    await expect(
      dev.as.mutation(api.projects.runOnSlot, { deliverableId: episode, automationId: theirs }),
    ).rejects.toThrow(/gone/);
    await dev.as.mutation(api.projects.addVersion, { deliverableId: episode, url: VIDEO });
    await expect(
      dev.as.mutation(api.projects.runOnSlot, { deliverableId: episode, automationId: theirs }),
    ).rejects.toThrow(/gone/);
  });
});
