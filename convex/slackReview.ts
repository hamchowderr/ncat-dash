import { formatMoment } from "@ncat-dash/review-core";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { MANAGER_ROLES, requireMember } from "./lib/authz";
import { decryptSecret } from "./lib/crypto";
import {
  channelsOf,
  emailOf,
  joinChannel,
  nameOf,
  plainFromSlack,
  postMessage,
  postEphemeral,
  type SlackChannel,
  slackEscape,
  slackUserByEmail,
} from "./lib/slackApi";
import { type ReviewPost, reviewPostValidator } from "./lib/slackPosts";

// Review activity in the team's Slack channel, and replies written there coming back.
// New reviews, client feedback and mentions are posted to the channel the team picked in
// Settings. Each comment thread gets its own Slack thread, and a teammate's reply in that
// Slack thread becomes their reply in the review room.

/** Slack refuses requests older than this, and so do we. */
const TOLERANCE_S = 5 * 60;

const outcome = v.union(
  v.object({ ok: v.literal(true) }),
  v.object({ ok: v.literal(false), detail: v.string() }),
);

export const connectionFor = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    return await ctx.db
      .query("slackConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .unique();
  },
});

/** The channels Settings offers for review alerts. Owners and admins only. */
export const channels = action({
  args: { organizationId: v.string() },
  handler: async (ctx, args): Promise<SlackChannel[] | null> => {
    const connection: Doc<"slackConnections"> | null = await ctx.runQuery(
      internal.slackReview.connectionFor,
      args,
    );
    if (!connection) return null;
    return await channelsOf(await decryptSecret(connection.botTokenCipher));
  },
});

/** Picks the channel review activity goes to, or none. Owners and admins only. */
export const setAlertChannel = action({
  args: { organizationId: v.string(), channelId: v.union(v.null(), v.string()) },
  returns: outcome,
  handler: async (ctx, args) => {
    const connection: Doc<"slackConnections"> | null = await ctx.runQuery(
      internal.slackReview.connectionFor,
      { organizationId: args.organizationId },
    );
    if (!connection) {
      return { ok: false as const, detail: "Connect Slack first." };
    }
    if (args.channelId === null) {
      await ctx.runMutation(internal.slackReview.saveAlertChannel, {
        connectionId: connection._id,
        channel: null,
      });
      return { ok: true as const };
    }
    const token = await decryptSecret(connection.botTokenCipher);
    const channel = (await channelsOf(token))?.find((one) => one.id === args.channelId);
    if (!channel) {
      return {
        ok: false as const,
        detail:
          "Slack did not list that channel. For a private channel, invite the app to it in Slack first.",
      };
    }
    // The app must be in the channel to see the replies people write there.
    if (!channel.private && !(await joinChannel(token, channel.id))) {
      return {
        ok: false as const,
        detail: `The app could not join #${channel.name}. Invite it to the channel in Slack, then pick it again.`,
      };
    }
    await ctx.runMutation(internal.slackReview.saveAlertChannel, {
      connectionId: connection._id,
      channel: { id: channel.id, name: channel.name },
    });
    return { ok: true as const };
  },
});

export const saveAlertChannel = internalMutation({
  args: {
    connectionId: v.id("slackConnections"),
    channel: v.union(v.null(), v.object({ id: v.string(), name: v.string() })),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.connectionId, {
      alertChannelId: args.channel?.id,
      alertChannelName: args.channel?.name,
    });
  },
});

