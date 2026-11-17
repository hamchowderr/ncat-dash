import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";

const CLIP = "https://files.example/opening_hello.mp4";
const RILEY = "riley-browser-0001";
const OTHER = "someone-else-00002";

async function shared(settings = { allowVerdict: true, showTeamComments: false }) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const outsider = await addPerson(t, "Olly Out", [await addTeam(t, "Elsewhere")]);
  const reviewId = await maya.as.mutation(api.reviews.create, {
    organizationId: team,
    title: "Weekly clips",
    urls: [CLIP],
  });
  const review = await maya.as.query(api.reviews.get, { reviewId });
  const clipId = review!.clips[0]._id;
  const token = await maya.as.mutation(api.reviewShares.set, { reviewId, ...settings });
  const client = (guestId = RILEY, name = "Riley Client") => ({
    say: (body: string, parentId?: Id<"reviewComments">) =>
      t.mutation(api.sharedReview.comment, {
        token,
        guestId,
        name,
        clipId,
        body,
        time: 3,
        version: 1,
        parentId,
      }),
    sees: () => t.query(api.sharedReview.comments, { token, clipId, guestId }),
  });
  const alerts = () => t.run((ctx) => ctx.db.query("alerts").collect());
  return { t, team, maya, outsider, reviewId, clipId, token, client, alerts };
}

