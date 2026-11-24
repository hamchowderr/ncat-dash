import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { plainFromTeams } from "./microsoftTeamsReview";
import { addPerson, addTeam, backend } from "./test.setup";

// Review activity in the team's Microsoft Teams channel, the way Slack has it: new reviews,
// client feedback and mentions are posted to the channel the team picked, each comment
// thread as its own Teams reply thread, and a teammate's reply in that Teams thread comes
// back into the review.

const SECRET = "the-agent-shared-secret-of-at-least-32-chars";
const TENANT = "11111111-2222-3333-4444-555555555555";
const SERVICE = "https://smba.trafficmanager.net/amer";
const CHANNEL = "19:edits@thread.tacv2";
const CLIP = "https://files.example/opening_hello.mp4";

type Card = {
  body: {
    type: string;
    text?: string;
    columns?: { items: { type: string; url?: string; text?: string }[] }[];
    items?: { text: string }[];
  }[];
  msteams?: { entities?: unknown[] };
};
type Posted = {
  conversation: string;
  text?: string;
  summary?: string;
  card?: Card;
  entities?: unknown[];
  id: string;
};

/** A card as read in Teams: who it is from, their picture, then the words and any quote. */
function shown(card: Card | undefined) {
  if (!card) return null;
  const [header, lead, quote] = card.body;
  const items = header.columns?.flatMap((column) => column.items) ?? [];
  return {
    from: items.find((item) => item.type === "TextBlock")?.text,
    picture: items.find((item) => item.type === "Image")?.url ?? null,
    words: lead?.text,
    quote: quote?.items?.[0]?.text ?? null,
  };
}
let posted: Posted[] = [];
let nextId = 1000;

beforeEach(() => {
  vi.useFakeTimers();
  process.env.MASTRA_JWT_SECRET = SECRET;
  process.env.TEAMS_APP_ID = "c4d4ec4e-0000-0000-0000-000000000001";
  process.env.TEAMS_APP_PASSWORD = "a-bot-password";
  process.env.TEAMS_LOGIN_URL = "https://login.test";
  posted = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://login.test/botframework.com/oauth2/v2.0/token") {
      return Response.json({ access_token: "bot-token" });
    }
    const prefix = `${SERVICE}/v3/conversations/`;
    if (url.startsWith(prefix) && url.endsWith("/activities")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const id = String(++nextId);
      posted.push({
        conversation: decodeURIComponent(url.slice(prefix.length, -"/activities".length)),
        text: body.text,
        summary: body.summary,
        card: body.attachments?.[0]?.content,
        entities: body.entities,
        id,
      });
      return Response.json({ id });
    }
    return new Response("unknown", { status: 404 });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const key of [
    "MASTRA_JWT_SECRET",
    "TEAMS_APP_ID",
    "TEAMS_APP_PASSWORD",
    "TEAMS_LOGIN_URL",
  ]) {
    delete process.env[key];
  }
});

// The clock is the test's own from the start, so work scheduled for later (the chat
// pool's next round) always runs when the test waits for it.
async function settled(t: ReturnType<typeof backend>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

/** A team whose Microsoft organization is linked, with alerts going to the Edits channel. */
async function setUp({ channel = true } = {}) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const jordan = await addPerson(t, "Jordan Lee", [team], "owner");
  const dev = await addPerson(t, "Dev Patel", [team], "member");
  await t.run(async (ctx) => {
    await ctx.db.insert("teamsTenants", {
      organizationId: team,
      tenantId: TENANT,
      tenantName: "Salt House Media",
      addedBy: jordan.id,
      addedAt: Date.now(),
      ...(channel
        ? {
            alertConversationId: CHANNEL,
            alertServiceUrl: SERVICE,
            alertChannelName: "Video team › Edits",
          }
        : {}),
    });
    // Dev linked their Microsoft account; Jordan did not.
    await ctx.db.insert("teamsPeople", {
      organizationId: team,
      userId: dev.id,
      aadObjectId: "aad-dev",
      name: "Dev Patel",
      linkedAt: Date.now(),
    });
  });
  return { t, team, jordan, dev };
}

async function openRoom(setup: Awaited<ReturnType<typeof setUp>>) {
  const reviewId = await setup.jordan.as.mutation(api.reviews.create, {
    organizationId: setup.team,
    title: "Weekly clips",
    urls: [CLIP],
  });
  const review = await setup.jordan.as.query(api.reviews.get, { reviewId });
  return { reviewId, clipId: review!.clips[0]._id as Id<"reviewClips"> };
}

function agentToken() {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const body = `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: "agent-server", aud: "takewon-dashboard", iat, exp: iat + 300 })}`;
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}

