import { teamFolder, uploadRef } from "@ncat-dash/automation-core";
import { afterEach, describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit, fakeToolkitStorage } from "./test.toolkit";

// The review rooms a client reaches through their portal, the team's look in them, and
// downloading finished pieces (2026-11-22).

let toolkit: ReturnType<typeof fakeToolkitStorage> | null = null;
let current: ReturnType<typeof backend> | null = null;
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await current?.finishInProgressScheduledFunctions();
  current = null;
  toolkit?.restore();
  toolkit = null;
});

const GUEST = "riley-browser-0001";

async function agency() {
  process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
  toolkit = fakeToolkitStorage();
  const t = backend();
  current = t;
  const team = await addTeam(t, "Northlight Media");
  const owner = await addPerson(t, "Maya Ortiz", [team], "owner");
  await connectToolkit(t, team, owner.id);
  await owner.as.mutation(api.teamSettings.setBrand, {
    organizationId: team,
    brand: { color: "#112233" },
  });
  const acme = await owner.as.mutation(api.clients.create, { organizationId: team, name: "Acme" });
  const bright = await owner.as.mutation(api.clients.create, {
    organizationId: team,
    name: "Bright Co",
  });
  const episode = await owner.as.mutation(api.projects.create, {
    organizationId: team,
    name: "Episode 12",
    package: "youtube_video",
    shorts: 1,
    clientId: acme,
  });
  const theirs = await owner.as.mutation(api.projects.create, {
    organizationId: team,
    name: "Bright launch",
    package: "youtube_video",
    shorts: 1,
    clientId: bright,
  });
  const token = await owner.as.mutation(api.portal.set, {
    clientId: acme,
    allowVerdict: true,
    showTeamComments: false,
  });
  const inFolder = (name: string) =>
    `https://r2.example/test-bucket/${teamFolder(team)}Finished/${name}`;
  return { t, team, owner, acme, bright, episode, theirs, token, inFolder };
}

type Agency = Awaited<ReturnType<typeof agency>>;

async function slotsOf({ owner }: Agency, projectId: Id<"projects">) {
  return (await owner.as.query(api.projects.get, { projectId }))!.slots;
}

/** Puts a file in the project's first slot, which opens its review room. */
async function readyForReview(world: Agency, projectId: Id<"projects">, url: string) {
  const [slot] = await slotsOf(world, projectId);
  await world.owner.as.mutation(api.projects.addVersion, { deliverableId: slot._id, url });
  return slot._id;
}

