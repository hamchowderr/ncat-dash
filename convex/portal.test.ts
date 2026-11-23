import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

const VIDEO = "https://files.example/episode-12.mp4";

async function agency() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Maya Ortiz", [team], "owner");
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
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
  const other = await owner.as.mutation(api.projects.create, {
    organizationId: team,
    name: "Bright launch",
    package: "blank",
    clientId: bright,
  });
  await owner.as.mutation(api.projects.create, {
    organizationId: team,
    name: "Our own reel",
    package: "blank",
  });
  return { t, team, owner, outsider, acme, bright, episode, other };
}

describe("a client's portal", () => {
  test("is switched on by the team, and only the team sees its link", async () => {
    const { owner, outsider, acme } = await agency();
    expect(await owner.as.query(api.portal.forClient, { clientId: acme })).toBeNull();
    const token = await owner.as.mutation(api.portal.set, {
      clientId: acme,
      allowVerdict: true,
      showTeamComments: false,
    });
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(await owner.as.query(api.portal.forClient, { clientId: acme })).toEqual({
      token,
      allowVerdict: true,
      showTeamComments: false,
    });
    expect(await outsider.as.query(api.portal.forClient, { clientId: acme })).toBeNull();
    await expect(
      outsider.as.mutation(api.portal.set, {
        clientId: acme,
        allowVerdict: true,
        showTeamComments: true,
      }),
    ).rejects.toThrow();
    // Changing the settings keeps the same link.
    expect(
      await owner.as.mutation(api.portal.set, {
        clientId: acme,
        allowVerdict: false,
        showTeamComments: false,
      }),
    ).toBe(token);
  });

  test("shows the client only their own projects, in the team's name and colour", async () => {
    const { t, owner, acme, episode } = await agency();
    const token = await owner.as.mutation(api.portal.set, {
      clientId: acme,
      allowVerdict: true,
      showTeamComments: false,
    });
    const view = (await t.query(api.portal.view, { token }))!;
    expect(view.agency).toMatchObject({ name: "Salt House", color: "#112233" });
    expect(view.client).toEqual({ name: "Acme" });
    expect(view.projects.map((project) => project.name)).toEqual(["Episode 12"]);
    expect(view.projects[0]).toMatchObject({ package: "YouTube video", total: 3, ready: 0 });

    const project = (await t.query(api.portal.project, { token, projectId: episode }))!;
    expect(project.slots.map((slot) => slot.label)).toEqual(["Full video", "Thumbnail", "Short 1"]);
    expect(project.hasReview).toBe(false);
  });

  test("never shows another client's project, and a wrong or stopped link shows nothing", async () => {
    const { t, owner, acme, other } = await agency();
    const token = await owner.as.mutation(api.portal.set, {
      clientId: acme,
      allowVerdict: true,
      showTeamComments: false,
    });
    expect(await t.query(api.portal.project, { token, projectId: other })).toBeNull();
    expect(await t.query(api.portal.project, { token, projectId: "nope" })).toBeNull();
    expect(await t.query(api.portal.view, { token: "a".repeat(64) })).toBeNull();
    expect(await t.query(api.portal.view, { token: "short" })).toBeNull();
    await owner.as.mutation(api.portal.stop, { clientId: acme });
    expect(await t.query(api.portal.view, { token })).toBeNull();
    await expect(t.mutation(api.portal.openReview, { token, projectId: other })).rejects.toThrow(
      /no longer shared/,
    );
  });

  test("opens a project's review room with the portal's settings", async () => {
    const { t, owner, acme, episode } = await agency();
    const token = await owner.as.mutation(api.portal.set, {
      clientId: acme,
      allowVerdict: false,
      showTeamComments: true,
    });
    await expect(t.mutation(api.portal.openReview, { token, projectId: episode })).rejects.toThrow(
      /Nothing is ready/,
    );
    const project = (await owner.as.query(api.projects.get, { projectId: episode }))!;
    await owner.as.mutation(api.projects.addVersion, {
      deliverableId: project.slots[0]._id,
      url: VIDEO,
    });
    const view = (await t.query(api.portal.view, { token }))!;
    expect(view.projects[0]).toMatchObject({ ready: 1, cover: VIDEO });

    const shareToken = await t.mutation(api.portal.openReview, { token, projectId: episode });
    const room = (await t.query(api.sharedReview.room, { token: shareToken }))!;
    expect(room.title).toBe("Episode 12");
    expect(room.allowVerdict).toBe(false);
    const share = await t.run((ctx) => ctx.db.query("reviewShares").first());
    expect(share).toMatchObject({ allowVerdict: false, showTeamComments: true });
    // Opening it again uses the same link.
    expect(await t.mutation(api.portal.openReview, { token, projectId: episode })).toBe(shareToken);
  });

  test("a portal's review rooms never run out and stay open once approved", async () => {
    const { t, owner, acme, episode } = await agency();
    const token = await owner.as.mutation(api.portal.set, {
      clientId: acme,
      allowVerdict: true,
      showTeamComments: false,
    });
    const project = (await owner.as.query(api.projects.get, { projectId: episode }))!;
    await owner.as.mutation(api.projects.addVersion, {
      deliverableId: project.slots[0]._id,
      url: VIDEO,
    });
    const shareToken = await t.mutation(api.portal.openReview, { token, projectId: episode });
    const share = (await t.run((ctx) => ctx.db.query("reviewShares").first()))!;
    expect(share.expiresAt).toBeUndefined();
    await owner.as.mutation(api.reviews.decide, { reviewId: share.reviewId, approved: true });
    expect(await t.query(api.sharedReview.room, { token: shareToken })).not.toBeNull();
    expect(await t.query(api.sharedReview.ended, { token: shareToken })).toBeNull();
  });

  test("a new link turns the old one off straight away, with the rooms it opened", async () => {
    const { t, owner, outsider, acme, episode } = await agency();
    const old = await owner.as.mutation(api.portal.set, {
      clientId: acme,
      allowVerdict: true,
      showTeamComments: false,
    });
    const project = (await owner.as.query(api.projects.get, { projectId: episode }))!;
    await owner.as.mutation(api.projects.addVersion, {
      deliverableId: project.slots[0]._id,
      url: VIDEO,
    });
    const oldRoom = await t.mutation(api.portal.openReview, { token: old, projectId: episode });
    await expect(outsider.as.mutation(api.portal.newLink, { clientId: acme })).rejects.toThrow();

    const fresh = await owner.as.mutation(api.portal.newLink, { clientId: acme });
    expect(fresh).toMatch(/^[a-f0-9]{64}$/);
    expect(fresh).not.toBe(old);
    expect(await t.query(api.portal.view, { token: old })).toBeNull();
    expect(await t.query(api.sharedReview.room, { token: oldRoom })).toBeNull();
    expect((await t.query(api.portal.view, { token: fresh }))!.projects).toHaveLength(1);
    // The settings stay as they were.
    expect(await owner.as.query(api.portal.forClient, { clientId: acme })).toEqual({
      token: fresh,
      allowVerdict: true,
      showTeamComments: false,
    });
    const newRoom = await t.mutation(api.portal.openReview, { token: fresh, projectId: episode });
    expect(newRoom).not.toBe(oldRoom);
    expect(await t.query(api.sharedReview.room, { token: newRoom })).not.toBeNull();
  });

  test("a new link needs a portal that is on", async () => {
    const { owner, acme } = await agency();
    await expect(owner.as.mutation(api.portal.newLink, { clientId: acme })).rejects.toThrow(
      /no portal/,
    );
  });

  test("deleting the client stops its portal", async () => {
    const { t, owner, acme } = await agency();
    const token = await owner.as.mutation(api.portal.set, {
      clientId: acme,
      allowVerdict: true,
      showTeamComments: false,
    });
    await owner.as.mutation(api.clients.remove, { clientId: acme });
    expect(await t.query(api.portal.view, { token })).toBeNull();
  });
});
