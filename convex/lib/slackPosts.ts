import type { MutationCtx } from "../_generated/server";
import { queueReviewPost, threadOnItsWay } from "./reviewChatQueue";
import type { ReviewPost } from "./reviewPost";

export { type ReviewPost, reviewPostValidator } from "./reviewPost";

/**
 * Posts review activity to the team's Slack channel, when the team has picked one.
 * A teammate's plain reply is only posted into a thread that is in Slack, or on its way, so the
 * channel carries what the team asked for and the conversations that started there.
 * Posting is an action of its own, so Slack being slow or down never touches the review,
 * and the team's posts go one at a time, in the order they happened (lib/reviewChatQueue.ts).
 */
export async function toSlack(
  ctx: MutationCtx,
  organizationId: string,
  post: ReviewPost,
): Promise<void> {
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
    if (!thread && !(await threadOnItsWay(ctx, "slack", post.commentId))) return;
  }
  await queueReviewPost(ctx, "slack", organizationId, post);
}
