import { explainFailure } from "@ncat-dash/automation-core";
import type { Doc, Id } from "../../_generated/dataModel";
import type { ActionCtx, QueryCtx } from "../../_generated/server";
import type { ChatApp } from "../notifications";
import { discordSender } from "./discord";
import { slackSender } from "./slack";
import { teamsSender } from "./teams";

/**
 * Alerts in chat apps. `notify` writes an alert; `chatAlerts.deliver` then works out who
 * wants it in which app (their notification settings, per app), and hands one neutral
 * message to each app's sender below. A sender only reaches the members who linked that
 * app, or a team channel the team picked. Approvals carry Approve and Send back buttons;
 * each app's own webhook takes the press and calls `chatAlerts.decideFromChat`.
 *
 * To add an app: write `<app>.ts` here with a `ChatSender`, and list it in `SENDERS`.
 */

export type ChatAlertAction = { id: "approve" | "send_back"; label: string };

/** One alert, worded once for every chat app. */
export type ChatAlert = {
  alertId: Id<"alerts">;
  organizationId: string;
  kind: Doc<"alerts">["kind"];
  /** The first line, in plain words, such as "Shorts is waiting for your approval". */
  title: string;
  /** Any further lines, plain text. */
  lines: string[];
  /** The full address of the page it is about. */
  link: string;
  linkLabel: string;
  /** For an approval waiting: the step, and the buttons to show. */
  runStepId?: Id<"runSteps">;
  actions?: ChatAlertAction[];
};

/** Where one message goes: a person's chat with the bot, or a team channel. */
export type ChatTarget = { userId?: string; address: string };

/** A message a sender has sent, as it is kept in `chatAlertMessages`. */
export type SentMessage = { ref: string; text: string };

export type ChatSender = {
  app: ChatApp;
  /** Whether this member has linked this app on this team (Settings then shows its column). */
  isLinked(ctx: QueryCtx, organizationId: string, userId: string): Promise<boolean>;
  /** Where to send an alert for these members, who all want it in this app. */
  targets(ctx: QueryCtx, organizationId: string, userIds: string[]): Promise<ChatTarget[]>;
  /** Sends it. Returns what to keep to change the message later, or null when it failed. */
  send(ctx: ActionCtx, alert: ChatAlert, target: ChatTarget): Promise<SentMessage | null>;
  /** After an approval is decided: changes the message to say so and takes its buttons off. */
  settle?(ctx: ActionCtx, message: SentMessage, outcome: string): Promise<void>;
};

export const SENDERS: ChatSender[] = [slackSender, discordSender, teamsSender];

export function senderFor(app: ChatApp): ChatSender | undefined {
  return SENDERS.find((sender) => sender.app === app);
}

/** The chat apps a member has linked on a team. */
export async function linkedChatApps(
  ctx: QueryCtx,
  organizationId: string,
  userId: string,
): Promise<ChatApp[]> {
  const linked: ChatApp[] = [];
  for (const sender of SENDERS) {
    if (await sender.isLinked(ctx, organizationId, userId)) linked.push(sender.app);
  }
  return linked;
}

/** Words an alert once for every app. */
export function wordAlert(alert: Doc<"alerts">, link: string): ChatAlert {
  const base = { alertId: alert._id, organizationId: alert.organizationId, kind: alert.kind, link };
  const step = alert.stepName ? ` (${alert.stepName})` : "";
  switch (alert.kind) {
    case "approval_waiting":
      return {
        ...base,
        title: `${alert.automationName} is waiting for your approval${step}`,
        lines: [alert.message],
        linkLabel: "Open the run",
        runStepId: alert.runStepId,
        actions: alert.runStepId
          ? [
              { id: "approve", label: "Approve" },
              { id: "send_back", label: "Send back" },
            ]
          : undefined,
      };
    case "approval_timed_out":
      return {
        ...base,
        title: `${alert.automationName}: an approval ran out of time${step}`,
        lines: [alert.message],
        linkLabel: "Open the run",
      };
    case "mention":
      return {
        ...base,
        title: `${alert.from ?? "Someone"} mentioned you in ${alert.automationName}`,
        lines: [alert.message],
        linkLabel: "Open the review",
      };
    case "client_feedback":
      return {
        ...base,
        title: `${alert.from ?? "A client"} left feedback on ${alert.automationName}`,
        lines: [alert.message],
        linkLabel: "Open the review",
      };
    case "ready_for_review":
      return {
        ...base,
        title: `${alert.stepName ?? "A deliverable"} in ${alert.automationName} is ready for review`,
        lines: alert.from ? [`Added by ${alert.from}.`] : [],
        linkLabel: "Open the review",
      };
    case "clip_finished":
      return {
        ...base,
        title: `${alert.automationName} finished`,
        lines: [alert.message],
        linkLabel: "Open the run",
      };
    default:
      return {
        ...base,
        title: `${alert.automationName} failed${step}`,
        lines: [explainFailure(alert.message).reason],
        linkLabel: "Open the run",
      };
  }
}

/** An alert as plain text, for apps that need one string. */
export function plainText(alert: ChatAlert): string {
  return [alert.title, ...alert.lines.filter((line) => line.trim() !== "")].join("\n");
}
