import { createTeamsAdapter } from "@chat-adapter/teams";
import type { ActionChannelHandler, ChannelHandler } from "@mastra/core/channels";
import type { Message } from "chat";
import { env } from "../../lib/env";
import { LONG_CACHE_KEY } from "../lib/cost";
import { TURN_USER_KEY } from "../lib/turn-user";
import { rememberSession } from "./session-store";
import { convexSiteUrl, signForDashboard } from "./slack";
import { hearVoiceNotes } from "./voice-notes";

/**
 * The agent in Microsoft Teams, on the dashboard's ONE Teams bot (TEAMS_APP_ID,
 * TEAMS_APP_PASSWORD and, for a bot that serves one Microsoft organization,
 * TEAMS_APP_TENANT_ID). Teams posts each message to this server's Teams webhook, the
 * bot's messaging endpoint.
 *
 * A team links its Microsoft organization in Settings and uploads the dashboard's Teams
 * app. Teams says who wrote by their Microsoft account id; the dashboard finds them on the
 * team that linked that organization, and the agent acts as them, with their rights and
 * nothing more. Someone not linked gets a short answer saying how to link, and nothing else.
 */

export type TeamsPerson =
  | { ok: true; userId: string; name: string; organizationId: string; convexToken: string }
  | { ok: false; reason: "not_connected" | "not_linked" }
  | { ok: false; reason: "refused"; message: string };

type Ask = (body: Record<string, string>) => Promise<TeamsPerson | null>;

const askDashboard: Ask = async (body) => {
  const site = convexSiteUrl();
  const secret = env.MASTRA_JWT_SECRET;
  if (!site || !secret) return null;
  try {
    const response = await fetch(`${site}/teams/person`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${signForDashboard(secret)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`The dashboard answered ${response.status}`);
    return (await response.json()) as TeamsPerson;
  } catch (error) {
    console.error("[teams] could not reach the dashboard", error);
    return null;
  }
};

let ask: Ask = askDashboard;

/** For tests: answer the dashboard's side without a deployment. Pass nothing to undo. */
export function useDashboardForTests(answer?: Ask): void {
  ask = answer ?? askDashboard;
}

/** The parts of a Teams message the dashboard needs, from the activity Teams sent. */
type Activity = {
  serviceUrl?: string;
  from?: { aadObjectId?: string };
  conversation?: { tenantId?: string };
  channelData?: { tenant?: { id?: string }; team?: { id?: string; name?: string } };
};

/** What the dashboard is asked about a message: who wrote, in which organization and team. */
export function questionFor(raw: unknown): Record<string, string> | null {
  const activity = (raw ?? {}) as Activity;
  const tenantId = activity.conversation?.tenantId ?? activity.channelData?.tenant?.id;
  const aadObjectId = activity.from?.aadObjectId;
  if (!tenantId || !aadObjectId) return null;
  const team = activity.channelData?.team;
  return {
    tenantId,
    aadObjectId,
    ...(team?.id && activity.serviceUrl
      ? { teamId: team.id, teamName: team.name ?? "", serviceUrl: activity.serviceUrl }
      : {}),
  };
}

/** What someone the agent cannot help is told, where they wrote. */
export function refusalText(person: TeamsPerson | null): string {
  if (!person) return "I can't reach the dashboard right now. Try again in a minute.";
  if (person.ok) return "";
  switch (person.reason) {
    case "refused":
      return person.message;
    case "not_linked":
      return 'I only work for people on the team who linked their Microsoft account. Open Settings in the dashboard, go to Microsoft Teams, press "Link my Microsoft account", then write to me again.';
    default:
      return "Your Microsoft organization is not linked to a team in the dashboard. A team owner can link it in Settings under Microsoft Teams.";
  }
}

/**
 * Before the agent answers a Teams message: find who wrote it on the team, and let the
 * run act as them. Like Slack, the Mastra thread belongs to `channel:<thread id>`.
 */
export const asTheTeamsWriter: ChannelHandler = async (thread, message: Message, next, ctx) => {
  if (message.author.isBot || message.author.isMe) return;
  const question = questionFor(message.raw);
  const person = question ? await ask(question) : null;
  if (!person?.ok) {
    await thread.post(refusalText(person));
    return;
  }
  const resourceId = `channel:${thread.id}`;
  rememberSession(resourceId, {
    convexToken: person.convexToken,
    organizationId: person.organizationId,
    automationId: null,
  });
  ctx.requestContext.set(TURN_USER_KEY, resourceId);
  // Chat-app messages come minutes apart: keep the prompt cached an hour (lib/cost.ts).
  ctx.requestContext.set(LONG_CACHE_KEY, true);
  await hearVoiceNotes(thread, message, person.organizationId);
  await next(thread, message);
};

/** Whether this server has the dashboard's Teams bot set up. */
export function teamsReady(): boolean {
  return Boolean(
    env.TEAMS_APP_ID && env.TEAMS_APP_PASSWORD && env.MASTRA_JWT_SECRET && convexSiteUrl(),
  );
}

/** The Teams adapter entry for the agent controller, or none without a bot. */
export function teamsAdapter() {
  if (!teamsReady()) return undefined;
  return {
    adapter: createTeamsAdapter({
      appId: env.TEAMS_APP_ID,
      appPassword: env.TEAMS_APP_PASSWORD,
      ...(env.TEAMS_APP_TENANT_ID
        ? { appType: "SingleTenant" as const, appTenantId: env.TEAMS_APP_TENANT_ID }
        : { appType: "MultiTenant" as const }),
    }),
    toolDisplay: "hidden" as const,
    formatError: () => ({
      markdown: "Something went wrong on my side and I stopped. Try asking again.",
    }),
  };
}

// Approve and Send back on an alert card the dashboard posted in a Teams channel. Teams
// sends the press to this server (the bot's messaging endpoint), so it is handed straight
// to the dashboard, which finds who pressed it by their Microsoft account and decides as
// them. Every other button (the agent's own tool approvals) goes to the default handler.

/** Our alert buttons' action ids. Kept in step with convex/lib/chatAlerts/teams.ts. */
const ALERT_PREFIX = "ncat_alert_";

export type PressAnswer = { ok: boolean; message: string };
type AskPress = (body: Record<string, string>) => Promise<PressAnswer | null>;

const askPressDashboard: AskPress = async (body) => {
  const site = convexSiteUrl();
  const secret = env.MASTRA_JWT_SECRET;
  if (!site || !secret) return null;
  try {
    const response = await fetch(`${site}/teams/alert-action`, {
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
    console.error("[teams] could not reach the dashboard", error);
    return null;
  }
};

let askPress: AskPress = askPressDashboard;

/** For tests: answer presses without a deployment. Pass nothing to undo. */
export function usePressDashboardForTests(answer?: AskPress): void {
  askPress = answer ?? askPressDashboard;
}

export const onTeamsAlertButton: ActionChannelHandler = async (event, defaultHandler) => {
  const decision = event.actionId.startsWith(ALERT_PREFIX)
    ? event.actionId.slice(ALERT_PREFIX.length)
    : null;
  if (!decision || !event.threadId.startsWith("teams:")) {
    await defaultHandler();
    return;
  }
  const who = questionFor(event.raw);
  if (event.user.isBot || !event.value || !who) return;
  const answer = await askPress({
    tenantId: who.tenantId,
    aadObjectId: who.aadObjectId,
    runStepId: event.value,
    decision,
  });
  // When it worked the dashboard changes the card itself to say so.
  if (answer?.ok) return;
  await event.thread?.post(
    answer?.message ?? "I can't reach the dashboard right now. Try again in a minute.",
  );
};
