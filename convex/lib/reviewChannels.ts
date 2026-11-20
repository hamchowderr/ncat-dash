import type { MutationCtx } from "../_generated/server";
import { toDiscord } from "./discordPosts";
import { type ReviewPost, toSlack } from "./slackPosts";
import { toTeams } from "./teamsPosts";
import { toTelegram } from "./telegramPosts";

/** The chat apps a review comment can be written from, besides the review room. */
export type ReviewChannelApp = "slack" | "discord" | "teams" | "telegram";

/**
 * Review activity for every team chat channel the team picked: new reviews, client
 * feedback, mentions and replies. Each app posts in its own way (convex/lib/<app>Posts.ts)
 * and keeps a thread per comment thread. `except` is the app a reply was written in,
 * which already shows it.
 */
export async function toReviewChannels(
  ctx: MutationCtx,
  organizationId: string,
  post: ReviewPost,
  except?: ReviewChannelApp,
): Promise<void> {
  if (except !== "slack") await toSlack(ctx, organizationId, post);
  if (except !== "discord") await toDiscord(ctx, organizationId, post);
  if (except !== "teams") await toTeams(ctx, organizationId, post);
  if (except !== "telegram") await toTelegram(ctx, organizationId, post);
}