/** The agent server passing on a message written in a Teams reply thread. */
async function teamsReply(t: ReturnType<typeof backend>, body: Record<string, string>) {
  const response = await t.fetch("/teams/review-reply", {
    method: "POST",
    headers: { authorization: `Bearer ${agentToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ tenantId: TENANT, conversationId: CHANNEL, ...body }),
  });
  expect(response.status).toBe(200);
  return await response.json();
}

/** A client's comment on the clip, which becomes a thread in the channel. */
async function clientComment(setup: Awaited<ReturnType<typeof setUp>>) {
  const { reviewId, clipId } = await openRoom(setup);
  const token = await setup.jordan.as.mutation(api.reviewShares.set, {
    reviewId,
    allowVerdict: true,
    showTeamComments: false,
  });
  const rootId = await setup.t.mutation(api.sharedReview.comment, {
    token,
    guestId: "riley-browser-0001",
    name: "Riley",
    clipId,
    body: "Can the end card stay up longer?",
    time: 62,
    version: 1,
  });
  await settled(setup.t);
  return { reviewId, clipId, token, rootId };
}

describe("what the Teams channel hears", () => {
  test("a new review, then a client's comment as its own thread, with what follows in it", async () => {
    const setup = await setUp();
    const { t, jordan } = setup;
    const { reviewId, clipId, token, rootId } = await clientComment(setup);
    expect(posted.map((one) => one.conversation)).toEqual([CHANNEL, CHANNEL]);
    expect(posted[0].text).toBe(
      `New review: [Weekly clips](http://localhost:3000/review/${reviewId}) (1 clip), opened by Jordan Lee.`,
    );
    const thread = posted[1];
    // Riley's words come headed by her name, marked as the client; she has no picture.
    expect(thread.text).toBeUndefined();
    expect(shown(thread.card)).toEqual({
      from: "Riley (client)",
      picture: null,
      words: `Commented on [Weekly clips](http://localhost:3000/review/${reviewId}?clip=${clipId}&comment=${rootId}), Opening hello at 1:02`,
      quote: "Can the end card stay up longer?",
    });
    expect(thread.summary).toBe("Riley (client): Can the end card stay up longer?");
    // Only feedback the review posts as a thread; it is not posted a second time as an alert.
    expect(posted).toHaveLength(2);

    await jordan.as.mutation(api.reviews.comment, {
      clipId,
      body: "Sure, two more seconds.",
      time: 0,
      version: 1,
      parentId: rootId,
    });
    await t.mutation(api.sharedReview.comment, {
      token,
      guestId: "riley-browser-0001",
      name: "Riley",
      clipId,
      body: "Thanks!",
      time: 0,
      version: 1,
      parentId: rootId,
    });
    await settled(t);
    expect(posted.slice(2).map((one) => [one.conversation, shown(one.card)])).toEqual([
      [
        `${CHANNEL};messageid=${thread.id}`,
        { from: "Jordan Lee", picture: null, words: "Sure, two more seconds.", quote: null },
      ],
      [
        `${CHANNEL};messageid=${thread.id}`,
        { from: "Riley (client)", picture: null, words: "Thanks!", quote: null },
      ],
    ]);
  });

  test("a mention tags the person in Teams when their Microsoft account is known", async () => {
    const setup = await setUp();
    const { clipId } = await openRoom(setup);
    await settled(setup.t);
    posted = [];
    await setup.jordan.as.mutation(api.reviews.comment, {
      clipId,
      body: "@Dev Patel can you look at the cut?",
      time: 5,
      version: 1,
    });
    await settled(setup.t);
    expect(posted).toHaveLength(1);
    expect(shown(posted[0].card)).toEqual({
      from: "Jordan Lee",
      picture: null,
      words: expect.stringMatching(
        /^Mentioned <at>Dev Patel<\/at> on \[Weekly clips\]\(.*\), Opening hello at 0:05$/,
      ),
      quote: "@Dev Patel can you look at the cut?",
    });
    // The tag lives in the card, so Teams tells Dev.
    expect(posted[0].card?.msteams?.entities).toEqual([
      {
        type: "mention",
        text: "<at>Dev Patel</at>",
        mentioned: { id: "aad-dev", name: "Dev Patel" },
      },
    ]);
  });

  test("a teammate's picture heads the card only when it is at an https address", async () => {
    const setup = await setUp();
    const setPicture = (userId: string, image: string) =>
      setup.t.run((ctx) =>
        ctx.runMutation(components.betterAuth.adapter.updateOne, {
          input: {
            model: "user",
            where: [{ field: "_id", value: userId }],
            update: { image },
          },
        } as never),
      );
    await setPicture(setup.jordan.id, "https://cdn.example/jordan.png");
    await setPicture(setup.dev.id, "data:image/png;base64,AAAA");
    const { clipId } = await openRoom(setup);
    await settled(setup.t);
    posted = [];
    const rootId = await setup.jordan.as.mutation(api.reviews.comment, {
      clipId,
      body: "@Dev Patel tighten the intro?",
      time: 3,
      version: 1,
    });
    await settled(setup.t);
    await setup.dev.as.mutation(api.reviews.comment, {
      clipId,
      body: "@Jordan Lee done.",
      time: 0,
      version: 1,
      parentId: rootId,
    });
    await settled(setup.t);
    expect(posted.map((one) => shown(one.card)?.from)).toEqual(["Jordan Lee", "Dev Patel"]);
    expect(posted.map((one) => shown(one.card)?.picture)).toEqual([
      "https://cdn.example/jordan.png",
      null,
    ]);
    const header = posted[0].card?.body[0].columns?.[0].items[0];
    expect(header).toMatchObject({ type: "Image", style: "Person", altText: "Jordan Lee" });
  });

  test("a plain reply in the room stays out of Teams until its thread is there", async () => {
    const setup = await setUp();
    const { clipId } = await openRoom(setup);
    const rootId = await setup.jordan.as.mutation(api.reviews.comment, {
      clipId,
      body: "Note to self: tighten the intro.",
      time: 1,
      version: 1,
    });
    await setup.dev.as.mutation(api.reviews.comment, {
      clipId,
      body: "Agreed.",
      time: 0,
      version: 1,
      parentId: rootId,
    });
    await settled(setup.t);
    expect(posted.map((one) => one.text)).toEqual([expect.stringMatching(/^New review:/)]);
  });

  test("with no channel picked, nothing about reviews goes to Teams", async () => {
    const setup = await setUp({ channel: false });
    await clientComment(setup);
    expect(posted).toEqual([]);
  });
});

