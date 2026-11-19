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
  finished: "Another automation finishes",
  slot: "A project slot changes status",
};

/** What can start a run: a trigger, or a Run an automation step in another run. */
export type RunTriggerKind = TriggerKind | "automation";

export const RUN_TRIGGER_LABELS: Record<RunTriggerKind, string> = {
  ...TRIGGER_LABELS,
  automation: "Started by another automation",
};

const SLOT_KIND_WORDS = {
  video: "full video",
  short: "short",
  thumbnail: "thumbnail",
  audio: "audio",
  other: "project",
} as const;

const SLOT_STATUS_WORDS = {
  todo: "To do",
  in_progress: "In progress",
  review: "In review",
  approved: "Approved",
  published: "Published",
} as const;

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
    case "finished":
      return trigger.when === "failed"
        ? "Starts when another automation fails"
        : trigger.when === "either"
          ? "Starts when another automation ends"
          : "Starts when another automation finishes";
    case "slot":
      return `Starts when ${
        trigger.slotKind === "any"
          ? "a project slot"
          : `a ${SLOT_KIND_WORDS[trigger.slotKind]} slot`
      } moves to ${SLOT_STATUS_WORDS[trigger.status]}`;
    case "schedule": {
      const { schedule } = trigger;
      if (schedule.mode === "daily") {
        // "America/New_York" reads as "New York time".
        const city = schedule.timeZone.split("/").at(-1)!.replaceAll("_", " ");
        return `Every day at ${schedule.time}, ${city} time`;
      }
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
  if (node.kind === "moments") return "Best moments";
  if (node.kind === "chapters") return "Chapters and show notes";
  if (node.kind === "broll") return "Add B-Roll";
  if (node.kind === "broll-plan") return "Plan B-Roll";
  if (node.kind === "motion") return "Add Motion Graphics";
  if (node.kind === "sound-effects") return "Add Sound Effects";
  if (node.kind === "if") return "If";
  if (node.kind === "wait") return "Wait";
  if (node.kind === "export") return "Export for editors";
  if (node.kind === "automation") return "Run an automation";
  return getStep(node.stepId ?? "")?.title ?? node.stepId ?? "Step";
}

/** The address that starts a webhook automation. */
export function hookUrl(automationId: string, token: string): string {
  const base = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";
  return `${base}/automations/hook?id=${automationId}&token=${token}`;
}
