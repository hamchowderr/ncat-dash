import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

const CLIP = "https://files.example/opening_hello.mp4";
const OTHER = "https://files.example/sign-off.mp4";

async function room() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const dev = await addPerson(t, "Dev Patel", [team]);
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  const reviewId = await maya.as.mutation(api.reviews.create, {
    organizationId: team,
    title: "Weekly clips",
    urls: [CLIP, OTHER, CLIP],
  });
  const review = await maya.as.query(api.reviews.get, { reviewId });
  return { t, team, maya, dev, outsider, reviewId, clip: review!.clips[0] };
}

describe("opening and reading a review", () => {
  test("makes one clip per file, named from the file", async () => {
    const { maya, team, reviewId } = await room();
    const review = await maya.as.query(api.reviews.get, { reviewId });
    expect(review?.title).toBe("Weekly clips");
    expect(review?.status).toBe("open");
    expect(review?.clips.map((clip) => clip.title)).toEqual(["Opening hello", "Sign off"]);
    const list = await maya.as.query(api.reviews.list, { organizationId: team });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ clips: 2, comments: 0, open: 0, fromRun: false });
  });

  test("needs at least one real file address", async () => {
    const { maya, team } = await room();
    await expect(
      maya.as.mutation(api.reviews.create, { organizationId: team, urls: ["not a link"] }),
    ).rejects.toThrow();
  });

  test("is closed to people outside the team and to visitors", async () => {
    const { t, team, outsider, reviewId, clip } = await room();
    expect(await outsider.as.query(api.reviews.get, { reviewId })).toBeNull();
    expect(await outsider.as.query(api.reviews.comments, { clipId: clip._id })).toEqual([]);
    await expect(outsider.as.query(api.reviews.list, { organizationId: team })).rejects.toThrow();
    await expect(
      outsider.as.mutation(api.reviews.create, { organizationId: team, urls: [CLIP] }),
    ).rejects.toThrow();
    await expect(
      outsider.as.mutation(api.reviews.comment, {
        clipId: clip._id,
        body: "hello",
        time: 1,
        version: 1,
      }),
    ).rejects.toThrow();
    await expect(
      outsider.as.mutation(api.reviews.decide, { reviewId, approved: true }),
    ).rejects.toThrow();
    await expect(outsider.as.mutation(api.reviews.remove, { reviewId })).rejects.toThrow();
    await expect(t.query(api.reviews.list, { organizationId: team })).rejects.toThrow();
    expect(await t.query(api.reviews.get, { reviewId })).toBeNull();
  });

  test("lists the team's people for tagging", async () => {
    const { maya, team } = await room();
    const roster = await maya.as.query(api.reviews.people, { organizationId: team });
    expect(roster.me).toBe(maya.id);
    expect(roster.people.map((person) => person.name).sort()).toEqual(["Dev Patel", "Maya Ortiz"]);
  });
});

