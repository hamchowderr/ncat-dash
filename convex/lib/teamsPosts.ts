import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { ReviewPost } from "./slackPosts";

/**
 * Posts review activity to the team's Microsoft Teams channel, when the team picked one
 * in Settings. Each comment thread becomes a reply thread in that channel. As in Slack, a
 * teammate's plain reply is only posted into a thread that is already in Teams.
 * Posting is an action of its own, so Teams being slow or down never touches the review.
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
    if (!thread) return;
  }
  await ctx.scheduler.runAfter(0, internal.microsoftTeamsReview.post, { organizationId, post });
}
