import { explainFailure } from "@takewon/automation-core";
import {
  AtSign,
  Bell,
  Bot,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  Clock,
  MessageSquareQuote,
  Video,
  PackageCheck,
  UserCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";

function tries(retries: number): string {
  return retries > 0 ? ` after ${retries + 1} tries` : "";
}

export type Kind =
  | "run_failed"
  | "approval_waiting"
  | "approval_timed_out"
  | "mention"
  | "agent_answer"
  | "client_feedback"
  | "ready_for_review"
  | "clip_finished"
  | "footage_problem"
  | "rights_ending";
type Shown = {
  kind: Kind;
  automationName: string;
  retries: number;
  from?: string | null;
  stepName?: string | null;
};

/** The first line of an alert: what happened, in a few words. */
export function alertTitle(alert: Shown): string {
  switch (alert.kind) {
    case "approval_waiting":
      return `${alert.automationName} is waiting for your approval`;
    case "approval_timed_out":
      return `${alert.automationName}: an approval ran out of time`;
    case "mention":
      return `${alert.from ?? "Someone"} mentioned you in ${alert.automationName}`;
    case "agent_answer":
      return `The agent answered you in ${alert.automationName}`;
    case "client_feedback":
      return `${alert.from ?? "A client"} left feedback on ${alert.automationName}`;
    case "ready_for_review":
      return `${alert.stepName ?? "A deliverable"} in ${alert.automationName} is ready for review`;
    case "clip_finished":
      return `${alert.automationName} finished`;
    case "footage_problem":
      return `${alert.automationName}: footage needs another look`;
    case "rights_ending":
      return alert.stepName
        ? `${alert.automationName}'s rights for ${alert.stepName} end soon`
        : `Usage rights for ${alert.automationName} end soon`;
    default:
      return `${alert.automationName} failed${tries(alert.retries)}`;
  }
}

/**
 * The second line of an alert: the step and what it said. A failure is said in plain
 * words, since older alerts kept the toolkit's own text ("connect ECONNREFUSED …").
 */
export function alertDetail(alert: Shown & { stepName?: string | null; message: string }): string {
  const message =
    alert.kind === "run_failed" ? explainFailure(alert.message).reason : alert.message;
  return alert.stepName ? `${alert.stepName}: ${message}` : message;
}

/** How each kind looks: its icon, its colour while unseen, and what opening it does. */
export const LOOK: Record<Kind, { icon: typeof Bell; tint: string; wash: string; action: string }> =
  {
    run_failed: {
      icon: CircleAlert,
      tint: "text-destructive",
      wash: "bg-destructive/5",
      action: "View run",
    },
    approval_waiting: {
      icon: UserCheck,
      tint: "text-amber-600",
      wash: "bg-amber-500/10",
      action: "Review",
    },
    approval_timed_out: {
      icon: Clock,
      tint: "text-amber-600",
      wash: "bg-amber-500/10",
      action: "View run",
    },
    mention: { icon: AtSign, tint: "text-primary", wash: "bg-primary/5", action: "Open review" },
    agent_answer: {
      icon: Bot,
      tint: "text-primary",
      wash: "bg-primary/5",
      action: "Open review",
    },
    client_feedback: {
      icon: MessageSquareQuote,
      tint: "text-primary",
      wash: "bg-primary/5",
      action: "Open review",
    },
    ready_for_review: {
      icon: PackageCheck,
      tint: "text-primary",
      wash: "bg-primary/5",
      action: "Open review",
    },
    clip_finished: {
      icon: CircleCheck,
      tint: "text-emerald-600",
      wash: "bg-emerald-500/10",
      action: "View run",
    },
    footage_problem: {
      icon: Video,
      tint: "text-amber-600",
      wash: "bg-amber-500/10",
      action: "View run",
    },
    rights_ending: {
      icon: CalendarClock,
      tint: "text-amber-600",
      wash: "bg-amber-500/10",
      action: "Open the creator",
    },
  };

export function AlertIcon({ kind, seen }: { kind: Kind; seen: boolean }) {
  const { icon: Icon, tint, wash } = LOOK[kind];
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full",
        seen ? "bg-muted" : wash,
      )}
      aria-hidden="true"
    >
      <Icon className={cn("size-4", seen ? "text-muted-foreground" : tint)} />
    </span>
  );
}
