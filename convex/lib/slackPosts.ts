import { type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { toTelegram } from "./telegramPosts";

/**
 * What happened in a review that the team's Slack channel hears about. A comment's
 * `commentId` is always the first comment of its thread, which is what a Slack thread
 * stands for.
 */
export const reviewPostValidator = v.union(
  v.object({ kind: v.literal("review_opened"), reviewId: v.id("reviews") }),
  v.object({
    kind: v.literal("client_feedback"),
    reviewId: v.id("reviews"),
    commentId: v.optional(v.id("reviewComments")),
    from: v.string(),
    body: v.string(),
  }),
  v.object({
    kind: v.literal("mention"),
    reviewId: v.id("reviews"),
    commentId: v.id("reviewComments"),
    from: v.string(),
    body: v.string(),
    mentioned: v.array(v.string()),
  }),
  v.object({
    kind: v.literal("team_reply"),
    reviewId: v.id("reviews"),
    commentId: v.id("reviewComments"),
    from: v.string(),
    body: v.string(),
  }),
);

export type ReviewPost = Infer<typeof reviewPostValidator>;

/**
 * Posts review activity to the team's Slack channel, when the team has picked one.
 * A teammate's plain reply is only posted into a thread that is already in Slack, so the
 * channel carries what the team asked for and the conversations that started there.
 * Posting is an action of its own, so Slack being slow or down never touches the review.
 */
export async function toSlack(
  ctx: MutationCtx,
  organizationId: string,
  post: ReviewPost,
): Promise<void> {
  // The team's Telegram group hears the same news.
  await toTelegram(ctx, organizationId, post);
  const connection = await ctx.db
    .query("slackConnections")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .unique();
  if (!connection?.alertChannelId) return;
  if (post.kind === "team_reply") {
    const thread = await ctx.db
      .query("slackThreads")
      .withIndex("by_comment", (q) => q.eq("commentId", post.commentId))
      .first();
    if (!thread) return;
  }
  await ctx.scheduler.runAfter(0, internal.slackReview.post, { organizationId, post });
}
