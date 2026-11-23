import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";

// Review activity in the team's Discord channel, like Slack's: an owner picks the
// channel, new reviews, client feedback and mentions are posted there with each comment
// thread as its own Discord thread, and a teammate's reply in that Discord thread comes
// back into the review. Discord is a stand-in here.

const SECRET = "an-agent-secret-of-at-least-32-characters";
const CLIP = "https://files.example/opening_hello.mp4";

type Sent = { channel: string; content: string; users: string[]; id: string };
let sent: Sent[] = [];
let threads: { channel: string; message: string; name: string; id: string }[] = [];
let nextId = 9000;
// Whether the bot may make webhooks (Manage Webhooks) in the stand-in server.
let webhooksAllowed = false;
let webhooksMade = 0;
type AsWriter = { thread: string | null; content: string; name: string; users: string[] };
let asWriters: AsWriter[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  process.env.DISCORD_API_URL = "https://discord.test/api";
  process.env.DISCORD_BOT_TOKEN = "discord-bot";
  process.env.MASTRA_JWT_SECRET = SECRET;
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  sent = [];
  threads = [];
  webhooksAllowed = false;
  webhooksMade = 0;
  asWriters = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const path = String(input).replace("https://discord.test/api", "");
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (init?.method === "GET" && path === "/guilds/300/channels") {
      return Response.json([
        { id: "c-voice", name: "Lounge", type: 2, position: 0 },
        { id: "c-reviews", name: "reviews", type: 0, position: 2 },
        { id: "c-general", name: "general", type: 0, position: 1 },
      ]);
    }
    if (path === "/channels/c-reviews/webhooks" && init?.method === "POST") {
      if (!webhooksAllowed) return new Response("Missing Permissions", { status: 403 });
      webhooksMade += 1;
      return Response.json({ id: "wh-1", token: "wh-secret" });
    }
    const hook = String(input).match(/\/webhooks\/wh-1\/wh-secret\?(.*)$/);
    if (hook) {
      const query = new URLSearchParams(hook[1]);
      const id = `m-${++nextId}`;
      asWriters.push({
        thread: query.get("thread_id"),
        content: body.content,
        name: body.username,
        users: body.allowed_mentions?.users ?? [],
      });
      // A webhook message in the channel is still a message a thread can start from.
      if (!query.get("thread_id")) {
        sent.push({ channel: "c-reviews", content: body.content, users: [], id });
      }
      return Response.json({ id });
    }
    const thread = path.match(/^\/channels\/([^/]+)\/messages\/([^/]+)\/threads$/);
    if (thread) {
      const id = `t-${++nextId}`;
      threads.push({ channel: thread[1], message: thread[2], name: body.name, id });
      return Response.json({ id });
    }
    const message = path.match(/^\/channels\/([^/]+)\/messages$/);
    if (message) {
      const id = `m-${++nextId}`;
      sent.push({
        channel: message[1],
        content: body.content,
        users: body.allowed_mentions?.users ?? [],
        id,
      });
      return Response.json({ id });
    }
    if (path === "/users/@me/channels") return Response.json({ id: `dm-${body.recipient_id}` });
    return new Response("unknown", { status: 404 });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.DISCORD_API_URL;
  delete process.env.DISCORD_BOT_TOKEN;
});

// The clock is the test's own from the start, so work scheduled for later (the chat
// pool's next round) always runs when the test waits for it.
async function settled(t: ReturnType<typeof backend>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

/** A team with the bot in its Discord server, Jordan and Dev linked, Sam not. */
async function setUp({ channel = true } = {}) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const jordan = await addPerson(t, "Jordan Lee", [team], "owner");
  const dev = await addPerson(t, "Dev Patel", [team], "member");
  const sam = await addPerson(t, "Sam Ito", [team], "member");
  await t.run(async (ctx) => {
    await ctx.db.insert("discordServers", {
      organizationId: team,
      guildId: "300",
      guildName: "Salt House Crew",
      addedBy: jordan.id,
      addedAt: Date.now(),
    });
    for (const [userId, discordUserId] of [
      [jordan.id, "201"],
      [dev.id, "202"],
    ]) {
      await ctx.db.insert("discordPeople", {
        organizationId: team,
        userId,
        discordUserId,
        discordName: userId,
        linkedAt: Date.now(),
      });
    }
  });
  if (channel) {
    expect(
      await jordan.as.action(api.discordReview.setAlertChannel, {
        organizationId: team,
        channelId: "c-reviews",
      }),
    ).toEqual({ ok: true });
  }
  return { t, team, jordan, dev, sam };
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
  const b = (value: string) => Buffer.from(value).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const body = `${b(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b(
    JSON.stringify({ sub: "agent-server", aud: "takewon-dashboard", iat, exp: iat + 300 }),
  )}`;
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}

