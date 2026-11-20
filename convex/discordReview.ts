import { formatMoment } from "@ncat-dash/review-core";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { MANAGER_ROLES, requireMember } from "./lib/authz";
import {
  type DiscordChannel,
  discordBotReady,
  postToChannel,
  startThread,
  textChannelsOf,
} from "./lib/discordApi";
import { type ReviewPost, reviewPostValidator } from "./lib/slackPosts";

// Review activity in the team's Discord channel, and replies written there coming back,
// the same way Slack does it. New reviews, client feedback and mentions are posted to
// the channel the team picked in Settings. Each comment thread gets its own Discord
// thread, and a teammate's reply in that thread becomes their reply in the review room.
// Replies arrive over the agent server's Gateway connection (`/discord/review-reply`).

const outcome = v.union(
  v.object({ ok: v.literal(true) }),
  v.object({ ok: v.literal(false), detail: v.string() }),
);

export const serversFor = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    return await ctx.db
      .query("discordServers")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(20);
  },
});

export type ReviewChannelChoice = DiscordChannel & { guildId: string; guildName: string };

/** The channels Settings offers for review activity, across the team's servers. */
export const channels = action({
  args: { organizationId: v.string() },
  handler: async (ctx, args): Promise<ReviewChannelChoice[] | null> => {
    const servers: Doc<"discordServers">[] = await ctx.runQuery(
      internal.discordReview.serversFor,
      args,
    );
    if (!discordBotReady()) return null;
    const found: ReviewChannelChoice[] = [];
    for (const server of servers) {
      const listed = await textChannelsOf(server.guildId);
      if (!listed) return null;
      for (const channel of listed) {
        found.push({ ...channel, guildId: server.guildId, guildName: server.guildName });
      }
    }
    return found;
  },
});

/** Picks the channel review activity goes to, or none. Owners and admins only. */
export const setAlertChannel = action({
  args: { organizationId: v.string(), channelId: v.union(v.null(), v.string()) },
  returns: outcome,
  handler: async (ctx, args) => {
    const servers: Doc<"discordServers">[] = await ctx.runQuery(internal.discordReview.serversFor, {
      organizationId: args.organizationId,
    });
    if (servers.length === 0) {
      return { ok: false as const, detail: "Add the agent to a Discord server first." };
    }
    if (args.channelId === null) {
      await ctx.runMutation(internal.discordReview.saveAlertChannel, {
        organizationId: args.organizationId,
        channel: null,
      });
      return { ok: true as const };
    }
    for (const server of servers) {
      const channel = (await textChannelsOf(server.guildId))?.find(
        (one) => one.id === args.channelId,
      );
      if (channel) {
        await ctx.runMutation(internal.discordReview.saveAlertChannel, {
          organizationId: args.organizationId,
          channel: { guildId: server.guildId, id: channel.id, name: channel.name },
        });
        return { ok: true as const };
      }
    }
    return {
      ok: false as const,
      detail:
        "Discord did not list that channel. Check the agent can see it in your server, then pick it again.",
    };
  },
});

export const saveAlertChannel = internalMutation({
  args: {
    organizationId: v.string(),
    channel: v.union(v.null(), v.object({ guildId: v.string(), id: v.string(), name: v.string() })),
  },
  handler: async (ctx, args) => {
    const servers = await ctx.db
      .query("discordServers")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(20);
    // One review channel per team, across all its servers.
    for (const server of servers) {
      const mine = args.channel?.guildId === server.guildId;
      await ctx.db.patch(server._id, {
        alertChannelId: mine ? args.channel!.id : undefined,
        alertChannelName: mine ? args.channel!.name : undefined,
      });
    }
  },
});

/** Everything a post needs, read in one go. */
export const postContext = internalQuery({
  args: { organizationId: v.string(), post: reviewPostValidator },
  handler: async (ctx, { organizationId, post }) => {
    const servers = await ctx.db
      .query("discordServers")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .take(20);
    const server = servers.find((one) => one.alertChannelId);
    const review = await ctx.db.get(post.reviewId);
    if (!server?.alertChannelId || !review) return null;
    const commentId = "commentId" in post ? post.commentId : undefined;
    const comment = commentId ? await ctx.db.get(commentId) : null;
    const clip = comment ? await ctx.db.get(comment.clipId) : null;
    const thread = commentId
      ? await ctx.db
          .query("discordReviewThreads")
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
    const mentioned =
      post.kind === "mention"
        ? await Promise.all(
            team.members
              .filter((member) => post.mentioned.includes(member.userId))
              .map(async (member) => {
                const link = await ctx.db
                  .query("discordPeople")
                  .withIndex("by_member", (q) =>
                    q.eq("organizationId", organizationId).eq("userId", member.userId),
                  )
                  .unique();
                return { name: member.name, discordUserId: link?.discordUserId ?? null };
              }),
          )
        : [];
    return {
      guildId: server.guildId,
      channelId: server.alertChannelId,
      reviewTitle: review.title,
      fromAutomation: Boolean(review.runId),
      openedBy: nameOfMember(review.createdBy),
      clipCount: clips.length,
      clipId: comment?.clipId ?? null,
      clipTitle: clip?.title ?? null,
      time: comment?.time ?? null,
      threadId: thread?.threadId ?? null,
      mentioned,
    };
  },
});

function siteUrl(path: string): string {
  return `${(process.env.SITE_URL ?? "").replace(/\/+$/, "")}${path}`;
}

