import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";

// Review activity in the team's Slack channel: an owner picks the channel, new reviews,
// client feedback and mentions are posted there with each comment thread as its own
// Slack thread, and a teammate's reply in that Slack thread comes back into the review.

const TOKEN = "xoxb-1111-2222-good";
const SIGNING = "0123456789abcdef0123456789abcdef";
const CLIP = "https://files.example/opening_hello.mp4";

type Posted = {
  method: string;
  channel: string;
  text: string;
  thread_ts: string | null;
  ts: string;
  user: string | null;
};
let posted: Posted[] = [];
let joined: string[] = [];
let calls: string[] = [];
let slackUsers: Record<string, { email?: string; name: string }> = {};
let nextTs = 1_700_000_000;

beforeEach(() => {
  process.env.CONNECTIONS_SECRET = "a-connections-secret-of-at-least-32-chars";
  process.env.SLACK_API_URL = "https://slack.test/api/";
  posted = [];
  joined = [];
  calls = [];
  slackUsers = {};
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const method = String(input).replace("https://slack.test/api/", "");
    const params = new URLSearchParams(String(init?.body ?? ""));
    calls.push(method);
    switch (method) {
      case "auth.test":
        return Response.json({ ok: true, team_id: "T0SALT", team: "Salt House", user_id: "U0BOT" });
      case "conversations.list":
        return Response.json({
          ok: true,
          channels: [
            { id: "C0VIDEO", name: "video-team", is_private: false },
            { id: "G0CLIENT", name: "client-x", is_private: true },
          ],
          response_metadata: { next_cursor: "" },
        });
      case "conversations.join":
        joined.push(params.get("channel") ?? "");
        return Response.json({ ok: true });
      case "chat.postMessage":
      case "chat.postEphemeral": {
        const ts = `${++nextTs}.000100`;
        posted.push({
          method,
          channel: params.get("channel") ?? "",
          text: params.get("text") ?? "",
          thread_ts: params.get("thread_ts"),
          user: params.get("user"),
          ts,
        });
        return Response.json({ ok: true, ts });
      }
      case "users.lookupByEmail": {
        const found = Object.entries(slackUsers).find(
          ([, user]) => user.email === params.get("email"),
        );
        return Response.json(
          found ? { ok: true, user: { id: found[0] } } : { ok: false, error: "users_not_found" },
        );
      }
      case "users.info": {
        const user = slackUsers[params.get("user") ?? ""];
        return Response.json(
          user
            ? {
                ok: true,
                user: {
                  id: params.get("user"),
                  is_bot: false,
                  profile: { ...user, display_name: user.name },
                },
              }
            : { ok: false, error: "user_not_found" },
        );
      }
      default:
        return Response.json({ ok: false, error: "unknown_method" });
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CONNECTIONS_SECRET;
  delete process.env.SLACK_API_URL;
});

async function settled(t: ReturnType<typeof backend>) {
  vi.useFakeTimers();
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
}

async function setUp({ channel = true } = {}) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const jordan = await addPerson(t, "Jordan Lee", [team], "owner");
  const dev = await addPerson(t, "Dev Patel", [team], "member");
  slackUsers = {
    U0JORDAN: { email: "jordan.lee@example.test", name: "Jordan" },
    U0DEV: { email: "dev.patel@example.test", name: "Dev" },
    U0SAM: { email: "sam@elsewhere.test", name: "Sam" },
  };
  await jordan.as.action(api.slack.connect, {
    organizationId: team,
    botToken: TOKEN,
    signingSecret: SIGNING,
  });
  if (channel) {
    await jordan.as.action(api.slackReview.setAlertChannel, {
      organizationId: team,
      channelId: "C0VIDEO",
    });
  }
  posted = [];
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

/** Sends a Slack event to the dashboard the way Slack does: signed with the app's secret. */
async function slackEvent(
  t: ReturnType<typeof backend>,
  event: Record<string, unknown>,
  secret = SIGNING,
) {
  const body = JSON.stringify({ type: "event_callback", team_id: "T0SALT", event });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  return await t.fetch("/slack/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body,
  });
}

