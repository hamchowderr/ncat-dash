import type { MutationCtx } from "../_generated/server";
import { queueReviewPost, threadOnItsWay } from "./reviewChatQueue";
import type { ReviewPost } from "./reviewPost";

/**
 * Posts review activity to the team's Microsoft Teams channel, when the team picked one
 * in Settings. Each comment thread becomes a reply thread in that channel. As in Slack, a
 * teammate's plain reply is only posted into a thread that is already in Teams.
 * Posting is an action of its own, sent in order after the team's earlier posts, so Teams being slow or down never touches the review.
 */
export async function toTeams(
  ctx: MutationCtx,
  organizationId: string,
  post: ReviewPost,
): Promise<void> {
  const tenant = await ctx.db
    .query("teamsTenants")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .unique();
  if (!tenant?.alertConversationId || !tenant.alertServiceUrl) return;
  if (post.kind === "team_reply") {
    const thread = await ctx.db
      .query("teamsReviewThreads")
      .withIndex("by_comment", (q) => q.eq("commentId", post.commentId))
      .first();
    if (!thread && !(await threadOnItsWay(ctx, "teams", post.commentId))) return;
  }
  await queueReviewPost(ctx, "teams", organizationId, post);
}