/** Discord's markdown marks, escaped so someone's words never turn into formatting. */
function discordEscape(text: string): string {
  return text.replace(/([\\*_~`|>#[\]()-])/g, "\\$1").replace(/@/g, "@\u200b");
}

/** Quotes a comment the way Discord shows a quote: every line starts with "> ". */
function quoted(body: string): string {
  return discordEscape(body)
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
    threadId: string | null;
  },
  tags: string[],
): string {
  const query = new URLSearchParams();
  if (context.clipId) query.set("clip", context.clipId);
  if ("commentId" in post && post.commentId) query.set("comment", post.commentId);
  const tail = query.toString();
  const url = siteUrl(`/review/${post.reviewId}${tail ? `?${tail}` : ""}`);
  // Angle brackets keep Discord from adding a big preview of the dashboard.
  const link = `[${discordEscape(context.reviewTitle)}](<${url}>)`;
  const where =
    context.time === null
      ? link
      : `${link}, ${discordEscape(context.clipTitle ?? "a clip")} at ${formatMoment(context.time)}`;
  const tagged = tags.length > 0 ? `${tags.join(" ")} ` : "";
  const from = "from" in post ? `**${discordEscape(post.from)}**` : "";

  switch (post.kind) {
    case "review_opened": {
      const clips = context.clipCount === 1 ? "1 clip" : `${context.clipCount} clips`;
      if (context.fromAutomation) {
        return `New review: ${link} (${clips}). The automation is waiting for someone to approve it.`;
      }
      return `New review: ${link} (${clips})${
        context.openedBy ? `, opened by ${discordEscape(context.openedBy)}` : ""
      }.`;
    }
    case "client_feedback":
      if (context.threadId) return `${from} (client): ${discordEscape(post.body)}`;
      return post.commentId
        ? `${from} (client) commented on ${where}:\n${quoted(post.body)}`
        : `${from} (client) on ${link}: ${discordEscape(post.body)}`;
    case "mention":
      if (context.threadId) return `${tagged}${from}: ${discordEscape(post.body)}`;
      return `${from} mentioned ${tags.length > 0 ? tags.join(" ") : "someone"} on ${where}:\n${quoted(
        post.body,
      )}`;
    case "team_reply":
      return `${from}: ${discordEscape(post.body)}`;
  }
}

/** Posts one piece of review activity to the team's channel, or into its thread. */
export const post = internalAction({
  args: { organizationId: v.string(), post: reviewPostValidator },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.discordReview.postContext, args);
    if (!context || !discordBotReady()) return;
    const ping = context.mentioned.flatMap((one) => (one.discordUserId ? [one.discordUserId] : []));
    const tags = context.mentioned.map((one) =>
      one.discordUserId ? `<@${one.discordUserId}>` : `@${discordEscape(one.name)}`,
    );
    const text = postText(args.post, context, tags);
    if (context.threadId) {
      await postToChannel(context.threadId, text, ping);
      return;
    }
    const messageId = await postToChannel(context.channelId, text, ping);
    const commentId = "commentId" in args.post ? args.post.commentId : undefined;
    if (!messageId || !commentId) return;
    const name = context.clipTitle
      ? `${context.clipTitle}${context.time === null ? "" : ` at ${formatMoment(context.time)}`}`
      : context.reviewTitle;
    const threadId = await startThread(context.channelId, messageId, name);
    if (threadId) {
      await ctx.runMutation(internal.discordReview.rememberThread, {
        organizationId: args.organizationId,
        guildId: context.guildId,
        channelId: context.channelId,
        threadId,
        reviewId: args.post.reviewId,
        commentId,
      });
    }
  },
});

export const rememberThread = internalMutation({
  args: {
    organizationId: v.string(),
    guildId: v.string(),
    channelId: v.string(),
    threadId: v.string(),
    reviewId: v.id("reviews"),
    commentId: v.id("reviewComments"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("discordReviewThreads")
      .withIndex("by_comment", (q) => q.eq("commentId", args.commentId))
      .first();
    if (!existing) await ctx.db.insert("discordReviewThreads", args);
  },
});

export const replyContext = internalQuery({
  args: { threadId: v.string(), discordUserId: v.string() },
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("discordReviewThreads")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();
    if (!thread) return null;
    const link = await ctx.db
      .query("discordPeople")
      .withIndex("by_discord_user", (q) =>
        q.eq("discordUserId", args.discordUserId).eq("organizationId", thread.organizationId),
      )
      .unique();
    return { thread, userId: link?.userId ?? null };
  },
});

export type ReviewReply =
  { kind: "ignored" } | { kind: "added" } | { kind: "not_linked"; message: string };

/**
 * A message someone wrote in a Discord thread, handed over by the agent server. When the
 * thread is one of a review's and they linked their Discord on that team, it becomes
 * their reply in the review. Anything else is not the dashboard's and is left alone.
 */
export const takeReply = internalAction({
  args: {
    guildId: v.string(),
    threadId: v.string(),
    messageId: v.string(),
    discordUserId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args): Promise<ReviewReply> => {
    const found = await ctx.runQuery(internal.discordReview.replyContext, {
      threadId: args.threadId,
      discordUserId: args.discordUserId,
    });
    if (!found || found.thread.guildId !== args.guildId) return { kind: "ignored" };
    if (!found.userId) {
      return {
        kind: "not_linked",
        message:
          'Your reply stays in Discord: link your Discord in the dashboard\'s Settings ("Link my Discord") so replies here come into the review as yours.',
      };
    }
    const body = args.text.replace(/<@!?(\d+)>/g, "").trim();
    if (!body) return { kind: "ignored" };
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: found.thread.organizationId,
    });
    const member = team.members.find((one) => one.userId === found.userId);
    if (!member) return { kind: "ignored" };
    await ctx.runMutation(internal.reviews.commentFromDiscord, {
      commentId: found.thread.commentId,
      userId: member.userId,
      authorName: member.name,
      body,
      messageId: args.messageId,
    });
    return { kind: "added" };
  },
});