describe("replies written in Teams", () => {
  test("a linked teammate's reply in the thread goes into the review, once", async () => {
    const setup = await setUp();
    const { rootId } = await clientComment(setup);
    const thread = posted[1];
    const answer = await teamsReply(setup.t, {
      aadObjectId: "aad-dev",
      rootActivityId: thread.id,
      activityId: "reply-1",
      text: "On it, <b>two</b> more seconds.",
    });
    expect(answer).toEqual({ handled: true, added: true, message: null });
    // Teams sending the same message again adds nothing.
    await teamsReply(setup.t, {
      aadObjectId: "aad-dev",
      rootActivityId: thread.id,
      activityId: "reply-1",
      text: "On it, <b>two</b> more seconds.",
    });
    await settled(setup.t);
    const replies = await setup.t.run((ctx) =>
      ctx.db
        .query("reviewComments")
        .filter((q) => q.eq(q.field("parentId"), rootId))
        .collect(),
    );
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      authorId: setup.dev.id,
      authorName: "Dev Patel",
      body: "On it, two more seconds.",
      teams: true,
    });
    // What was written in Teams is not posted back to Teams.
    expect(posted).toHaveLength(2);
  });

  test("tagging the bot in the thread still adds the words, without the tag", async () => {
    const setup = await setUp();
    const { rootId } = await clientComment(setup);
    await teamsReply(setup.t, {
      aadObjectId: "aad-dev",
      rootActivityId: posted[1].id,
      activityId: "reply-2",
      text: "<at>Takewon</at> looks good to me",
      botName: "Takewon",
    });
    const [reply] = await setup.t.run((ctx) =>
      ctx.db
        .query("reviewComments")
        .filter((q) => q.eq(q.field("parentId"), rootId))
        .collect(),
    );
    expect(reply.body).toBe("looks good to me");
  });

  test("someone not linked is told how, and their words stay in Teams", async () => {
    const setup = await setUp();
    await clientComment(setup);
    const answer = await teamsReply(setup.t, {
      aadObjectId: "aad-stranger",
      rootActivityId: posted[1].id,
      activityId: "reply-3",
      text: "Who is this client?",
    });
    expect(answer).toMatchObject({
      handled: true,
      added: false,
      message: expect.stringMatching(/Link my Microsoft account/),
    });
  });

  test("a thread that is not a review's, or another organization, is left to the agent", async () => {
    const setup = await setUp();
    await clientComment(setup);
    expect(
      await teamsReply(setup.t, {
        aadObjectId: "aad-dev",
        rootActivityId: "some-other-thread",
        activityId: "reply-4",
        text: "Hello",
      }),
    ).toEqual({ handled: false });
    expect(
      await teamsReply(setup.t, {
        tenantId: "99999999-2222-3333-4444-555555555555",
        aadObjectId: "aad-dev",
        rootActivityId: posted[1].id,
        activityId: "reply-5",
        text: "Hello",
      }),
    ).toEqual({ handled: false });
  });

  test("only the agent server may pass replies on", async () => {
    const { t } = await setUp();
    const response = await t.fetch("/teams/review-reply", {
      method: "POST",
      headers: { authorization: "Bearer nope", "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(401);
  });
});

describe("Teams message markup", () => {
  test("tags, line breaks and entities become plain words", () => {
    expect(plainFromTeams("<p>Hi <at>Dev Patel</at>,</p><p>see&nbsp;this &amp; that</p>")).toBe(
      "Hi @Dev Patel,\nsee this & that",
    );
  });
});
