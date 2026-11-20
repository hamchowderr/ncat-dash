import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { ReviewPost } from "./slackPosts";

/**
 * Posts review activity to the team's Discord channel, when the team picked one. Like
 * Slack, a teammate's plain reply only goes into a thread that is already in Discord.
 * Posting is an action of its own, so Discord being slow or down never touches the review.
 */
export async function toDiscord(
  ctx: MutationCtx,
  organizationId: string,
  post: ReviewPost,
): Promise<void> {
  const servers = await ctx.db
    .query("discordServers")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(20);
  if (!servers.some((server) => server.alertChannelId)) return;
  if (post.kind === "team_reply") {
    const thread = await ctx.db
      .query("discordReviewThreads")
      .withIndex("by_comment", (q) => q.eq("commentId", post.commentId))
      .first();
    if (!thread) return;
  }
  await ctx.scheduler.runAfter(0, internal.discordReview.post, { organizationId, post });
}
