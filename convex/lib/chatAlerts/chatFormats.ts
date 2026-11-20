// How an alert looks in Slack and in Discord: pure functions, so the tests can check the
// words and buttons without either app. The senders in slack.ts and discord.ts post them.

/** The neutral alert every chat app gets (see chatAlerts/index.ts). */
export type ChatAlertView = {
  title: string;
  lines: string[];
  link: string;
  actions?: { id: "approve" | "send_back"; label: string }[];
};

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

function slackEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** An alert as Slack Block Kit: the title, its lines, a link, and the buttons. */
export function slackAlert(
  alert: ChatAlertView,
  alertId: string,
): { text: string; blocks: unknown[] } {
  const body = [
    `*${slackEscape(alert.title)}*`,
    ...alert.lines.map(slackEscape),
    `<${alert.link}|Open in the dashboard>`,
  ].join("\n");
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: body } }];
  if (alert.actions?.length) {
    blocks.push({
      type: "actions",
      block_id: "ncat_alert",
      elements: alert.actions.map((action) => ({
        type: "button",
        action_id: actionIdFor(action.id),
        text: { type: "plain_text", text: action.label },
        value: alertId,
        ...(action.id === "approve" ? { style: "primary" } : {}),
      })),
    });
  }
  return { text: alert.title, blocks };
}

/** The same message once decided: the buttons give way to what happened. */
export function slackSettled(
  alert: ChatAlertView,
  outcome: string,
): { text: string; blocks: unknown[] } {
  const settled = slackAlert({ ...alert, actions: undefined }, "");
  return {
    text: `${alert.title}: ${outcome}`,
    blocks: [
      ...settled.blocks,
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

/**
 * An alert as a Discord message: the title in bold, its lines, and a row of buttons. The
 * custom id is "<action id>\n<alert id>", which the chat adapter on the agent server
 * reads back as the action and its value. A link button opens the dashboard.
 */
export function discordAlert(
  alert: ChatAlertView,
  alertId: string,
): { content: string; components: unknown[] } {
  const content = fit([`**${discordEscape(alert.title)}**`, ...alert.lines.map(discordEscape)].join("\n"));
  const buttons: unknown[] = (alert.actions ?? []).map((action) => ({
    type: 2,
    style: action.id === "approve" ? 3 : 2,
    label: action.label,
    custom_id: `${actionIdFor(action.id)}\n${alertId}`,
  }));
  buttons.push({ type: 2, style: 5, label: "Open in the dashboard", url: alert.link });
  return { content, components: [{ type: 1, components: buttons }] };
}

/** The same message once decided: only the link stays, and the outcome is added. */
export function discordSettled(
  alert: ChatAlertView,
  outcome: string,
): { content: string; components: unknown[] } {
  const settled = discordAlert({ ...alert, actions: undefined }, "");
  return { ...settled, content: fit(`${settled.content}\n-# ${discordEscape(outcome)}`) };
}
