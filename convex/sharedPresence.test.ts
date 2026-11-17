import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

const CLIP = "https://files.example/opening_hello.mp4";
const RILEY = "riley-browser-0001";

async function room(settings = { allowVerdict: true, showTeamComments: false }) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const reviewId = await maya.as.mutation(api.reviews.create, {
    organizationId: team,
    title: "Weekly clips",
    urls: [CLIP],
  });
  const review = await maya.as.query(api.reviews.get, { reviewId });
  const clipId = review!.clips[0]._id;
  const token = await maya.as.mutation(api.reviewShares.set, { reviewId, ...settings });
  const teamJoin = await maya.as.mutation(api.presence.heartbeat, {
    roomId: reviewId,
    userId: maya.id,
    sessionId: "maya-tab",
    interval: 10_000,
  });
  const clientJoin = await t.mutation(api.sharedPresence.heartbeat, {
    token,
    guestId: RILEY,
    name: "Riley Client",
    sessionId: "riley-tab",
    interval: 10_000,
  });
  const clientSees = () =>
    t.query(api.sharedPresence.here, { token, guestId: RILEY, roomToken: clientJoin.roomToken });
  const teamSees = () => maya.as.query(api.presence.list, { roomToken: teamJoin.roomToken });
  return { t, maya, reviewId, clipId, token, clientSees, teamSees };
}

describe("who is here, through a share link", () => {
  test("the client and the team see each other, the client by the name they gave", async () => {
    const { maya, clientSees, teamSees } = await room();
    const seen = await clientSees();
    expect(seen).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: maya.id, name: "Maya Ortiz", client: false, me: false }),
        expect.objectContaining({
          id: `guest:${RILEY}`,
          name: "Riley Client",
          client: true,
          me: true,
        }),
      ]),
    );
    const team = await teamSees();
    expect(team.find((state) => state.userId === `guest:${RILEY}`)?.data).toMatchObject({
      name: "Riley Client",
      client: true,
    });
  });

  test("a client cannot join with a dead link or a bad id", async () => {
    const { t, maya, reviewId, token } = await room();
    const join = (guestId: string) =>
      t.mutation(api.sharedPresence.heartbeat, {
        token,
        guestId,
        name: "Riley",
        sessionId: "x",
        interval: 10_000,
      });
    await expect(join("short")).rejects.toThrow(/Open the link again/);
    await maya.as.mutation(api.reviewShares.stop, { reviewId });
    await expect(join(RILEY)).rejects.toThrow(/no longer shared/);
  });

  test("another room's token shows the client nobody", async () => {
    const { t, token } = await room();
    const other = await room();
    expect(
      await t.query(api.sharedPresence.here, {
        token,
        guestId: RILEY,
        roomToken: (
          await other.maya.as.mutation(api.presence.heartbeat, {
            roomId: other.reviewId,
            userId: other.maya.id,
            sessionId: "m",
            interval: 10_000,
          })
        ).roomToken,
      }),
    ).toEqual([]);
  });
});

describe("who is typing", () => {
  test("the team sees where the client is typing", async () => {
    const { t, token, clipId, teamSees } = await room();
    await t.mutation(api.sharedPresence.typing, {
      token,
      guestId: RILEY,
      name: "Riley Client",
      typing: { clipId, version: 1, threadId: null },
    });
    const riley = (await teamSees()).find((state) => state.userId === `guest:${RILEY}`);
    expect(riley?.data).toMatchObject({ typing: { clipId, version: 1, threadId: null } });
  });

  test("the client sees a teammate typing only where they could see the result", async () => {
    const { t, maya, reviewId, clipId, token, clientSees } = await room();
    const own = await t.mutation(api.sharedReview.comment, {
      token,
      guestId: RILEY,
      name: "Riley Client",
      clipId,
      body: "Bigger logo?",
      time: 1,
      version: 1,
    });
    const internal = await maya.as.mutation(api.reviews.comment, {
      clipId,
      body: "Team only",
      time: 1,
      version: 1,
    });
    const mayaTyping = async (threadId: string | null) => {
      await maya.as.mutation(api.presence.typing, {
        roomId: reviewId,
        typing: { clipId, version: 1, threadId },
      });
      return (await clientSees()).find((person) => person.id === maya.id)?.typing ?? null;
    };
    expect(await mayaTyping(own)).toEqual({ clipId, version: 1, threadId: own });
    expect(await mayaTyping(internal)).toBeNull();
    expect(await mayaTyping(null)).toBeNull();

    await maya.as.mutation(api.reviewShares.set, {
      reviewId,
      allowVerdict: true,
      showTeamComments: true,
    });
    expect(await mayaTyping(null)).toEqual({ clipId, version: 1, threadId: null });

    await maya.as.mutation(api.presence.typing, { roomId: reviewId, typing: null });
    expect((await clientSees()).find((person) => person.id === maya.id)?.typing).toBeNull();
  });

  test("only a teammate can say they are typing in the team's room", async () => {
    const { t, reviewId, clipId } = await room();
    const outsider = await addPerson(t, "Olly Out", [await addTeam(t, "Elsewhere")]);
    await expect(
      outsider.as.mutation(api.presence.typing, {
        roomId: reviewId,
        typing: { clipId, version: 1, threadId: null },
      }),
    ).rejects.toThrow();
  });
});
