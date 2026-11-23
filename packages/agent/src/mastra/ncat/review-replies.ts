import type { ChannelHandler } from "@mastra/core/channels";
import type { Message } from "chat";
import { env } from "../../lib/env";
import { convexSiteUrl, dashboardSecret, signForDashboard } from "./dashboard-site";

/**
 * Replies written in a review's Discord thread. The dashboard posts review activity to
 * the team's Discord channel and gives each comment thread its own Discord thread; a
 * teammate's reply there should land in the review room as theirs. Discord only sends
 * those messages over the Gateway this server keeps open, so each plain message in a
 * Discord thread is handed to the dashboard, which keeps only the ones in its threads.
 * The agent itself never answers these: it is only asked when someone tags it.
 */

export type ReplyAnswer =
  { kind: "ignored" } | { kind: "added" } | { kind: "not_linked"; message: string };

type Ask = (body: Record<string, string>) => Promise<ReplyAnswer | null>;

const askDashboard: Ask = async (body) => {
  const site = convexSiteUrl();
  const secret = dashboardSecret();
  if (!site || !secret) return null;
  try {
    const response = await fetch(`${site}/discord/review-reply`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${signForDashboard(secret)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`The dashboard answered ${response.status}`);
    return (await response.json()) as ReplyAnswer;
  } catch (error) {
    console.error("[discord] could not pass a thread reply to the dashboard", error);
    return null;
  }
};

let ask: Ask = askDashboard;

/** For tests: answer the dashboard's side without a deployment. Pass nothing to undo. */
export function useDashboardForTests(answer?: Ask): void {
  ask = answer ?? askDashboard;
}

/** The server and thread of a Chat SDK id `discord:{guild}:{channel}:{thread}`, if any. */
export function discordThreadOf(threadId: string): { guildId: string; threadId: string } | null {
  const [platform, guildId, , thread] = threadId.split(":");
  if (platform !== "discord" || !guildId || guildId === "@me" || !thread) return null;
  return { guildId, threadId: thread };
}

/** A message that neither tags the agent nor is in a thread it follows. */
export const onReviewReply: ChannelHandler = async (thread, message: Message) => {
  if (message.author.isBot || message.author.isMe) return;
  const where = discordThreadOf(thread.id);
  if (!where || !message.text?.trim()) return;
  const answer = await ask({
    guildId: where.guildId,
    threadId: where.threadId,
    messageId: message.id,
    discordUserId: message.author.userId,
    text: message.text,
  });
  if (answer?.kind === "not_linked") await thread.post(answer.message);
};
