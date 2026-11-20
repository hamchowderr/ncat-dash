import { formatMoment } from "@ncat-dash/review-core";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { call, linkable } from "./lib/chatAlerts/telegram";
import { type ReviewPost, reviewPostValidator } from "./lib/slackPosts";
import { reviewGroupOf } from "./lib/telegramPosts";

// Review activity in the team's Telegram group, and replies written there coming back,
// the way the team's Slack channel works (convex/slackReview.ts). New reviews, client
// feedback and mentions are posted to the group the team picked in Settings. Every post
// about one comment thread replies to the first, and a linked teammate's Telegram reply
// to any of them becomes their reply in the review room.

function siteUrl(path: string): string {
  return `${(process.env.SITE_URL ?? "").replace(/\/+$/, "")}${path}`;
}

export const postContext = internalQuery({
  args: { organizationId: v.string(), post: reviewPostValidator },
  handler: async (ctx, { organizationId, post }) => {
    const group = await reviewGroupOf(ctx, organizationId);
    const review = await ctx.db.get(post.reviewId);
    if (!group || !review) return null;
    const commentId = "commentId" in post ? post.commentId : undefined;
    const comment = commentId ? await ctx.db.get(commentId) : null;
    const clip = comment ? await ctx.db.get(comment.clipId) : null;
    const thread = commentId
      ? await ctx.db
          .query("telegramReviewPosts")
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
    // Someone mentioned is tagged by their Telegram @name when they linked one.
    const tags: string[] = [];
    if (post.kind === "mention") {
      for (const userId of post.mentioned) {
        const linked = await ctx.db
          .query("telegramPeople")
          .withIndex("by_member", (q) =>
            q.eq("organizationId", organizationId).eq("userId", userId),
          )
          .unique();
        const name = nameOfMember(userId);
        if (linked?.username) tags.push(`@${linked.username}`);
        else if (name) tags.push(name);
      }
    }
    return {
      chatId: group.chatId,
      reviewTitle: review.title,
      fromAutomation: Boolean(review.runId),
      openedBy: nameOfMember(review.createdBy),
      clipCount: clips.length,
      clipId: comment?.clipId ?? null,
      clipTitle: clip?.title ?? null,
      time: comment?.time ?? null,
      replyTo: thread && thread.chatId === group.chatId ? thread.messageId : null,
      tags,
    };
  },
});

type PostContext = {
  reviewTitle: string;
  fromAutomation: boolean;
  openedBy: string | null;
  clipCount: number;
  clipId: string | null;
  clipTitle: string | null;
  time: number | null;
  replyTo: number | null;
  tags: string[];
};

/** Where a post points: the review, opened on the clip and comment it is about. */
export function postLink(post: ReviewPost, context: Pick<PostContext, "clipId">): string {
  const query = new URLSearchParams();
  if (context.clipId) query.set("clip", context.clipId);
  if ("commentId" in post && post.commentId) query.set("comment", post.commentId);
  const tail = query.toString();
  return siteUrl(`/review/${post.reviewId}${tail ? `?${tail}` : ""}`);
}

/**
 * Who a post speaks for: the teammate or client who wrote it, shown first and in bold the
 * way a chat app shows a person's name over their message. A new review is the
 * dashboard's own post, so it has none. Exported for the tests.
 */
export function postSpeaker(post: ReviewPost): string | null {
  switch (post.kind) {
    case "review_opened":
      return null;
    case "client_feedback":
      return `${post.from} (client)`;
    case "mention":
    case "team_reply":
      return post.from;
  }
}

/**
 * The words of a post. Telegram gets plain text (no parse mode), so a client's or a
 * teammate's words are shown exactly as written and can never add formatting or links.
 * Anything someone wrote starts with their name (`postSpeaker`), which `post` makes bold
 * by itself. Exported for the tests.
 */
export function postText(post: ReviewPost, context: PostContext): string {
  const title = `"${context.reviewTitle}"`;
  const where =
    context.time === null
      ? title
      : `${title}, ${context.clipTitle ?? "a clip"} at ${formatMoment(context.time)}`;
  const speaker = postSpeaker(post);
  switch (post.kind) {
    case "review_opened": {
      const clips = context.clipCount === 1 ? "1 clip" : `${context.clipCount} clips`;
      if (context.fromAutomation) {
        return `New review: ${title} (${clips}). The automation is waiting for someone to approve it.`;
      }
      return `New review: ${title} (${clips})${context.openedBy ? `, opened by ${context.openedBy}` : ""}.`;
    }
    case "client_feedback":
      if (context.replyTo !== null) return `${speaker}\n${post.body}`;
      return post.commentId
        ? `${speaker} commented on ${where}:\n\n${post.body}`
        : `${speaker} on ${title}:\n\n${post.body}`;
    case "mention": {
      const tagged = context.tags.length > 0 ? context.tags.join(" ") : "someone";
      if (context.replyTo !== null) return `${speaker}\nto ${tagged}: ${post.body}`;
      return `${speaker} mentioned ${tagged} on ${where}:\n\n${post.body}`;
    }
    case "team_reply":
      return `${speaker}\n${post.body}`;
  }
}

