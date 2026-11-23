import type { MutationCtx } from "../_generated/server";
import { queueReviewPost, threadOnItsWay } from "./reviewChatQueue";
import type { ReviewPost } from "./reviewPost";

/**
 * Posts review activity to the team's Discord channel, when the team picked one. Like
 * Slack, a teammate's plain reply only goes into a thread that is already in Discord.
 * Posting is an action of its own, sent in order after the team's earlier posts, so Discord being slow or down never touches the review.
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
    if (!thread && !(await threadOnItsWay(ctx, "discord", post.commentId))) return;
  }
  await queueReviewPost(ctx, "discord", organizationId, post);
}