describe("picking the channel review activity goes to", () => {
  test("an owner picks a public channel, the app joins it, and everyone sees where it goes", async () => {
    const { team, jordan, dev } = await setUp({ channel: false });
    const offered = await jordan.as.action(api.slackReview.channels, { organizationId: team });
    expect(offered).toEqual([
      { id: "G0CLIENT", name: "client-x", private: true },
      { id: "C0VIDEO", name: "video-team", private: false },
    ]);
    expect(
      await jordan.as.action(api.slackReview.setAlertChannel, {
        organizationId: team,
        channelId: "C0VIDEO",
      }),
    ).toEqual({ ok: true });
    expect(joined).toEqual(["C0VIDEO"]);
    expect(await dev.as.query(api.slack.forTeam, { organizationId: team })).toMatchObject({
      alertChannel: { id: "C0VIDEO", name: "video-team" },
    });
  });

  test("a member cannot pick it, a private channel is not joined, and an unknown one is refused", async () => {
    const { team, jordan, dev } = await setUp({ channel: false });
    await expect(
      dev.as.action(api.slackReview.setAlertChannel, {
        organizationId: team,
        channelId: "C0VIDEO",
      }),
    ).rejects.toThrow(/owner or admin/);
    await expect(dev.as.action(api.slackReview.channels, { organizationId: team })).rejects.toThrow(
      /owner or admin/,
    );
    expect(
      await jordan.as.action(api.slackReview.setAlertChannel, {
        organizationId: team,
        channelId: "G0CLIENT",
      }),
    ).toEqual({ ok: true });
    expect(joined).toEqual([]);
    expect(
      await jordan.as.action(api.slackReview.setAlertChannel, {
        organizationId: team,
        channelId: "C0GONE",
      }),
    ).toMatchObject({ ok: false, detail: expect.stringMatching(/did not list that channel/) });
  });

  test("with no channel, nothing about reviews goes to a channel; the person mentioned still gets their own alert", async () => {
    const setup = await setUp();
    await setup.jordan.as.action(api.slackReview.setAlertChannel, {
      organizationId: setup.team,
      channelId: null,
    });
    const { clipId } = await openRoom(setup);
    await setup.jordan.as.mutation(api.reviews.comment, {
      clipId,
      body: "@Dev Patel can you look?",
      time: 2,
      version: 1,
    });
    await settled(setup.t);
    // Dev's own mention alert comes as a direct message (Settings, Notifications).
    expect(posted.map((one) => [one.channel, one.text])).toEqual([
      ["U0DEV", "Jordan Lee mentioned you in Weekly clips"],
    ]);
  });
});

describe("what the channel hears", () => {
  test("a new review, then a client's comment as its own thread, with what follows in that thread", async () => {
    const setup = await setUp();
    const { t, jordan } = setup;
    const { reviewId, clipId } = await openRoom(setup);
    await settled(t);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ channel: "C0VIDEO", thread_ts: null });
    expect(posted[0].text).toBe(
      `New review: <http://localhost:3000/review/${reviewId}|Weekly clips> (1 clip), opened by Jordan Lee.`,
    );

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
      body: "Can the end card stay up longer?",
      time: 62,
      version: 1,
    });
    await settled(t);
    const thread = posted[1];
    expect(thread.thread_ts).toBeNull();
    expect(thread.text).toBe(
      `*Riley* (client) commented on <http://localhost:3000/review/${reviewId}?clip=${clipId}&comment=${rootId}|Weekly clips>, Opening hello at 1:02:\n> Can the end card stay up longer?`,
    );

    // A teammate's reply in the room, and the client's next one, follow in that thread.
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
    expect(posted.slice(2).map((one) => [one.thread_ts, one.text])).toEqual([
      [thread.ts, "*Jordan Lee*: Sure, two more seconds."],
      [thread.ts, "*Riley* (client): Thanks!"],
    ]);

    // The client's verdict is news of its own.
    await t.mutation(api.sharedReview.verdict, {
      token,
      guestId: "riley-browser-0001",
      name: "Riley",
      approved: true,
    });
    await settled(t);
    expect(posted.at(-1)).toMatchObject({ thread_ts: null });
    expect(posted.at(-1)?.text).toMatch(
      /^\*Riley\* \(client\) on <.*\|Weekly clips>: Approved the review\.$/,
    );
  });

  test("a mention tags the person in Slack; a teammate's own comment with nobody named stays in the room", async () => {
    const setup = await setUp();
    const { t, jordan } = setup;
    const { clipId } = await openRoom(setup);
    await settled(t);
    posted = [];
    await jordan.as.mutation(api.reviews.comment, {
      clipId,
      body: "Note to self: check the music",
      time: 3,
      version: 1,
    });
    await jordan.as.mutation(api.reviews.comment, {
      clipId,
      body: "@Dev Patel is the logo too small?",
      time: 4,
      version: 1,
    });
    await settled(t);
    // Leave out Dev's own mention alert, a direct message (alerts in Slack).
    posted = posted.filter((one) => one.channel !== "U0DEV");
    expect(posted).toHaveLength(1);
    expect(posted[0].text).toMatch(
      /^\*Jordan Lee\* mentioned <@U0DEV> on <.*\|Weekly clips>, Opening hello at 0:04:\n> @Dev Patel is the logo too small\?$/,
    );
  });

  test("a client's words cannot add Slack markup", async () => {
    const setup = await setUp();
    const { t, jordan } = setup;
    const { reviewId, clipId } = await openRoom(setup);
    const token = await jordan.as.mutation(api.reviewShares.set, {
      reviewId,
      allowVerdict: false,
      showTeamComments: false,
    });
    await t.mutation(api.sharedReview.comment, {
      token,
      guestId: "riley-browser-0001",
      name: "<!channel>",
      clipId,
      body: "<!here> <https://evil.test|click>",
      time: 1,
      version: 1,
    });
    await settled(t);
    const text = posted.at(-1)?.text ?? "";
    expect(text).not.toContain("<!");
    expect(text).not.toContain("<https://evil");
    expect(text).toContain("&lt;!here&gt;");
  });
});