describe("comments", () => {
  test("are pinned to a moment and carry the author's name", async () => {
    const { maya, dev, clip } = await room();
    await maya.as.mutation(api.reviews.comment, {
      clipId: clip._id,
      body: "  Logo covers the patch  ",
      time: 2.4,
      version: 1,
    });
    const seen = await dev.as.query(api.reviews.comments, { clipId: clip._id });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      body: "Logo covers the patch",
      time: 2.4,
      version: 1,
      authorName: "Maya Ortiz",
      resolved: false,
      mine: false,
      parentId: null,
    });
  });

  test("refuse empty and overlong text", async () => {
    const { maya, clip } = await room();
    const write = (body: string) =>
      maya.as.mutation(api.reviews.comment, { clipId: clip._id, body, time: 0, version: 1 });
    await expect(write("   ")).rejects.toThrow();
    await expect(write("x".repeat(4001))).rejects.toThrow();
  });

  test("a reply joins the thread, takes its moment, and reopens it", async () => {
    const { maya, dev, clip } = await room();
    const root = await maya.as.mutation(api.reviews.comment, {
      clipId: clip._id,
      body: "Too slow here",
      time: 3,
      version: 1,
    });
    await dev.as.mutation(api.reviews.resolve, { commentId: root, resolved: true });
    const reply = await dev.as.mutation(api.reviews.comment, {
      clipId: clip._id,
      body: "Agreed",
      time: 99,
      version: 1,
      parentId: root,
    });
    // A reply to a reply stays in the same thread.
    await maya.as.mutation(api.reviews.comment, {
      clipId: clip._id,
      body: "Fixing",
      time: 50,
      version: 1,
      parentId: reply,
    });
    const all = await maya.as.query(api.reviews.comments, { clipId: clip._id });
    expect(all.filter((entry) => entry.parentId === root)).toHaveLength(2);
    expect(all.every((entry) => entry.time === 3)).toBe(true);
    expect(all.find((entry) => entry.id === root)?.resolved).toBe(false);
  });

  test("only the author deletes a comment, and a thread goes with its first comment", async () => {
    const { maya, dev, clip, reviewId } = await room();
    const root = await maya.as.mutation(api.reviews.comment, {
      clipId: clip._id,
      body: "First",
      time: 1,
      version: 1,
    });
    await dev.as.mutation(api.reviews.comment, {
      clipId: clip._id,
      body: "Reply",
      time: 1,
      version: 1,
      parentId: root,
    });
    await expect(dev.as.mutation(api.reviews.removeComment, { commentId: root })).rejects.toThrow();
    await maya.as.mutation(api.reviews.removeComment, { commentId: root });
    expect(await maya.as.query(api.reviews.comments, { clipId: clip._id })).toEqual([]);
    expect((await maya.as.query(api.reviews.get, { reviewId }))?.clips[0].comments).toBe(0);
  });

  test("count what is still open on the clip and the review", async () => {
    const { maya, team, clip, reviewId } = await room();
    const write = (body: string) =>
      maya.as.mutation(api.reviews.comment, { clipId: clip._id, body, time: 1, version: 1 });
    const first = await write("One");
    await write("Two");
    await maya.as.mutation(api.reviews.resolve, { commentId: first, resolved: true });
    const review = await maya.as.query(api.reviews.get, { reviewId });
    expect(review?.clips[0]).toMatchObject({ comments: 2, open: 1 });
    const [listed] = await maya.as.query(api.reviews.list, { organizationId: team });
    expect(listed).toMatchObject({ comments: 2, open: 1 });
  });
});

describe("versions and decisions", () => {
  test("a new version is added after the earlier ones", async () => {
    const { maya, clip, reviewId } = await room();
    await maya.as.mutation(api.reviews.addVersion, {
      clipId: clip._id,
      url: "https://files.example/opening_hello_v2.mp4",
    });
    await expect(
      maya.as.mutation(api.reviews.addVersion, { clipId: clip._id, url: "nope" }),
    ).rejects.toThrow();
    const review = await maya.as.query(api.reviews.get, { reviewId });
    expect(review?.clips[0].versions.map((version) => version.url)).toEqual([
      CLIP,
      "https://files.example/opening_hello_v2.mp4",
    ]);
    // A comment on a version that does not exist lands on the newest one.
    await maya.as.mutation(api.reviews.comment, {
      clipId: clip._id,
      body: "Better",
      time: 0,
      version: 9,
    });
    const [comment] = await maya.as.query(api.reviews.comments, { clipId: clip._id });
    expect(comment.version).toBe(2);
  });

  test("a review is decided once, can be reopened, and deleted with everything in it", async () => {
    const { t, maya, dev, clip, reviewId } = await room();
    await maya.as.mutation(api.reviews.comment, {
      clipId: clip._id,
      body: "Note",
      time: 0,
      version: 1,
    });
    await dev.as.mutation(api.reviews.decide, { reviewId, approved: true });
    const decided = await maya.as.query(api.reviews.get, { reviewId });
    expect(decided).toMatchObject({ status: "approved", decidedBy: dev.id });
    await expect(
      maya.as.mutation(api.reviews.decide, { reviewId, approved: false }),
    ).rejects.toThrow();

    await maya.as.mutation(api.reviews.reopen, { reviewId });
    expect((await maya.as.query(api.reviews.get, { reviewId }))?.status).toBe("open");

    await maya.as.mutation(api.reviews.remove, { reviewId });
    expect(await maya.as.query(api.reviews.get, { reviewId })).toBeNull();
    const left = await t.run(async (ctx) => ({
      clips: await ctx.db.query("reviewClips").collect(),
      comments: await ctx.db.query("reviewComments").collect(),
    }));
    expect(left).toEqual({ clips: [], comments: [] });
  });
});
