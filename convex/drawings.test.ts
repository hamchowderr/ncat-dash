import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

const CLIP = "https://files.example/opening_hello.mp4";
const BOX = { tool: "box" as const, color: "red" as const, points: [0.1, 0.2, 0.5, 0.6] };

async function room() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const dev = await addPerson(t, "Dev Patel", [team]);
  const reviewId = await maya.as.mutation(api.reviews.create, {
    organizationId: team,
    title: "Weekly clips",
    urls: [CLIP],
  });
  const review = await maya.as.query(api.reviews.get, { reviewId });
  const clipId = review!.clips[0]._id;
  return { t, maya, dev, reviewId, clipId };
}

describe("a drawing on the frame", () => {
  test("is kept with the comment and seen by the whole team", async () => {
    const { maya, dev, clipId } = await room();
    await maya.as.mutation(api.reviews.comment, {
      clipId,
      body: "Move the logo here",
      time: 2,
      version: 1,
      drawing: [BOX, { tool: "pen", color: "yellow", points: [0.3, 0.3, 1.4, 0.35] }],
    });
    const [seen] = await dev.as.query(api.reviews.comments, { clipId });
    expect(seen.drawing).toEqual([
      BOX,
      // Points off the picture are pulled back onto it.
      { tool: "pen", color: "yellow", points: [0.3, 0.3, 1, 0.35] },
    ]);
  });

  test("is left off a comment without one, an empty drawing and a reply", async () => {
    const { maya, clipId } = await room();
    const root = await maya.as.mutation(api.reviews.comment, {
      clipId,
      body: "No drawing",
      time: 1,
      version: 1,
      drawing: [],
    });
    await maya.as.mutation(api.reviews.comment, {
      clipId,
      body: "A reply",
      time: 0,
      version: 1,
      parentId: root,
      drawing: [BOX],
    });
    const rows = await maya.as.query(api.reviews.comments, { clipId });
    expect(rows.map((row) => row.drawing)).toEqual([null, null]);
  });

  test("refuses a tool or colour it does not know", async () => {
    const { maya, clipId } = await room();
    await expect(
      maya.as.mutation(api.reviews.comment, {
        clipId,
        body: "Laser",
        time: 1,
        version: 1,
        // @ts-expect-error: not a tool
        drawing: [{ tool: "laser", color: "red", points: [0, 0, 1, 1] }],
      }),
    ).rejects.toThrow();
  });

  test("can be sent by a client through the share link, and the team sees it", async () => {
    const { t, maya, reviewId, clipId } = await room();
    const token = await maya.as.mutation(api.reviewShares.set, {
      reviewId,
      allowVerdict: true,
      showTeamComments: false,
    });
    const guestId = "riley-browser-0001";
    await t.mutation(api.sharedReview.comment, {
      token,
      guestId,
      name: "Riley Client",
      clipId,
      body: "This bit",
      time: 3,
      version: 1,
      drawing: [{ tool: "arrow", color: "blue", points: [0.9, 0.9, 0.5, 0.5] }],
    });
    const [mine] = await t.query(api.sharedReview.comments, { token, clipId, guestId });
    expect(mine.drawing).toEqual([{ tool: "arrow", color: "blue", points: [0.9, 0.9, 0.5, 0.5] }]);
    const [seen] = await maya.as.query(api.reviews.comments, { clipId });
    expect(seen.drawing).toEqual(mine.drawing);
  });
});