describe("a review's share link", () => {
  test("is made by a teammate, and only a teammate sees or changes it", async () => {
    const { maya, outsider, reviewId, token } = await shared();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(await maya.as.query(api.reviewShares.forReview, { reviewId })).toEqual({
      token,
      allowVerdict: true,
      showTeamComments: false,
    });
    expect(await outsider.as.query(api.reviewShares.forReview, { reviewId })).toBeNull();
    await expect(
      outsider.as.mutation(api.reviewShares.set, {
        reviewId,
        allowVerdict: false,
        showTeamComments: true,
      }),
    ).rejects.toThrow();
    await expect(outsider.as.mutation(api.reviewShares.stop, { reviewId })).rejects.toThrow();
  });

  test("keeps its address when its settings change, and a new one after it is switched off", async () => {
    const { t, maya, reviewId, token } = await shared();
    const same = await maya.as.mutation(api.reviewShares.set, {
      reviewId,
      allowVerdict: false,
      showTeamComments: true,
    });
    expect(same).toBe(token);
    await maya.as.mutation(api.reviewShares.stop, { reviewId });
    expect(await maya.as.query(api.reviewShares.forReview, { reviewId })).toBeNull();
    expect(await t.query(api.sharedReview.room, { token })).toBeNull();
    const fresh = await maya.as.mutation(api.reviewShares.set, {
      reviewId,
      allowVerdict: true,
      showTeamComments: false,
    });
    expect(fresh).not.toBe(token);
    expect(await t.query(api.sharedReview.room, { token })).toBeNull();
  });

  test("shows the client the review without an account, and nothing for a wrong secret", async () => {
    const { t, token } = await shared();
    const room = await t.query(api.sharedReview.room, { token });
    expect(room).toMatchObject({
      title: "Weekly clips",
      teamName: "Salt House",
      status: "open",
      allowVerdict: true,
      verdict: null,
    });
    expect(room!.clips[0].versions[0].url).toBe(CLIP);
    expect(await t.query(api.sharedReview.room, { token: "a".repeat(64) })).toBeNull();
    expect(await t.query(api.sharedReview.room, { token: "not-a-token" })).toBeNull();
  });

  test("lets the client comment; the team sees it marked as the client's and hears about it", async () => {
    const { team, maya, reviewId, clipId, client, alerts } = await shared();
    const id = await client().say("  Can the logo be bigger?  ");
    const seen = await maya.as.query(api.reviews.comments, { clipId });
    expect(seen).toEqual([
      expect.objectContaining({
        id,
        body: "Can the logo be bigger?",
        authorName: "Riley Client",
        authorId: `guest:${RILEY}`,
        client: true,
        mine: false,
        time: 3,
      }),
    ]);
    const [alert] = await alerts();
    expect(alert).toMatchObject({
      kind: "client_feedback",
      from: "Riley Client",
      message: "Can the logo be bigger?",
      reviewId,
      clipId,
      commentId: id,
    });
    expect(alert.recipients).toBeUndefined();
    const bell = await maya.as.query(api.alerts.list, { organizationId: team });
    expect(bell.alerts[0].href).toBe(`/review/${reviewId}?clip=${clipId}&comment=${id}`);
  });

  test("shows the client only their own threads unless the team shares its comments too", async () => {
    const { maya, reviewId, clipId, client } = await shared();
    await maya.as.mutation(api.reviews.comment, {
      clipId,
      body: "Internal: the client will hate this font",
      time: 1,
      version: 1,
    });
    const asked = await client().say("Is this the final music?");
    await maya.as.mutation(api.reviews.comment, {
      clipId,
      body: "Yes, licensed.",
      time: 0,
      version: 1,
      parentId: asked,
    });
    expect((await client().sees()).map((row) => row.body)).toEqual([
      "Is this the final music?",
      "Yes, licensed.",
    ]);
    expect((await client().sees())[0].mine).toBe(true);
    expect((await client(OTHER).sees())[0].mine).toBe(false);

    await maya.as.mutation(api.reviewShares.set, {
      reviewId,
      allowVerdict: true,
      showTeamComments: true,
    });
    expect((await client().sees()).map((row) => row.body)).toContain(
      "Internal: the client will hate this font",
    );
  });

  test("does not let the client reply to a thread they cannot see", async () => {
    const { maya, clipId, client } = await shared();
    const hidden = await maya.as.mutation(api.reviews.comment, {
      clipId,
      body: "Team only",
      time: 1,
      version: 1,
    });
    await expect(client().say("Sneaky reply", hidden)).rejects.toThrow(/gone/);
  });

  test("tagging the agent or a teammate from the link does nothing special", async () => {
    const { t, client, alerts } = await shared();
    await client().say("@Agent @Maya Ortiz what do you think?");
    const rows = await t.run((ctx) => ctx.db.query("reviewComments").collect());
    expect(rows).toHaveLength(1);
    expect((await alerts()).map((alert) => alert.kind)).toEqual(["client_feedback"]);
  });

  test("lets the client delete only what they wrote", async () => {
    const { t, token, maya, clipId, client } = await shared();
    const mine = await client().say("Typo here");
    await expect(
      t.mutation(api.sharedReview.removeComment, { token, guestId: OTHER, commentId: mine }),
    ).rejects.toThrow(/your own/);
    await t.mutation(api.sharedReview.removeComment, { token, guestId: RILEY, commentId: mine });
    expect(await maya.as.query(api.reviews.comments, { clipId })).toEqual([]);
  });

  test("needs a name and a browser id, and stops working once switched off", async () => {
    const { maya, reviewId, client } = await shared();
    await expect(client(RILEY, "   ").say("Hello")).rejects.toThrow(/who you are/);
    await expect(client("short").say("Hello")).rejects.toThrow(/Open the link again/);
    await maya.as.mutation(api.reviewShares.stop, { reviewId });
    await expect(client().say("Hello")).rejects.toThrow(/no longer shared/);
  });

  test("records the client's verdict for the team without deciding the review", async () => {
    const { t, token, maya, reviewId, alerts } = await shared();
    await t.mutation(api.sharedReview.verdict, {
      token,
      guestId: RILEY,
      name: "Riley Client",
      approved: true,
    });
    const review = await maya.as.query(api.reviews.get, { reviewId });
    expect(review!.status).toBe("open");
    expect(review!.clientVerdict).toMatchObject({ name: "Riley Client", approved: true });
    expect((await t.query(api.sharedReview.room, { token }))!.verdict).toMatchObject({
      approved: true,
    });
    expect((await alerts()).at(-1)).toMatchObject({
      kind: "client_feedback",
      message: "Approved the review.",
    });

    // Once the team decides, the client cannot change their mind; reopening clears it.
    await maya.as.mutation(api.reviews.decide, { reviewId, approved: true });
    await expect(
      t.mutation(api.sharedReview.verdict, {
        token,
        guestId: RILEY,
        name: "Riley Client",
        approved: false,
      }),
    ).rejects.toThrow(/already decided/);
    await maya.as.mutation(api.reviews.reopen, { reviewId });
    expect((await maya.as.query(api.reviews.get, { reviewId }))!.clientVerdict).toBeNull();
  });

  test("refuses a verdict when the team did not ask for one", async () => {
    const { t, token } = await shared({ allowVerdict: false, showTeamComments: false });
    await expect(
      t.mutation(api.sharedReview.verdict, {
        token,
        guestId: RILEY,
        name: "Riley",
        approved: true,
      }),
    ).rejects.toThrow(/not asked you/);
  });

  test("goes when the review is deleted", async () => {
    const { t, token, maya, reviewId } = await shared();
    await maya.as.mutation(api.reviews.remove, { reviewId });
    expect(await t.run((ctx) => ctx.db.query("reviewShares").collect())).toEqual([]);
    expect(await t.query(api.sharedReview.room, { token })).toBeNull();
  });
});