/** The bold name a post starts with, as a Telegram message entity (offsets in UTF-16). */
export function speakerEntities(post: ReviewPost, text: string) {
  const speaker = postSpeaker(post);
  if (!speaker || !text.startsWith(speaker)) return [];
  return [{ type: "bold", offset: 0, length: speaker.length }];
}

/** Posts one piece of review activity to the team's Telegram group. */
export const post = internalAction({
  args: { organizationId: v.string(), post: reviewPostValidator },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.telegramReview.postContext, args);
    if (!context) return;
    const link = postLink(args.post, context);
    let text = postText(args.post, context);
    // Telegram only opens web addresses it can reach as buttons; a local one goes in the text.
    const button = linkable(link) && context.replyTo === null;
    if (!linkable(link) && context.replyTo === null) text = `${text}\n\nOpen the review: ${link}`;
    let sent: { message_id?: number } | null = null;
    try {
      sent = (await call("sendMessage", {
        chat_id: context.chatId,
        text: text.slice(0, 4000),
        entities: speakerEntities(args.post, text.slice(0, 4000)),
        link_preview_options: { is_disabled: true },
        ...(context.replyTo !== null
          ? { reply_parameters: { message_id: context.replyTo, allow_sending_without_reply: true } }
          : {}),
        ...(button
          ? { reply_markup: { inline_keyboard: [[{ text: "Open the review", url: link }]] } }
          : {}),
      })) as { message_id?: number } | null;
    } catch (error) {
      console.warn("Could not post review activity to Telegram", error);
      return;
    }
    const commentId = "commentId" in args.post ? args.post.commentId : undefined;
    if (sent?.message_id && commentId) {
      await ctx.runMutation(internal.telegramReview.rememberPost, {
        organizationId: args.organizationId,
        chatId: context.chatId,
        messageId: sent.message_id,
        reviewId: args.post.reviewId,
        commentId,
      });
    }
  },
});

export const rememberPost = internalMutation({
  args: {
    organizationId: v.string(),
    chatId: v.string(),
    messageId: v.number(),
    reviewId: v.id("reviews"),
    commentId: v.id("reviewComments"),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("telegramReviewPosts", args);
  },
});

/**
 * A reply in a Telegram group to one of the bot's review posts. A linked teammate's
 * reply is written into the review room as theirs. Returns whether it was about a
 * review (so the agent leaves it alone) and anything to tell the person.
 */
export const reply = internalMutation({
  args: {
    chatId: v.string(),
    replyTo: v.number(),
    messageId: v.number(),
    telegramUserId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args): Promise<{ handled: boolean; message: string | null }> => {
    const thread = await ctx.db
      .query("telegramReviewPosts")
      .withIndex("by_message", (q) => q.eq("chatId", args.chatId).eq("messageId", args.replyTo))
      .first();
    if (!thread) return { handled: false, message: null };
    const group = await ctx.db
      .query("telegramGroups")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .unique();
    if (!group || group.organizationId !== thread.organizationId) {
      return { handled: true, message: null };
    }
    const seen = await ctx.db
      .query("telegramReviewReplies")
      .withIndex("by_message", (q) => q.eq("chatId", args.chatId).eq("messageId", args.messageId))
      .first();
    if (seen) return { handled: true, message: null };
    const person = await ctx.db
      .query("telegramPeople")
      .withIndex("by_telegram_user", (q) =>
        q.eq("telegramUserId", args.telegramUserId).eq("organizationId", thread.organizationId),
      )
      .unique();
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: thread.organizationId,
    });
    const member = person ? team.members.find((one) => one.userId === person.userId) : null;
    if (!member) {
      return {
        handled: true,
        message:
          "Your reply stays in Telegram: link your Telegram in the dashboard's Settings, then your replies here go into the review.",
      };
    }
    const body = args.text.trim();
    if (!body) return { handled: true, message: null };
    const id: Id<"reviewComments"> | null = await ctx.runMutation(
      internal.reviews.commentFromTelegram,
      {
        commentId: thread.commentId,
        userId: member.userId,
        authorName: member.name,
        body,
      },
    );
    if (id) {
      await ctx.db.insert("telegramReviewReplies", {
        chatId: args.chatId,
        messageId: args.messageId,
        commentId: id,
      });
      // The reply is part of this conversation in Telegram now, so later posts thread here too.
      await ctx.db.insert("telegramReviewPosts", {
        organizationId: thread.organizationId,
        chatId: args.chatId,
        messageId: args.messageId,
        reviewId: thread.reviewId,
        commentId: thread.commentId,
      });
    }
    return { handled: true, message: null };
  },
});