/** Everything a post needs, read in one go. */
export const postContext = internalQuery({
  args: { organizationId: v.string(), post: reviewPostValidator },
  handler: async (ctx, { organizationId, post }) => {
    const connection = await ctx.db
      .query("slackConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .unique();
    const review = await ctx.db.get(post.reviewId);
    if (!connection?.alertChannelId || !review) return null;
    const commentId = "commentId" in post ? post.commentId : undefined;
    const comment = commentId ? await ctx.db.get(commentId) : null;
    const clip = comment ? await ctx.db.get(comment.clipId) : null;
    const thread = commentId
      ? await ctx.db
          .query("slackThreads")
          .withIndex("by_comment", (q) => q.eq("commentId", commentId))
          .first()
      : null;
    const clips = await ctx.db
      .query("reviewClips")
      .withIndex("by_review", (q) => q.eq("reviewId", review._id))
      .take(51);
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId,
    });
    const nameOfMember = (userId: string | null) =>
      team.members.find((member) => member.userId === userId)?.name ?? null;
    return {
      slackTeamId: connection.slackTeamId,
      channelId: connection.alertChannelId,
      tokenCipher: connection.botTokenCipher,
      reviewTitle: review.title,
      fromAutomation: Boolean(review.runId),
      openedBy: nameOfMember(review.createdBy),
      clipCount: clips.length,
      clipId: comment?.clipId ?? null,
      clipTitle: clip?.title ?? null,
      time: comment?.time ?? null,
      threadTs: thread?.threadTs ?? null,
      mentionedEmails:
        post.kind === "mention"
          ? team.members
              .filter((member) => post.mentioned.includes(member.userId))
              .map((member) => ({ name: member.name, email: member.email }))
          : [],
    };
  },
});

function siteUrl(path: string): string {
  return `${(process.env.SITE_URL ?? "").replace(/\/+$/, "")}${path}`;
}

/** Quotes a comment the way Slack shows a quote: every line starts with "> ". */
function quoted(body: string): string {
  return slackEscape(body)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/** The words of a post. Exported for the tests. */
export function postText(
  post: ReviewPost,
  context: {
    reviewTitle: string;
    fromAutomation: boolean;
    openedBy: string | null;
    clipCount: number;
    clipId: string | null;
    clipTitle: string | null;
    time: number | null;
    threadTs: string | null;
  },
  tags: string[],
): string {
  const query = new URLSearchParams();
  if (context.clipId) query.set("clip", context.clipId);
  if ("commentId" in post && post.commentId) query.set("comment", post.commentId);
  const tail = query.toString();
  const link = `<${siteUrl(`/review/${post.reviewId}${tail ? `?${tail}` : ""}`)}|${slackEscape(
    context.reviewTitle,
  )}>`;
  const where =
    context.time === null
      ? link
      : `${link}, ${slackEscape(context.clipTitle ?? "a clip")} at ${formatMoment(context.time)}`;
  const tagged = tags.length > 0 ? `${tags.join(" ")} ` : "";

  switch (post.kind) {
    case "review_opened": {
      const clips = context.clipCount === 1 ? "1 clip" : `${context.clipCount} clips`;
      if (context.fromAutomation) {
        return `New review: ${link} (${clips}). The automation is waiting for someone to approve it.`;
      }
      return `New review: ${link} (${clips})${
        context.openedBy ? `, opened by ${slackEscape(context.openedBy)}` : ""
      }.`;
    }
    case "client_feedback":
      if (context.threadTs)
        return `*${slackEscape(post.from)}* (client): ${slackEscape(post.body)}`;
      return post.commentId
        ? `*${slackEscape(post.from)}* (client) commented on ${where}:\n${quoted(post.body)}`
        : `*${slackEscape(post.from)}* (client) on ${link}: ${slackEscape(post.body)}`;
    case "mention":
      if (context.threadTs)
        return `${tagged}*${slackEscape(post.from)}*: ${slackEscape(post.body)}`;
      return `*${slackEscape(post.from)}* mentioned ${
        tags.length > 0 ? tags.join(" ") : "someone"
      } on ${where}:\n${quoted(post.body)}`;
    case "team_reply":
      return `*${slackEscape(post.from)}*: ${slackEscape(post.body)}`;
  }
}

/** Posts one piece of review activity to the team's channel. */
export const post = internalAction({
  args: { organizationId: v.string(), post: reviewPostValidator },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.slackReview.postContext, args);
    if (!context) return;
    const token = await decryptSecret(context.tokenCipher);
    const tags: string[] = [];
    for (const person of context.mentionedEmails) {
      const slackUser = await slackUserByEmail(token, person.email);
      tags.push(slackUser ? `<@${slackUser}>` : `@${slackEscape(person.name)}`);
    }
    const ts = await postMessage(token, {
      channel: context.channelId,
      text: postText(args.post, context, tags),
      threadTs: context.threadTs ?? undefined,
    });
    const commentId = "commentId" in args.post ? args.post.commentId : undefined;
    if (ts && commentId && !context.threadTs) {
      await ctx.runMutation(internal.slackReview.rememberThread, {
        organizationId: args.organizationId,
        slackTeamId: context.slackTeamId,
        channelId: context.channelId,
        threadTs: ts,
        reviewId: args.post.reviewId,
        commentId,
      });
    }
  },
});