/** What the agent server hands over for a message written in a Discord thread. */
async function discordReply(t: ReturnType<typeof backend>, body: Record<string, string>) {
  return await t.fetch("/discord/review-reply", {
    method: "POST",
    headers: { authorization: `Bearer ${agentToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ guildId: "300", messageId: `msg-${++nextId}`, ...body }),
  });
}

/** Leaves out the personal alerts, which are direct messages (alerts in chat apps). */
const inServer = () => sent.filter((one) => !one.channel.startsWith("dm-"));

describe("picking the Discord channel review activity goes to", () => {
  test("an owner sees the server's text channels in order and picks one", async () => {
    const { team, jordan, dev } = await setUp({ channel: false });
    expect(await jordan.as.action(api.discordReview.channels, { organizationId: team })).toEqual([
      { id: "c-general", name: "general", guildId: "300", guildName: "Salt House Crew" },
      { id: "c-reviews", name: "reviews", guildId: "300", guildName: "Salt House Crew" },
    ]);
    await jordan.as.action(api.discordReview.setAlertChannel, {
      organizationId: team,
      channelId: "c-reviews",
    });
    expect(await dev.as.query(api.discord.forTeam, { organizationId: team })).toMatchObject({
      reviewChannel: { id: "c-reviews", name: "reviews", guildName: "Salt House Crew" },
    });
  });

  test("a member cannot pick it, and a channel Discord does not list is refused", async () => {
    const { team, jordan, dev } = await setUp({ channel: false });
    await expect(
      dev.as.action(api.discordReview.setAlertChannel, {
        organizationId: team,
        channelId: "c-reviews",
      }),
    ).rejects.toThrow(/owner or admin/);
    expect(
      await jordan.as.action(api.discordReview.setAlertChannel, {
        organizationId: team,
        channelId: "c-voice",
      }),
    ).toMatchObject({ ok: false, detail: expect.stringMatching(/did not list that channel/) });
  });

  test("with no channel, nothing about reviews goes to the server", async () => {
    const setup = await setUp({ channel: false });
    await openRoom(setup);
    await settled(setup.t);
    expect(inServer()).toEqual([]);
  });
});

describe("what the Discord channel hears", () => {
  test("a new review, a client's comment as its own thread, and what follows in it", async () => {
    const setup = await setUp();
    const { t, jordan } = setup;
    const { reviewId, clipId } = await openRoom(setup);
    await settled(t);
    expect(inServer().map((one) => [one.channel, one.content])).toEqual([
      [
        "c-reviews",
        `New review: [Weekly clips](<http://localhost:3000/review/${reviewId}>) (1 clip), opened by Jordan Lee.`,
      ],
    ]);

    const token = await jordan.as.mutation(api.reviewShares.set, {
      reviewId,
      allowVerdict: true,
      showTeamComments: false,
    });
    const rootId = await t.mutation(api.sharedReview.comment, {
      token,
      guestId: "riley-browser-0001",
      name: "Riley",
      clipId,
      body: "Can the end card stay up **longer**?",
      time: 62,
      version: 1,
    });
    await settled(t);
    const comment = inServer()[1];
    expect(comment.content).toBe(
      `**Riley** (client) commented on [Weekly clips](<http://localhost:3000/review/${reviewId}?clip=${clipId}&comment=${rootId}>), Opening hello at 1:02:\n> Can the end card stay up \\*\\*longer\\*\\*?`,
    );
    // The comment's message starts a Discord thread named after the moment.
    expect(threads).toEqual([
      expect.objectContaining({
        channel: "c-reviews",
        message: comment.id,
        name: "Opening hello at 1:02",
      }),
    ]);
    const threadId = threads[0].id;

    // A teammate's reply in the room follows in that Discord thread.
    await jordan.as.mutation(api.reviews.comment, {
      clipId,
      body: "Sure, two more seconds.",
      time: 0,
      version: 1,
      parentId: rootId,
    });
    await settled(t);
    expect(inServer().at(-1)).toMatchObject({
      channel: threadId,
      content: "**Jordan Lee**: Sure, two more seconds.",
    });

    // Dev answers in Discord, in that thread: it lands in the review as Dev's reply, once.
    const reply = await discordReply(t, { threadId, discordUserId: "202", text: "Love it" });
    expect(await reply.json()).toEqual({ kind: "added" });
    await settled(t);
    const comments = await jordan.as.query(api.reviews.comments, { clipId });
    const replies = comments
      .filter((one) => one.parentId === rootId)
      .map((one) => [one.authorName, one.body]);
    expect(replies).toEqual([
      ["Jordan Lee", "Sure, two more seconds."],
      ["Dev Patel", "Love it"],
    ]);
    // What came from Discord is not posted back to it.
    expect(inServer().some((one) => one.content.includes("Love it"))).toBe(false);
  });

  test("a mention pings the person in Discord when they linked it", async () => {
    const setup = await setUp();
    const { t, jordan } = setup;
    const { clipId } = await openRoom(setup);
    await settled(t);
    sent = [];
    await jordan.as.mutation(api.reviews.comment, {
      clipId,
      body: "@Dev Patel and @Sam Ito, is the logo too small?",
      time: 4,
      version: 1,
    });
    await settled(t);
    const post = inServer()[0];
    expect(post.content).toMatch(
      /^\*\*Jordan Lee\*\* mentioned <@202> @Sam Ito on \[Weekly clips\]/,
    );
    // Only the linked person is pinged.
    expect(post.users).toEqual(["202"]);
  });

  test("with Manage Webhooks, replies go under the writer's own name, and never come back", async () => {
    webhooksAllowed = true;
    const setup = await setUp();
    const { t, jordan } = setup;
    const { reviewId, clipId } = await openRoom(setup);
    await settled(t);
    const token = await jordan.as.mutation(api.reviewShares.set, {
      reviewId,
      allowVerdict: true,
      showTeamComments: false,
    });
    const rootId = await t.mutation(api.sharedReview.comment, {
      token,
      guestId: "riley-browser-0001",
      name: "Riley",
      clipId,
      body: "Shorter intro?",
      time: 3,
      version: 1,
    });
    await settled(t);
    // The client's comment is posted as "Riley (client)", and still starts the thread.
    expect(asWriters[0]).toMatchObject({ thread: null, name: "Riley (client)" });
    expect(asWriters[0].content).toMatch(/^Commented on \[Weekly clips\]/);
    const threadId = threads[0].id;
    expect(threads[0].message).toBe(sent.at(-1)?.id);

    await jordan.as.mutation(api.reviews.comment, {
      clipId,
      body: "On it.",
      time: 0,
      version: 1,
      parentId: rootId,
    });
    await settled(t);
    expect(asWriters.at(-1)).toEqual({
      thread: threadId,
      content: "On it.",
      name: "Jordan Lee",
      users: [],
    });
    // One webhook for the channel, made once and kept.
    expect(webhooksMade).toBe(1);

    // Discord shows the webhook's own posts in the thread too: those are not replies.
    const echo = await discordReply(t, { threadId, discordUserId: "wh-1", text: "On it." });
    expect(await echo.json()).toEqual({ kind: "ignored" });
    const comments = await jordan.as.query(api.reviews.comments, { clipId });
    expect(comments.filter((one) => one.body === "On it.")).toHaveLength(1);
  });

  test("without Manage Webhooks, the bot posts with the name in the words", async () => {
    const setup = await setUp();
    const { t, jordan } = setup;
    const { clipId } = await openRoom(setup);
    await settled(t);
    await jordan.as.mutation(api.reviews.comment, {
      clipId,
      body: "@Dev Patel quick look?",
      time: 2,
      version: 1,
    });
    await settled(t);
    expect(asWriters).toEqual([]);
    expect(inServer().at(-1)?.content).toMatch(/^\*\*Jordan Lee\*\* mentioned <@202>/);
  });

  test("someone not linked is told their reply stays in Discord; other threads are left alone", async () => {
    const setup = await setUp();
    const { t, jordan } = setup;
    const { clipId } = await openRoom(setup);
    await jordan.as.mutation(api.reviews.comment, {
      clipId,
      body: "@Dev Patel look at this",
      time: 1,
      version: 1,
    });
    await settled(t);
    const threadId = threads[0].id;
    const stranger = await discordReply(t, { threadId, discordUserId: "999", text: "hi" });
    expect(await stranger.json()).toMatchObject({ kind: "not_linked" });
    const elsewhere = await discordReply(t, {
      threadId: "t-other",
      discordUserId: "202",
      text: "hi",
    });
    expect(await elsewhere.json()).toEqual({ kind: "ignored" });
    const comments = await jordan.as.query(api.reviews.comments, { clipId });
    expect(comments.some((one) => one.body === "hi")).toBe(false);

    const unsigned = await t.fetch("/discord/review-reply", {
      method: "POST",
      body: JSON.stringify({
        guildId: "300",
        threadId,
        messageId: "x",
        discordUserId: "202",
        text: "hi",
      }),
    });
    expect(unsigned.status).toBe(401);
  });
});
