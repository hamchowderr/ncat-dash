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