describe("review rooms opened from a client's portal", () => {
  test("close when the portal is switched off", async () => {
    const world = await agency();
    const { t, owner, acme, episode, token } = world;
    await readyForReview(world, episode, world.inFolder("ep.mp4"));
    const share = await t.mutation(api.portal.openReview, { token, projectId: episode });
    expect(await t.query(api.sharedReview.room, { token: share })).not.toBeNull();

    await owner.as.mutation(api.portal.stop, { clientId: acme });
    expect(await t.query(api.sharedReview.room, { token: share })).toBeNull();
    await expect(
      t.mutation(api.sharedReview.verdict, {
        token: share,
        guestId: GUEST,
        name: "Riley",
        approved: true,
      }),
    ).rejects.toThrow(/no longer shared/);
    // Switched on again, the portal has a new link and opens a new room link.
    const again = await owner.as.mutation(api.portal.set, {
      clientId: acme,
      allowVerdict: true,
      showTeamComments: false,
    });
    const reopened = await t.mutation(api.portal.openReview, { token: again, projectId: episode });
    expect(reopened).not.toBe(share);
    expect(await t.query(api.sharedReview.room, { token: share })).toBeNull();
  });

  test("close when the client is deleted", async () => {
    const world = await agency();
    const { t, owner, acme, episode, token } = world;
    await readyForReview(world, episode, world.inFolder("ep.mp4"));
    const share = await t.mutation(api.portal.openReview, { token, projectId: episode });
    await owner.as.mutation(api.clients.remove, { clientId: acme });
    expect(await t.query(api.sharedReview.room, { token: share })).toBeNull();
  });

  test("follow the portal's settings as they are now", async () => {
    const world = await agency();
    const { t, owner, acme, episode, token } = world;
    await readyForReview(world, episode, world.inFolder("ep.mp4"));
    const share = await t.mutation(api.portal.openReview, { token, projectId: episode });
    expect((await t.query(api.sharedReview.room, { token: share }))!.allowVerdict).toBe(true);

    await owner.as.mutation(api.portal.set, {
      clientId: acme,
      allowVerdict: false,
      showTeamComments: false,
    });
    expect((await t.query(api.sharedReview.room, { token: share }))!.allowVerdict).toBe(false);
    await expect(
      t.mutation(api.sharedReview.verdict, {
        token: share,
        guestId: GUEST,
        name: "Riley",
        approved: true,
      }),
    ).rejects.toThrow();
  });

  test("never reuse the team's own share link, which keeps its settings and stays open", async () => {
    const world = await agency();
    const { t, owner, acme, episode, token } = world;
    await readyForReview(world, episode, world.inFolder("ep.mp4"));
    const reviewId = (await t.run((ctx) => ctx.db.get(episode)))!.reviewId!;
    const teams = await owner.as.mutation(api.reviewShares.set, {
      reviewId,
      allowVerdict: false,
      showTeamComments: true,
    });
    const share = await t.mutation(api.portal.openReview, { token, projectId: episode });
    expect(share).not.toBe(teams);
    expect((await t.query(api.sharedReview.room, { token: share }))!.allowVerdict).toBe(true);
    // The team's dialog still shows its own link, not the portal's.
    expect(await owner.as.query(api.reviewShares.forReview, { reviewId })).toMatchObject({
      token: teams,
      allowVerdict: false,
    });

    await owner.as.mutation(api.portal.stop, { clientId: acme });
    expect(await t.query(api.sharedReview.room, { token: teams })).not.toBeNull();
  });

  test("show the team's look, with its uploaded logo through the room's link", async () => {
    const world = await agency();
    const { t, team, owner, episode, token } = world;
    await readyForReview(world, episode, world.inFolder("ep.mp4"));
    const started = await owner.as.action(api.storage.startUpload, {
      organizationId: team,
      fileName: "Northlight.png",
      contentType: "image/png",
      size: 2000,
      purpose: "brand",
    });
    const logo = started.uploadId as Id<"uploads">;
    await t.run((ctx) => ctx.db.patch(logo, { status: "ready" }));
    await owner.as.mutation(api.teamSettings.setBrand, {
      organizationId: team,
      brand: { logo: uploadRef(logo), color: "#112233" },
    });
    const share = await t.mutation(api.portal.openReview, { token, projectId: episode });
    const room = (await t.query(api.sharedReview.room, { token: share }))!;
    expect(room.brand).toEqual({ logo: uploadRef(logo), color: "#112233" });
    const link = await t.action(api.sharedReview.logoLink, { token: share });
    const key = (await t.run((ctx) => ctx.db.get(logo)))!.key;
    expect(decodeURIComponent(new URL(link!).pathname)).toContain(key);
    expect(await t.action(api.sharedReview.logoLink, { token: "b".repeat(64) })).toBeNull();
  });
});

describe("downloading finished pieces from the portal", () => {
  test("an approved piece in the team's folder downloads under its own name", async () => {
    const world = await agency();
    const { t, owner, episode, token } = world;
    const slotId = await readyForReview(world, episode, world.inFolder("render-123.mp4"));
    // Waiting for review: not the client's to download yet.
    expect(
      await t.action(api.portal.downloadLink, { token, projectId: episode, slotId }),
    ).toBeNull();

    await owner.as.mutation(api.projects.setStatus, { deliverableId: slotId, status: "approved" });
    const link = await t.action(api.portal.downloadLink, { token, projectId: episode, slotId });
    const url = new URL(link!);
    expect(url.searchParams.get("download")).toBe("Full video.mp4");
    expect(decodeURIComponent(url.pathname)).toContain("Finished/render-123.mp4");
  });

  test("a piece kept somewhere else comes back as its own address", async () => {
    const world = await agency();
    const { t, owner, episode, token } = world;
    const elsewhere = "https://cdn.example/episode-12.mp4";
    const slotId = await readyForReview(world, episode, elsewhere);
    await owner.as.mutation(api.projects.setStatus, { deliverableId: slotId, status: "published" });
    expect(await t.action(api.portal.downloadLink, { token, projectId: episode, slotId })).toBe(
      elsewhere,
    );
  });

  test("never another client's piece, and nothing through a stopped portal", async () => {
    const world = await agency();
    const { t, owner, acme, episode, theirs, token } = world;
    const others = await readyForReview(world, theirs, world.inFolder("bright.mp4"));
    await owner.as.mutation(api.projects.setStatus, { deliverableId: others, status: "approved" });
    // Their slot, asked for through this client's project or their own.
    for (const projectId of [episode, theirs]) {
      expect(
        await t.action(api.portal.downloadLink, { token, projectId, slotId: others }),
      ).toBeNull();
    }
    const mine = await readyForReview(world, episode, world.inFolder("ep.mp4"));
    await owner.as.mutation(api.projects.setStatus, { deliverableId: mine, status: "approved" });
    await owner.as.mutation(api.portal.stop, { clientId: acme });
    expect(
      await t.action(api.portal.downloadLink, { token, projectId: episode, slotId: mine }),
    ).toBeNull();
  });
});
