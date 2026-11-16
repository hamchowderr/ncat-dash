import { CircleAlert, CircleCheck, Clock, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export type JobStatus = "queued" | "running" | "done" | "failed";

const STATUS = {
  queued: { label: "Queued", icon: Clock, variant: "outline", spin: false },
  running: { label: "Running", icon: Loader2, variant: "secondary", spin: true },
  done: { label: "Done", icon: CircleCheck, variant: "secondary", spin: false },
  failed: { label: "Failed", icon: CircleAlert, variant: "destructive", spin: false },
} as const;

export function StatusBadge({ status }: { status: JobStatus }) {
  const { label, icon: Icon, variant, spin } = STATUS[status];
  return (
    <Badge variant={variant} data-status={status}>
      <Icon
        className={
          spin
            ? "animate-spin"
            : status === "done"
              ? "text-emerald-600 dark:text-emerald-400"
              : undefined
        }
      />
      {label}
    </Badge>
  );
}
