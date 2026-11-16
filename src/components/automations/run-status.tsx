import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Hourglass,
  Loader2,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type RunStatus = "running" | "waiting" | "done" | "failed" | "cancelled";
export type StepStatus = "pending" | "running" | "waiting_approval" | "done" | "failed" | "skipped";

const LOOK: Record<
  RunStatus | StepStatus,
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

export function RunStatusBadge({ status }: { status: RunStatus | StepStatus }) {
  const { label, icon: Icon, tone, variant } = LOOK[status];
  return (
    <Badge variant={variant} data-status={status}>
      <Icon className={tone} />
      {label}
    </Badge>
  );
}

/** Just the icon, for a node on the canvas. */
export function StatusIcon({ status, className }: { status: StepStatus; className?: string }) {
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
