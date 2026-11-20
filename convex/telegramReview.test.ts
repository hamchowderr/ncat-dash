import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { toReviewChannels } from "./lib/reviewChannels";
import { addPerson, addTeam, backend } from "./test.setup";

// Review activity in the team's Telegram group, the way its Slack channel works: an owner
// picks the group, new reviews, client feedback and mentions are posted there with every
// post about one comment thread replying to the first, and a linked teammate's Telegram
// reply comes back into the review.

const CLIP = "https://files.example/opening_hello.mp4";
const GROUP = "-100777";

type Sent = { chat_id: string; text: string; replyTo: number | null; messageId: number };
let sent: Sent[] = [];
let next = 500;

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "123:secret";
  process.env.TELEGRAM_BOT_USERNAME = "SaltHouseBot";
  process.env.TELEGRAM_API_URL = "https://telegram.stand-in";
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const address = String(url);
      if (!address.startsWith("https://telegram.stand-in/bot123:secret/")) {
        throw new Error(`Unexpected fetch ${address}`);
      }
      const body = JSON.parse(String(init?.body ?? "{}"));
      const messageId = next++;
      if (address.endsWith("/sendMessage")) {
        sent.push({
          chat_id: body.chat_id,
          text: body.text,
          replyTo: body.reply_parameters?.message_id ?? null,
          messageId,
        });
      }
      return Response.json({ ok: true, result: { message_id: messageId } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_USERNAME;
  delete process.env.TELEGRAM_API_URL;
});

async function settled(t: ReturnType<typeof backend>) {
  vi.useFakeTimers();
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
}

/** What went to the group (alerts to people's own chats are left out). */
function inGroup() {
  return sent.filter((one) => one.chat_id === GROUP);
}

async function setUp({ pick = true } = {}) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const jordan = await addPerson(t, "Jordan Lee", [team], "owner");
  const dev = await addPerson(t, "Dev Patel", [team], "member");
  await t.run(async (ctx) => {
    await ctx.db.insert("telegramGroups", {
      organizationId: team,
      chatId: GROUP,
      title: "Edit team",
      addedBy: jordan.id,
      addedAt: Date.now(),
    });
    await ctx.db.insert("telegramPeople", {
      organizationId: team,
      userId: dev.id,
      telegramUserId: "5550002",
      chatId: "5550002",
      telegramName: "Dev",
      username: "devp",
      linkedAt: Date.now(),
    });
  });
  if (pick) {
    await jordan.as.mutation(api.telegram.setReviewGroup, { organizationId: team, chatId: GROUP });
  }
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

async function clientComment(
  setup: Awaited<ReturnType<typeof setUp>>,
  room: Awaited<ReturnType<typeof openRoom>>,
) {
  const token = await setup.jordan.as.mutation(api.reviewShares.set, {
    reviewId: room.reviewId,
    allowVerdict: true,
    showTeamComments: false,
  });
  return await setup.t.mutation(api.sharedReview.comment, {
    token,
    guestId: "riley-browser-0001",
    name: "Riley",
    clipId: room.clipId,
    body: "Can the end card stay up longer? <b>please</b>",
    time: 62,
    version: 1,
  });
}

describe("picking the group review activity goes to", () => {
  test("an owner picks one group; Settings shows it; a member cannot", async () => {
    const { team, jordan, dev } = await setUp({ pick: false });
    await expect(
      dev.as.mutation(api.telegram.setReviewGroup, { organizationId: team, chatId: GROUP }),
    ).rejects.toThrow();
    await expect(
      jordan.as.mutation(api.telegram.setReviewGroup, { organizationId: team, chatId: "-1" }),
    ).rejects.toThrow("That group is not linked to this team.");
    await jordan.as.mutation(api.telegram.setReviewGroup, { organizationId: team, chatId: GROUP });
    const shown = await dev.as.query(api.telegram.forTeam, { organizationId: team });
    expect(shown?.groups).toEqual([expect.objectContaining({ chatId: GROUP, reviews: true })]);
    await jordan.as.mutation(api.telegram.setReviewGroup, { organizationId: team, chatId: null });
    const after = await dev.as.query(api.telegram.forTeam, { organizationId: team });
    expect(after?.groups[0].reviews).toBe(false);
  });

  test("with no group picked, nothing about reviews goes to Telegram", async () => {
    const setup = await setUp({ pick: false });
    const room = await openRoom(setup);
    await clientComment(setup, room);
    await settled(setup.t);
    expect(inGroup()).toEqual([]);
  });
});

