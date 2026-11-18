"use client";

import { api } from "@convex/_generated/api";
import { explainFailure } from "@ncat-dash/automation-core";
import { useMutation, useQuery } from "convex/react";
import { AtSign, Bell, CircleAlert, Clock, MessageSquareQuote, UserCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function tries(retries: number): string {
  return retries > 0 ? ` after ${retries + 1} tries` : "";
}

type Kind =
  "run_failed" | "approval_waiting" | "approval_timed_out" | "mention" | "client_feedback";
type Shown = { kind: Kind; automationName: string; retries: number; from?: string | null };

/** The first line of an alert: what happened, in a few words. */
export function alertTitle(alert: Shown): string {
  switch (alert.kind) {
    case "approval_waiting":
      return `${alert.automationName} is waiting for your approval`;
    case "approval_timed_out":
      return `${alert.automationName}: an approval ran out of time`;
    case "mention":
      return `${alert.from ?? "Someone"} mentioned you in ${alert.automationName}`;
    case "client_feedback":
      return `${alert.from ?? "A client"} left feedback on ${alert.automationName}`;
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

/** How each kind looks under the bell: its icon, and its colour while unseen. */
const LOOK: Record<Kind, { icon: typeof Bell; tint: string; wash: string; action: string }> = {
  run_failed: {
    icon: CircleAlert,
    tint: "text-destructive",
    wash: "bg-destructive/5",
    action: "View run",
  },
  approval_waiting: {
    icon: UserCheck,
    tint: "text-amber-600 dark:text-amber-400",
    wash: "bg-amber-500/10",
    action: "Review",
  },
  approval_timed_out: {
    icon: Clock,
    tint: "text-amber-600 dark:text-amber-400",
    wash: "bg-amber-500/10",
    action: "View run",
  },
  mention: { icon: AtSign, tint: "text-primary", wash: "bg-primary/5", action: "Open review" },
  client_feedback: {
    icon: MessageSquareQuote,
    tint: "text-primary",
    wash: "bg-primary/5",
    action: "Open review",
  },
};

/**
 * The bell at the top of every page. It counts the alerts the person has not seen,
 * lists the latest ones meant for them, and pops up a notice the moment a run fails or an
 * approval starts waiting for them.
 */
export function AlertsBell() {
  const team = useActiveTeam();
  const router = useRouter();
  const data = useQuery(api.alerts.list, { organizationId: team.id });
  const markSeen = useMutation(api.alerts.markSeen);
  const [open, setOpen] = useState(false);
  // Alerts that were already there when the page opened are not announced again.
  const announced = useRef<Set<string> | null>(null);
  // The notices showing now, so opening the list can take them away: the list says the
  // same, and nothing should sit on top of it.
  const notices = useRef<Set<string>>(new Set());
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  function showList(next: boolean) {
    setOpen(next);
    if (!next) return;
    for (const id of notices.current) toast.dismiss(id);
    notices.current.clear();
  }

  useEffect(() => {
    if (!data) return;
    if (announced.current === null) {
      announced.current = new Set(data.alerts.map((alert) => alert._id));
      return;
    }
    for (const alert of data.alerts) {
      if (announced.current.has(alert._id)) continue;
      announced.current.add(alert._id);
      // Already in front of them in the open list.
      if (alert.seen || openRef.current) continue;
      const id = `alert-${alert._id}`;
      (alert.kind === "run_failed" ? toast.error : toast.info)(alertTitle(alert), {
        id,
        description: alertDetail(alert),
        duration: 15_000,
        onDismiss: () => notices.current.delete(id),
        onAutoClose: () => notices.current.delete(id),
        action: {
          label: LOOK[alert.kind].action,
          onClick: () => {
            void markSeen({ organizationId: team.id, alertId: alert._id });
            router.push(alert.href);
          },
        },
      });
      notices.current.add(id);
    }
  }, [data, markSeen, router, team.id]);

  const unseen = data?.unseen ?? 0;

  return (
    <Popover open={open} onOpenChange={showList}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-alerts-bell>
          <Bell />
          {unseen > 0 && (
            <span
              data-alerts-count
              className="bg-destructive absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-medium text-white tabular-nums"
            >
              {unseen > 9 ? "9+" : unseen}
            </span>
          )}
          <span className="sr-only">
            {unseen > 0 ? `Alerts, ${unseen} you have not seen` : "Alerts"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <h2 className="text-sm font-medium">Alerts</h2>
          {unseen > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="-mr-2 h-7"
              onClick={() => void markSeen({ organizationId: team.id })}
            >
              Mark all as seen
            </Button>
          )}
        </div>
        {!data || data.alerts.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-sm">
            Nothing to report. Failed runs, approvals for you and mentions show up here. Choose what
            you hear about in{" "}
            <Link
              href="/settings/notifications"
              className="underline"
              onClick={() => showList(false)}
            >
              Settings
            </Link>
            .
          </p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {data.alerts.map((alert) => (
              <li key={alert._id} className="">
                <Link
                  href={alert.href}
                  data-alert={alert.seen ? "seen" : "new"}
                  data-alert-kind={alert.kind}
                  className={cn(
                    "hover:bg-muted/60 flex gap-3 px-4 py-3 outline-none focus-visible:bg-muted/60",
                    !alert.seen && LOOK[alert.kind].wash,
                  )}
                  onClick={() => {
                    showList(false);
                    if (!alert.seen) void markSeen({ organizationId: team.id, alertId: alert._id });
                  }}
                >
                  <AlertIcon kind={alert.kind} seen={alert.seen} />
                  <span className="grid min-w-0 gap-0.5">
                    <span className={cn("truncate text-sm", !alert.seen && "font-medium")}>
                      {alertTitle(alert)}
                    </span>
                    <span className="text-muted-foreground line-clamp-2 text-xs break-words">
                      {alertDetail(alert)}
                    </span>
                    <span className="text-muted-foreground text-xs">{when.format(alert.at)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function AlertIcon({ kind, seen }: { kind: Kind; seen: boolean }) {
  const { icon: Icon, tint } = LOOK[kind];
  return (
    <Icon
      className={cn("mt-0.5 size-4 shrink-0", seen ? "text-muted-foreground" : tint)}
      aria-hidden="true"
    />
  );
}
