// Alerts in Microsoft Teams: posted by the dashboard's one bot to the channel the team
// picked in Settings, as an Adaptive Card. An approval names who it waits for (tagged, so
// Teams tells them) and carries Approve and Send back. Teams hands a press to the agent
// server, which passes it to Convex POST /teams/alert-action; that finds who pressed by
// their Microsoft account and decides through `chatAlerts.decideFromChat`.
import { internal } from "../../_generated/api";
import { botToken } from "../../microsoftTeams";
import { actionIdFor } from "./chatFormats";
import type { ChatAlert, ChatSender } from "./index";

/** Someone an approval waits for: tagged when their Microsoft account is known. */
export type Tagged = { name: string; aadObjectId: string | null };

type Address = { serviceUrl: string; conversationId: string };
type Ref = Address & { activityId: string };
/** What is kept of a sent card, so settling can draw it again without the buttons. */
type Kept = Pick<ChatAlert, "title" | "lines" | "link" | "linkLabel"> & { who: Tagged[] };

function tagOf(person: Tagged): string {
  return person.aadObjectId ? `<at>${person.name}</at>` : person.name;
}

function mentions(who: Tagged[]) {
  return who
    .filter((person) => person.aadObjectId)
    .map((person) => ({
      type: "mention",
      text: tagOf(person),
      mentioned: { id: person.aadObjectId, name: person.name },
    }));
}

/**
 * An alert as a Teams Adaptive Card: its title, its lines, who an approval waits for,
 * and Approve / Send back (or how it ended, once decided). Exported for the tests.
 */
export function teamsCard(
  alert: Kept & Pick<ChatAlert, "runStepId" | "actions">,
  outcome?: string,
) {
  const body: unknown[] = [
    { type: "TextBlock", text: alert.title, weight: "Bolder", wrap: true },
    ...alert.lines
      .filter((line) => line.trim() !== "")
      .map((line) => ({ type: "TextBlock", text: line, wrap: true })),
  ];
  if (alert.who.length > 0) {
    body.push({
      type: "TextBlock",
      text: `For ${alert.who.map(tagOf).join(", ")}`,
      wrap: true,
      isSubtle: true,
    });
  }
  if (outcome) body.push({ type: "TextBlock", text: outcome, weight: "Bolder", wrap: true });
  const actions: unknown[] = [];
  if (!outcome && alert.runStepId && alert.actions?.length) {
    for (const action of alert.actions) {
      actions.push({
        type: "Action.Submit",
        title: action.label,
        ...(action.id === "approve" ? { style: "positive" } : {}),
        data: { actionId: actionIdFor(action.id), value: alert.runStepId },
      });
    }
  }
  actions.push({ type: "Action.OpenUrl", title: alert.linkLabel, url: alert.link });
  const entities = mentions(alert.who);
  return {
    contentType: "application/vnd.microsoft.card.adaptive",
    content: {
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      type: "AdaptiveCard",
      version: "1.4",
      body,
      actions,
      ...(entities.length > 0 ? { msteams: { entities } } : {}),
    },
  };
}

function activitiesUrl(address: Address): string {
  return `${address.serviceUrl.replace(/\/+$/, "")}/v3/conversations/${encodeURIComponent(
    address.conversationId,
  )}/activities`;
}

export const teamsSender: ChatSender = {
  app: "teams",

  // Teams alerts go to the team's channel, so the column shows once there is one, or once
  // the member linked their Microsoft account to talk to the agent.
  async isLinked(ctx, organizationId, userId) {
    const tenant = await ctx.db
      .query("teamsTenants")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .unique();
    if (tenant?.alertConversationId) return true;
    const link = await ctx.db
      .query("teamsPeople")
      .withIndex("by_member", (q) => q.eq("organizationId", organizationId).eq("userId", userId))
      .unique();
    return link !== null;
  },

  // One post in the channel, however many members want it there.
  async targets(ctx, organizationId) {
    const tenant = await ctx.db
      .query("teamsTenants")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .unique();
    if (!tenant?.alertConversationId || !tenant.alertServiceUrl) return [];
    const address: Address = {
      serviceUrl: tenant.alertServiceUrl,
      conversationId: tenant.alertConversationId,
    };
    return [{ address: JSON.stringify(address) }];
  },

  async send(ctx, alert, target) {
    // Mentions and client feedback are review activity: they are posted to the channel as
    // the comment's own thread (convex/lib/teamsPosts.ts), where replies go back to the review.
    // An agent's answer is for the one person who asked, never the whole channel.
    if (
      alert.kind === "mention" ||
      alert.kind === "client_feedback" ||
      alert.kind === "agent_answer"
    )
      return null;
    const token = await botToken();
    if (!token) return null;
    const address = JSON.parse(target.address) as Address;
    const who: Tagged[] =
      alert.kind === "approval_waiting"
        ? await ctx.runQuery(internal.microsoftTeams.alertTags, { alertId: alert.alertId })
        : [];
    const kept: Kept = {
      title: alert.title,
      lines: alert.lines,
      link: alert.link,
      linkLabel: alert.linkLabel,
      who,
    };
    const response = await fetch(activitiesUrl(address), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        type: "message",
        summary: alert.title,
        attachments: [teamsCard({ ...kept, runStepId: alert.runStepId, actions: alert.actions })],
      }),
    }).catch(() => null);
    if (!response?.ok) {
      console.warn(`Teams did not take an alert: ${response?.status ?? "no answer"}`);
      return null;
    }
    const sent = (await response.json().catch(() => ({}))) as { id?: string };
    if (!sent.id) return null;
    const ref: Ref = { ...address, activityId: sent.id };
    return { ref: JSON.stringify(ref), text: JSON.stringify(kept) };
  },

  async settle(_ctx, message, outcome) {
    const token = await botToken();
    if (!token) return;
    const ref = JSON.parse(message.ref) as Ref;
    const kept = JSON.parse(message.text) as Kept;
    await fetch(`${activitiesUrl(ref)}/${encodeURIComponent(ref.activityId)}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        type: "message",
        id: ref.activityId,
        summary: kept.title,
        attachments: [teamsCard(kept, outcome)],
      }),
    });
  },
};
