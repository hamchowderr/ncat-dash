import { internal } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { ReviewPost } from "./slackPosts";
import { telegramReady } from "./chatAlerts/telegram";

/** The team's Telegram group that hears review activity, if it picked one. */
export async function reviewGroupOf(ctx: QueryCtx, organizationId: string) {
  const groups = await ctx.db
    .query("telegramGroups")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(20);
  return groups.find((group) => group.reviews) ?? null;
}

/**
 * Posts review activity to the team's Telegram group, when it picked one: the same news
 * its Slack channel gets. A teammate's plain reply only goes into a conversation that is
 * already in Telegram. Posting is an action of its own, so Telegram being slow or down
 * never touches the review.
 */
export async function toTelegram(
  ctx: MutationCtx,
  organizationId: string,
  post: ReviewPost,
): Promise<void> {
  if (!telegramReady()) return;
  const group = await reviewGroupOf(ctx, organizationId);
  if (!group) return;
  if (post.kind === "team_reply") {
    const thread = await ctx.db
      .query("telegramReviewPosts")
      .withIndex("by_comment", (q) => q.eq("commentId", post.commentId))
      .first();
    if (!thread || thread.chatId !== group.chatId) return;
  }
  await ctx.scheduler.runAfter(0, internal.telegramReview.post, { organizationId, post });
}
