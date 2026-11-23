import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { chatPool } from "./pools";
import type { ReviewPost } from "./reviewPost";

// Review activity goes to a team's chat apps in the order it happened. Each app's post is
// an action, and actions started together finish in any order, so a reply could reach the
// chat before the comment that starts its thread, and land outside that thread. Instead,
// each team's posts to one app wait in `reviewChatPosts` and are sent one at a time,
// oldest first: when one is done (sent, failed or crashed, the pool always says), the
// next is sent. Other teams and other apps are not held up.

export type ChatApp = Doc<"reviewChatPosts">["app"];

const senders = {
  slack: internal.slackReview.post,
  discord: internal.discordReview.post,
  teams: internal.microsoftTeamsReview.post,
  telegram: internal.telegramReview.post,
} as const;

async function send(ctx: MutationCtx, row: Doc<"reviewChatPosts">) {
  await chatPool.enqueueAction(
    ctx,
    senders[row.app],
    { organizationId: row.organizationId, post: row.post },
    { onComplete: internal.reviewChatPosts.sent, context: { postId: row._id } },
  );
}

async function oldest(ctx: QueryCtx, app: ChatApp, organizationId: string) {
  return await ctx.db
    .query("reviewChatPosts")
    .withIndex("by_app_organization", (q) => q.eq("app", app).eq("organizationId", organizationId))
    .first();
}

/** Queues a post to one of the team's chat apps; it is sent once the ones before it are. */
export async function queueReviewPost(
  ctx: MutationCtx,
  app: ChatApp,
  organizationId: string,
  post: ReviewPost,
): Promise<void> {
  const postId = await ctx.db.insert("reviewChatPosts", {
    app,
    organizationId,
    post,
    commentId: "commentId" in post ? post.commentId : undefined,
  });
  // Nothing ahead of it means nothing is being sent: start. Otherwise the post being
  // sent now starts the next when it is done.
  const first = await oldest(ctx, app, organizationId);
  if (first?._id === postId) await send(ctx, first);
}

/**
 * Whether a post for this comment thread is waiting to go to the app, so a reply written
 * before the thread has reached the chat still follows it there.
 */
export async function threadOnItsWay(
  ctx: QueryCtx,
  app: ChatApp,
  commentId: Id<"reviewComments">,
): Promise<boolean> {
  const waiting = await ctx.db
    .query("reviewChatPosts")
    .withIndex("by_app_comment", (q) => q.eq("app", app).eq("commentId", commentId))
    .first();
  return waiting !== null;
}

/** Called by the pool when a post is done, however it went: sends the team's next one. */
export async function postDone(ctx: MutationCtx, postId: Id<"reviewChatPosts">) {
  const row = await ctx.db.get(postId);
  if (!row) return;
  await ctx.db.delete(row._id);
  const next = await oldest(ctx, row.app, row.organizationId);
  if (next) await send(ctx, next);
}