describe("review activity in the group", () => {
  test("a new review, then a client's comment, with what follows replying to it", async () => {
    const setup = await setUp();
    const { t, jordan } = setup;
    const room = await openRoom(setup);
    await settled(t);
    expect(inGroup()).toHaveLength(1);
    expect(inGroup()[0].text).toBe(
      `New review: "Weekly clips" (1 clip), opened by Jordan Lee.\n\nOpen the review: http://localhost:3000/review/${room.reviewId}`,
    );

    const rootId = await clientComment(setup, room);
    await settled(t);
    const first = inGroup()[1];
    expect(first.replyTo).toBeNull();
    // Plain text: the client's words show exactly as written, never as formatting.
    expect(first.text).toBe(
      `Riley (client) commented on "Weekly clips", Opening hello at 1:02:\n\nCan the end card stay up longer? <b>please</b>\n\nOpen the review: http://localhost:3000/review/${room.reviewId}?clip=${room.clipId}&comment=${rootId}`,
    );

    await jordan.as.mutation(api.reviews.comment, {
      clipId: room.clipId,
      body: "Sure, two more seconds.",
      time: 0,
      version: 1,
      parentId: rootId,
    });
    await settled(t);
    expect(inGroup()[2]).toMatchObject({
      replyTo: first.messageId,
      text: "Jordan Lee: Sure, two more seconds.",
    });
  });

  test("a mention tags the person by their Telegram name", async () => {
    const setup = await setUp();
    const room = await openRoom(setup);
    await settled(setup.t);
    sent = [];
    await setup.jordan.as.mutation(api.reviews.comment, {
      clipId: room.clipId,
      body: "@Dev Patel is the logo too small?",
      time: 4,
      version: 1,
    });
    await settled(setup.t);
    expect(inGroup()).toHaveLength(1);
    expect(inGroup()[0].text).toMatch(
      /^Jordan Lee mentioned @devp on "Weekly clips", Opening hello at 0:04:\n\n@Dev Patel is the logo too small\?/,
    );
  });
});

describe("one fan-out for every chat app", () => {
  test("a reply written in another chat app still reaches the group; one written in Telegram does not", async () => {
    const setup = await setUp();
    const room = await openRoom(setup);
    const rootId = await clientComment(setup, room);
    await settled(setup.t);
    const post = (body: string) => ({
      kind: "team_reply" as const,
      reviewId: room.reviewId,
      commentId: rootId,
      from: "Dev Patel",
      body,
    });
    await setup.t.run(async (ctx) => {
      await toReviewChannels(ctx, setup.team, post("Written in Slack"), "slack");
      await toReviewChannels(ctx, setup.team, post("Written in Telegram"), "telegram");
    });
    await settled(setup.t);
    const texts = inGroup().map((one) => one.text);
    expect(texts).toContain("Dev Patel: Written in Slack");
    expect(texts.some((text) => text.includes("Written in Telegram"))).toBe(false);
  });
});

describe("replies written in Telegram", () => {
  async function threadInTelegram() {
    const setup = await setUp();
    const room = await openRoom(setup);
    const rootId = await clientComment(setup, room);
    await settled(setup.t);
    const post = inGroup().find((one) => one.text.startsWith("Riley"))!;
    return { ...setup, ...room, rootId, post };
  }

  test("a linked teammate's reply comes into the review as theirs, once, and is not posted back", async () => {
    const { t, rootId, post } = await threadInTelegram();
    const reply = {
      chatId: GROUP,
      replyTo: post.messageId,
      messageId: 9001,
      telegramUserId: "5550002",
      text: "On it, adding two seconds.",
    };
    expect(await t.mutation(internal.telegramReview.reply, reply)).toEqual({
      handled: true,
      message: null,
    });
    expect(await t.mutation(internal.telegramReview.reply, reply)).toEqual({
      handled: true,
      message: null,
    });
    await settled(t);
    const replies = await t.run(async (ctx) =>
      (await ctx.db.query("reviewComments").collect()).filter((one) => one.parentId === rootId),
    );
    expect(replies).toEqual([
      expect.objectContaining({
        body: "On it, adding two seconds.",
        authorName: "Dev Patel",
        telegram: true,
      }),
    ]);
    // Nothing went back to the group about it.
    expect(inGroup().filter((one) => one.text.includes("On it"))).toEqual([]);
  });

  test("someone who has not linked their Telegram is told their reply stays there", async () => {
    const { t, post } = await threadInTelegram();
    const answer = await t.mutation(internal.telegramReview.reply, {
      chatId: GROUP,
      replyTo: post.messageId,
      messageId: 9002,
      telegramUserId: "5550404",
      text: "Looks great",
    });
    expect(answer.handled).toBe(true);
    expect(answer.message).toMatch(/stays in Telegram/);
  });

  test("a reply to anything else is not about a review", async () => {
    const { t } = await threadInTelegram();
    expect(
      await t.mutation(internal.telegramReview.reply, {
        chatId: GROUP,
        replyTo: 1,
        messageId: 9003,
        telegramUserId: "5550002",
        text: "hello",
      }),
    ).toEqual({ handled: false, message: null });
  });
});