export const rememberThread = internalMutation({
  args: {
    organizationId: v.string(),
    slackTeamId: v.string(),
    channelId: v.string(),
    threadTs: v.string(),
    reviewId: v.id("reviews"),
    commentId: v.id("reviewComments"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("slackThreads")
      .withIndex("by_comment", (q) => q.eq("commentId", args.commentId))
      .first();
    if (!existing) await ctx.db.insert("slackThreads", args);
  },
});

export const threadFor = internalQuery({
  args: { slackTeamId: v.string(), channelId: v.string(), threadTs: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("slackThreads")
      .withIndex("by_slack_thread", (q) =>
        q
          .eq("slackTeamId", args.slackTeamId)
          .eq("channelId", args.channelId)
          .eq("threadTs", args.threadTs),
      )
      .first();
  },
});

async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

type SlackMessageEvent = {
  type?: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  channel?: string;
};

/**
 * A Slack event the dashboard was sent: checked with the workspace's own signing secret,
 * and when it is a teammate's reply in a review thread, written into the review.
 * Returns the HTTP status to answer Slack with.
 */
export const takeEvent = internalAction({
  args: { body: v.string(), timestamp: v.string(), signature: v.string(), now: v.number() },
  handler: async (ctx, args): Promise<number> => {
    let parsed: { type?: string; team_id?: string; event?: SlackMessageEvent };
    try {
      parsed = JSON.parse(args.body);
    } catch {
      return 400;
    }
    if (parsed.type !== "event_callback" || typeof parsed.team_id !== "string") return 200;
    const connection: Doc<"slackConnections"> | null = await ctx.runQuery(
      internal.slack.bySlackTeam,
      { slackTeamId: parsed.team_id },
    );
    if (!connection) return 404;
    const seconds = Number(args.timestamp);
    if (!Number.isFinite(seconds) || Math.abs(args.now / 1000 - seconds) > TOLERANCE_S) return 401;
    const secret = await decryptSecret(connection.signingSecretCipher);
    const expected = `v0=${await hmacHex(secret, `v0:${args.timestamp}:${args.body}`)}`;
    if (!sameText(expected, args.signature)) return 401;

    const event = parsed.event ?? {};
    if (
      event.type !== "message" ||
      event.subtype ||
      event.bot_id ||
      !event.user ||
      !event.channel ||
      !event.ts ||
      !event.thread_ts ||
      event.thread_ts === event.ts
    ) {
      return 200;
    }
    const thread: Doc<"slackThreads"> | null = await ctx.runQuery(internal.slackReview.threadFor, {
      slackTeamId: parsed.team_id,
      channelId: event.channel,
      threadTs: event.thread_ts,
    });
    if (!thread || thread.organizationId !== connection.organizationId) return 200;

    const token = await decryptSecret(connection.botTokenCipher);
    const email = await emailOf(token, event.user);
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: connection.organizationId,
    });
    const member = email ? team.members.find((one) => one.email.toLowerCase() === email) : null;
    if (!member) {
      await postEphemeral(token, {
        channel: event.channel,
        user: event.user,
        threadTs: event.thread_ts,
        text: email
          ? `Your reply stays in Slack: ${email} is not on the team in the dashboard, so it was not added to the review.`
          : "Your reply stays in Slack: the dashboard could not read your Slack email address, so it was not added to the review.",
      });
      return 200;
    }

    const names: Record<string, string> = {};
    for (const id of new Set([...(event.text ?? "").matchAll(/<@([A-Z0-9]+)/g)].map((m) => m[1]))) {
      if (id === connection.botUserId) continue;
      const name = await nameOf(token, id);
      if (name) names[id] = name;
    }
    const body = plainFromSlack(event.text ?? "", names);
    if (!body) return 200;
    await ctx.runMutation(internal.reviews.commentFromSlack, {
      commentId: thread.commentId,
      userId: member.userId,
      authorName: member.name,
      body,
      slackTeamId: parsed.team_id,
      channelId: event.channel,
      ts: event.ts,
    });
    return 200;
  },
});