describe("replies written in Slack", () => {
  async function threadInSlack() {
    const setup = await setUp();
    const { t, jordan } = setup;
    const { reviewId, clipId } = await openRoom(setup);
    const token = await jordan.as.mutation(api.reviewShares.set, {
      reviewId,
      allowVerdict: false,
      showTeamComments: false,
    });
    const rootId = await t.mutation(api.sharedReview.comment, {
      token,
      guestId: "riley-browser-0001",
      name: "Riley",
      clipId,
      body: "Can the end card stay up longer?",
      time: 62,
      version: 1,
    });
    await settled(t);
    // The review's own "opened" post is sent too, and the two can go out in either order.
    const threadTs = posted.find((one) =>
      one.text.includes("Can the end card stay up longer?"),
    )!.ts;
    return { ...setup, clipId, rootId, threadTs, token };
  }

  test("a teammate's reply comes into the review thread as theirs, once, and is not posted back", async () => {
    const { t, jordan, clipId, rootId, threadTs, token } = await threadInSlack();
    const before = posted.length;
    const reply = {
      type: "message",
      user: "U0DEV",
      text: "On it <@U0JORDAN>, adding <https://example.test/a.png|a still> &amp; more",
      ts: "1800000000.000100",
      thread_ts: threadTs,
      channel: "C0VIDEO",
    };
    expect((await slackEvent(t, reply)).status).toBe(200);
    // Slack sends it again when an answer is slow.
    expect((await slackEvent(t, reply)).status).toBe(200);
    await settled(t);

    const comments = await jordan.as.query(api.reviews.comments, { clipId });
    const replies = comments.filter((one) => one.parentId === rootId);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      authorName: "Dev Patel",
      body: "On it @Jordan, adding a still (https://example.test/a.png) & more",
      time: 62,
    });
    expect(posted.slice(before).filter((one) => one.method === "chat.postMessage")).toEqual([]);

    // The client sees the team's reply in their own thread, as with any reply.
    const seen = await t.query(api.sharedReview.comments, {
      token,
      clipId,
      guestId: "riley-browser-0001",
    });
    expect(seen.map((one) => one.body)).toContain(replies[0].body);
  });

  test("someone not on the team is told their reply stays in Slack", async () => {
    const { t, jordan, clipId, rootId, threadTs } = await threadInSlack();
    const before = posted.length;
    await slackEvent(t, {
      type: "message",
      user: "U0SAM",
      text: "Looks fine to me",
      ts: "1800000000.000200",
      thread_ts: threadTs,
      channel: "C0VIDEO",
    });
    const comments = await jordan.as.query(api.reviews.comments, { clipId });
    expect(comments.filter((one) => one.parentId === rootId)).toEqual([]);
    // Found among what was posted since the reply, not as the very last post: a message the
    // room setting up scheduled can still land after it on a slow machine.
    const told = posted.slice(before).find((one) => one.method === "chat.postEphemeral");
    expect(told).toMatchObject({ user: "U0SAM", thread_ts: threadTs });
    expect(told?.text).toMatch(/sam@elsewhere.test is not on the team/);
  });

  test("a forged event, a bot's message and a reply in some other thread change nothing", async () => {
    const { t, jordan, clipId, rootId, threadTs } = await threadInSlack();
    const forged = await slackEvent(
      t,
      {
        type: "message",
        user: "U0DEV",
        text: "Delete it",
        ts: "1800000000.0003",
        thread_ts: threadTs,
        channel: "C0VIDEO",
      },
      "f".repeat(32),
    );
    expect(forged.status).toBe(401);
    await slackEvent(t, {
      type: "message",
      bot_id: "B0OTHER",
      user: "U0DEV",
      text: "A bot",
      ts: "1800000000.000400",
      thread_ts: threadTs,
      channel: "C0VIDEO",
    });
    await slackEvent(t, {
      type: "message",
      user: "U0DEV",
      text: "Elsewhere",
      ts: "1800000000.000500",
      thread_ts: "1699999999.000100",
      channel: "C0VIDEO",
    });
    const comments = await jordan.as.query(api.reviews.comments, { clipId });
    expect(comments.filter((one) => one.parentId === rootId)).toEqual([]);
  });
});
