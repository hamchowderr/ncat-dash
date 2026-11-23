import type { ActionChannelHandler } from "@mastra/core/channels";
import { env } from "../../lib/env";
import { convexSiteUrl, dashboardSecret, signForDashboard } from "./dashboard-site";

/**
 * Approve and Send back on an alert the dashboard sent someone in Discord. Discord only
 * delivers button presses over the Gateway this server keeps open, so the press lands
 * here and is handed straight to the dashboard, which checks who pressed it and decides
 * the approval as them. Slack presses go to the dashboard directly; Telegram has its own.
 *
 * Every other button (the agent's own tool approvals) goes on to the default handler.
 */

/** Our alert buttons' action ids. Kept in step with convex/lib/chatAlerts/chatFormats.ts. */
const PREFIX = "ncat_alert_";

export type PressAnswer = { ok: boolean; message: string };

type Ask = (body: Record<string, string>) => Promise<PressAnswer | null>;

const askDashboard: Ask = async (body) => {
  const site = convexSiteUrl();
  const secret = dashboardSecret();
  if (!site || !secret) return null;
  try {
    const response = await fetch(`${site}/discord/alert-action`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${signForDashboard(secret)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`The dashboard answered ${response.status}`);
    return (await response.json()) as PressAnswer;
  } catch (error) {
    console.error("[alerts] could not reach the dashboard", error);
    return null;
  }
};

let ask: Ask = askDashboard;

/** For tests: answer the dashboard's side without a deployment. Pass nothing to undo. */
export function useDashboardForTests(answer?: Ask): void {
  ask = answer ?? askDashboard;
}

export const onAlertButton: ActionChannelHandler = async (event, defaultHandler) => {
  const decision = event.actionId.startsWith(PREFIX) ? event.actionId.slice(PREFIX.length) : null;
  if (!decision || !event.threadId.startsWith("discord:")) {
    await defaultHandler();
    return;
  }
  if (event.user.isBot || !event.value) return;
  const answer = await ask({
    runStepId: event.value,
    discordUserId: event.user.userId,
    decision,
  });
  // When it worked the dashboard edits the message itself to say so.
  if (answer?.ok) return;
  await event.thread?.post(
    answer?.message ?? "I can't reach the dashboard right now. Try again in a minute.",
  );
};
