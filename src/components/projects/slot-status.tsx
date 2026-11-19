import {
  type DeliverableKind,
  type DeliverableStatus,
  KINDS,
  STATUSES,
} from "@convex/lib/packages";
import {
  AudioLines,
  Circle,
  CircleCheck,
  CircleDot,
  Clapperboard,
  Eye,
  File,
  Image as ImageIcon,
  type LucideIcon,
  Send,
  Smartphone,
} from "lucide-react";

import { cn } from "@/lib/utils";

export { STATUSES };

/** A plain select, styled like the inputs beside it. */
export const selectClass =
  "border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-3 disabled:opacity-50";

// Like Linear's issue states: one small icon per state, in a colour only where it helps.
const LOOK: Record<DeliverableStatus, { icon: LucideIcon; tone: string }> = {
  todo: { icon: Circle, tone: "text-muted-foreground" },
  in_progress: { icon: CircleDot, tone: "text-amber-600" },
  review: { icon: Eye, tone: "text-sky-600" },
  approved: { icon: CircleCheck, tone: "text-emerald-600" },
  published: { icon: Send, tone: "text-violet-600" },
};

export function statusLabel(status: DeliverableStatus): string {
  return STATUSES.find((entry) => entry.status === status)?.label ?? status;
}

export function StatusIcon({
  status,
  className,
}: {
  status: DeliverableStatus;
  className?: string;
}) {
  const { icon: Icon, tone } = LOOK[status];
  return <Icon aria-hidden="true" className={cn("size-4 shrink-0", tone, className)} />;
}

const KIND_ICONS: Record<DeliverableKind, LucideIcon> = {
  video: Clapperboard,
  short: Smartphone,
  thumbnail: ImageIcon,
  audio: AudioLines,
  other: File,
};

export function KindIcon({ kind, className }: { kind: DeliverableKind; className?: string }) {
  const Icon = KIND_ICONS[kind];
  return <Icon aria-hidden="true" className={cn("text-muted-foreground size-4", className)} />;
}

export function kindLabel(kind: DeliverableKind): string {
  return KINDS.find((entry) => entry.kind === kind)?.label ?? kind;
}

/** How far a project is: a thin bar of the slots that hold a file, and the count beside it. */
export function Filled({ filled, total }: { filled: number; total: number }) {
  const share = total === 0 ? 0 : Math.round((filled / total) * 100);
  return (
    <span className="flex items-center gap-2">
      <span
        role="meter"
        aria-label="Slots with a file"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={filled}
        className="bg-muted relative h-1.5 w-20 overflow-hidden rounded-full"
      >
        <span className="bg-foreground absolute inset-y-0 left-0" style={{ width: `${share}%` }} />
      </span>
      <span className="text-muted-foreground text-xs tabular-nums">
        {filled} of {total}
      </span>
    </span>
  );
}
