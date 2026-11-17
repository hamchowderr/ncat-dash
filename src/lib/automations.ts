import type { AutomationNode, StarterTrigger } from "@ncat-dash/automation-core";
import { getStep } from "@ncat-dash/step-catalog";

export type Trigger = StarterTrigger;

export type TriggerKind = Trigger["kind"];

export const TRIGGER_LABELS: Record<TriggerKind, string> = {
  manual: "Run by hand",
  webhook: "Webhook",
  schedule: "Schedule",
  upload: "New upload",
  folder: "Watched folder",
};

/** One line saying when the automation starts, for lists and the canvas. */
export function triggerSummary(trigger: Trigger): string {
  switch (trigger.kind) {
    case "manual":
      return "Starts when you press Run now";
    case "webhook":
      return "Starts when its address is called";
    case "upload":
      return trigger.fileType === "any"
        ? "Starts when a file is uploaded"
        : `Starts when ${trigger.fileType === "image" ? "an" : "a"} ${trigger.fileType} file is uploaded`;
    case "folder":
      return `Starts when a file lands in ${trigger.prefix || "your bucket"}`;
    case "schedule": {
      const { schedule } = trigger;
      if (schedule.mode === "daily") return `Every day at ${schedule.time} (${schedule.timeZone})`;
      const { minutes } = schedule;
      if (minutes % 1440 === 0)
        return minutes === 1440 ? "Every day" : `Every ${minutes / 1440} days`;
      if (minutes % 60 === 0) return minutes === 60 ? "Every hour" : `Every ${minutes / 60} hours`;
      return `Every ${minutes} minutes`;
    }
  }
}

export function nodeTitle(node: Pick<AutomationNode, "kind" | "stepId" | "label">): string {
  if (node.label) return node.label;
  if (node.kind === "approval") return "Approval";
  if (node.kind === "clips") return "Clips for a platform";
  if (node.kind === "if") return "If";
  if (node.kind === "wait") return "Wait";
  if (node.kind === "export") return "Export for editors";
  return getStep(node.stepId ?? "")?.title ?? node.stepId ?? "Step";
}

/** The address that starts a webhook automation. */
export function hookUrl(automationId: string, token: string): string {
  const base = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";
  return `${base}/automations/hook?id=${automationId}&token=${token}`;
}
