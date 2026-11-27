import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Hourglass,
  Loader2,
  type LucideIcon,
  RotateCw,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type RunStatus = "running" | "waiting" | "done" | "failed" | "cancelled";
export type StepStatus = "pending" | "running" | "waiting_approval" | "done" | "failed" | "skipped";
/** What a step is shown as: its status, or "retrying" while it waits to try again. */
export type ShownStepStatus = StepStatus | "retrying";

/** A step that failed and is waiting for its next try is shown as trying again. */
export function shownStatus(step: {
  status: StepStatus;
  retryAt?: number | null;
}): ShownStepStatus {
  return step.status === "running" && step.retryAt ? "retrying" : step.status;
}

const LOOK: Record<
  RunStatus | ShownStepStatus,
  {
    label: string;
    icon: LucideIcon;
    tone: string;
    variant: "outline" | "secondary" | "destructive";
  }
> = {
  pending: {
    label: "Not started",
    icon: CircleDashed,
    tone: "text-muted-foreground",
    variant: "outline",
  },
  running: { label: "Running", icon: Loader2, tone: "animate-spin", variant: "secondary" },
  waiting: {
    label: "Needs approval",
    icon: Hourglass,
    tone: "text-amber-600 dark:text-amber-400",
    variant: "secondary",
  },
  waiting_approval: {
    label: "Needs approval",
    icon: Hourglass,
    tone: "text-amber-600 dark:text-amber-400",
    variant: "secondary",
  },
  done: {
    label: "Done",
    icon: CircleCheck,
    tone: "text-emerald-600 dark:text-emerald-400",
    variant: "secondary",
  },
  retrying: {
    label: "Trying again",
    icon: RotateCw,
    tone: "text-amber-600 dark:text-amber-400",
    variant: "secondary",
  },
  failed: { label: "Failed", icon: CircleAlert, tone: "", variant: "destructive" },
  skipped: {
    label: "Skipped",
    icon: CircleSlash,
    tone: "text-muted-foreground",
    variant: "outline",
  },
  cancelled: {
    label: "Cancelled",
    icon: CircleSlash,
    tone: "text-muted-foreground",
    variant: "outline",
  },
};

/** A failed run where another branch got to its end: what that branch made is in Files. */
const PARTLY = {
  label: "Partly done",
  icon: CircleAlert,
  tone: "text-amber-600 dark:text-amber-400",
  variant: "secondary" as const,
};

export function RunStatusBadge({
  status,
  partly = false,
}: {
  status: RunStatus | ShownStepStatus;
  /** The run failed but a branch of it finished. */
  partly?: boolean;
}) {
  const shown = partly && status === "failed";
  const { label, icon: Icon, tone, variant } = shown ? PARTLY : LOOK[status];
  return (
    <Badge variant={variant} data-status={shown ? "partly" : status}>
      <Icon className={tone} />
      {label}
    </Badge>
  );
}

/** Just the icon, for a node on the canvas. */
export function StatusIcon({ status, className }: { status: ShownStepStatus; className?: string }) {
  const { label, icon: Icon, tone } = LOOK[status];
  return (
    <span title={label}>
      <Icon
        className={cn("size-4", tone, status === "failed" && "text-destructive", className)}
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
