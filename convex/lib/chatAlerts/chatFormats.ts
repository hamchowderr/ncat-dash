// How an alert looks in Slack and in Discord: pure functions, so the tests can check the
// words and buttons without either app. The senders in slack.ts and discord.ts post them.
import type { ChatAlert } from "./index";

/** The action ids on our buttons. Anything else is the agent's own (tool approvals). */
export const ALERT_ACTION_PREFIX = "ncat_alert_";

export function actionIdFor(id: "approve" | "send_back"): string {
  return `${ALERT_ACTION_PREFIX}${id}`;
}

/** Which decision a pressed button stands for, or null when it is not one of ours. */
export function decisionOf(actionId: string): "approve" | "send_back" | null {
  if (actionId === actionIdFor("approve")) return "approve";
  if (actionId === actionIdFor("send_back")) return "send_back";
  return null;
}

type Worded = Pick<ChatAlert, "title" | "lines" | "link" | "linkLabel" | "runStepId" | "actions">;

/**
 * What is kept of a sent message so it can be changed later: Slack's or Discord's own
 * text, with the link already in it. Settling adds the outcome under it.
 */
function slackEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function lines(alert: Worded): string[] {
  return alert.lines.filter((line) => line.trim() !== "");
}

/** The words of an alert in Slack's markup: bold title, its lines, and the link. */
export function slackText(alert: Worded): string {
  return [
    `*${slackEscape(alert.title)}*`,
    ...lines(alert).map(slackEscape),
    `<${alert.link}|${slackEscape(alert.linkLabel)}>`,
  ].join("\n");
}

/** An alert as Slack Block Kit: its words, and Approve / Send back for an approval. */
export function slackAlert(alert: Worded): { text: string; blocks: unknown[] } {
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: slackText(alert) } }];
  if (alert.actions?.length && alert.runStepId) {
    blocks.push({
      type: "actions",
      block_id: "ncat_alert",
      elements: alert.actions.map((action) => ({
        type: "button",
        action_id: actionIdFor(action.id),
        text: { type: "plain_text", text: action.label },
        value: alert.runStepId,
        ...(action.id === "approve" ? { style: "primary" } : {}),
      })),
    });
  }
  return { text: alert.title, blocks };
}

/** A sent message once decided: its words, and what happened instead of the buttons. */
export function slackSettled(text: string, outcome: string): { text: string; blocks: unknown[] } {
  return {
    text: outcome,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      { type: "context", elements: [{ type: "mrkdwn", text: slackEscape(outcome) }] },
    ],
  };
}

/** Discord's markdown marks, escaped so a name never turns into formatting. */
function discordEscape(text: string): string {
  return text.replace(/([\\*_~`|>#-])/g, "\\$1");
}

/** Discord limits a message to 2000 characters. */
function fit(text: string): string {
  return text.length > 2000 ? `${text.slice(0, 1997)}...` : text;
}

/** The words of an alert in Discord's markdown: bold title and its lines. */
export function discordText(alert: Worded): string {
  return fit([`**${discordEscape(alert.title)}**`, ...lines(alert).map(discordEscape)].join("\n"));
}

function linkButton(alert: Pick<Worded, "link" | "linkLabel">) {
  return { type: 2, style: 5, label: alert.linkLabel, url: alert.link };
}

/**
 * An alert as a Discord message: its words, and a row of buttons. The custom id is
 * "<action id>\n<run step id>", which the chat adapter on the agent server reads back as
 * the action and its value. A link button opens the dashboard.
 */
export function discordAlert(alert: Worded): { content: string; components: unknown[] } {
  const buttons: unknown[] =
    alert.runStepId && alert.actions
      ? alert.actions.map((action) => ({
          type: 2,
          style: action.id === "approve" ? 3 : 2,
          label: action.label,
          custom_id: `${actionIdFor(action.id)}\n${alert.runStepId}`,
        }))
      : [];
  buttons.push(linkButton(alert));
  return { content: discordText(alert), components: [{ type: 1, components: buttons }] };
}

/** What is kept of a Discord alert: its words and the link, so it can be rebuilt. */
export function discordKept(alert: Worded): string {
  return JSON.stringify({
    content: discordText(alert),
    link: alert.link,
    linkLabel: alert.linkLabel,
  });
}

/** A sent message once decided: only the link stays, and the outcome is added. */
export function discordSettled(
  kept: string,
  outcome: string,
): { content: string; components: unknown[] } {
  let parsed: { content?: string; link?: string; linkLabel?: string } = {};
  try {
    parsed = JSON.parse(kept);
  } catch {
    parsed = { content: kept };
  }
  const content = fit(`${parsed.content ?? ""}\n-# ${discordEscape(outcome)}`);
  const components =
    parsed.link && parsed.linkLabel
      ? [{ type: 1, components: [linkButton({ link: parsed.link, linkLabel: parsed.linkLabel })] }]
      : [];
  return { content, components };
}
