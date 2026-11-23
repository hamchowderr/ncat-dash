"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowRight, Check, CheckCheck, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { AlertIcon, alertDetail, alertTitle, type Kind, LOOK } from "./alert-look";

type Alert = FunctionReturnType<typeof api.alerts.list>["alerts"][number];

/** The views across the top of the Inbox, each a set of kinds. */
export const VIEWS = [
  { id: "all", label: "All", kinds: null },
  { id: "needs-you", label: "Needs you", kinds: ["approval_waiting", "rights_ending"] },
  { id: "failed", label: "Failed runs", kinds: ["run_failed", "approval_timed_out"] },
  {
    id: "mentions",
    label: "Mentions and feedback",
    kinds: ["mention", "client_feedback", "ready_for_review"],
  },
] as const satisfies readonly { id: string; label: string; kinds: readonly Kind[] | null }[];

type ViewId = (typeof VIEWS)[number]["id"];

const EMPTY: Record<ViewId, string> = {
  all: "Nothing to report. Failed runs, approvals waiting for you and mentions show up here.",
  "needs-you": "Nothing is waiting for you. Approvals you are asked to decide show up here.",
  failed: "No failed runs. If a run fails, even after its retries, it shows up here.",
  mentions:
    "No mentions yet. When someone names you in a review, or a client comments, it shows up here.",
};

function inView(view: ViewId, alert: Alert): boolean {
  const kinds = VIEWS.find((each) => each.id === view)?.kinds;
  return !kinds || (kinds as readonly string[]).includes(alert.kind);
}

const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const day = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function startOfDay(at: number) {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today", "Yesterday", "Earlier this week" or "Earlier": the heading an alert sits under. */
export function dayGroup(at: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Earlier this week";
  return "Earlier";
}

/** The time beside an alert: the hour today, the weekday this week, the date before. */
export function alertTime(at: number, now = Date.now()): string {
  const group = dayGroup(at, now);
  if (group === "Today" || group === "Yesterday") return time.format(at);
  if (group === "Earlier this week") return `${day.format(at)}, ${time.format(at)}`;
  return date.format(at);
}

/** The time now, moved on each minute, so "Today" turns into "Yesterday" at midnight. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The Inbox: everything the team's automations and reviews had to tell the person, newest
 * first, in one place they open from the menu. Opening an alert takes them where it
 * happened and counts it as seen.
 */
export function InboxView() {
  const team = useActiveTeam();
  const data = useQuery(api.alerts.list, { organizationId: team.id });
  const markSeen = useMutation(api.alerts.markSeen);
  const [view, setView] = useState<ViewId>("all");
  const now = useMinute();

  const seen = (alertId?: Id<"alerts">) =>
    void markSeen(alertId ? { organizationId: team.id, alertId } : { organizationId: team.id });

  const alerts = data?.alerts ?? [];
  const shown = alerts.filter((alert) => inView(view, alert));
  const groups: { label: string; alerts: Alert[] }[] = [];
  for (const alert of shown) {
    const label = dayGroup(alert.at, now);
    const last = groups.at(-1);
    if (last?.label === label) last.alerts.push(alert);
    else groups.push({ label, alerts: [alert] });
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="text-muted-foreground max-w-prose text-sm">
            Failed runs, approvals waiting for you and mentions, newest first.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {(data?.unseen ?? 0) > 0 && (
            <Button variant="ghost" size="sm" onClick={() => seen()}>
              <CheckCheck />
              Mark all as seen
            </Button>
          )}
          <Button variant="ghost" size="sm" asChild>
            <Link href="/settings/notifications">
              <SlidersHorizontal />
              Choose what you hear about
            </Link>
          </Button>
        </div>
      </div>

      <div role="tablist" aria-label="Show" className="flex flex-wrap gap-1.5">
        {VIEWS.map((each) => {
          const unseen = alerts.filter((alert) => !alert.seen && inView(each.id, alert)).length;
          const active = view === each.id;
          return (
            <button
              key={each.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setView(each.id)}
              className={cn(
                "focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm outline-none transition-colors focus-visible:ring-3",
                active
                  ? "bg-foreground text-background"
                  : "bg-surface text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {each.label}
              {unseen > 0 && <span className="sr-only">{`, ${unseen} new`}</span>}
              {unseen > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "min-w-5 rounded-full px-1.5 text-xs leading-5 font-medium tabular-nums",
                    active ? "bg-background/20" : "bg-destructive text-white",
                  )}
                >
                  {unseen}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!data ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground bg-surface rounded-xl px-5 py-8 text-sm">
          {EMPTY[view]}
        </p>
      ) : (
        <div className="reveal grid gap-6">
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="grid gap-1">
              <h2 className="text-muted-foreground px-3 pb-1 text-xs font-medium">{group.label}</h2>
              <ul className="grid gap-1">
                {group.alerts.map((alert) => (
                  <InboxRow
                    key={alert._id}
                    alert={alert}
                    now={now}
                    onSeen={() => seen(alert._id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function InboxRow({ alert, now, onSeen }: { alert: Alert; now: number; onSeen: () => void }) {
  return (
    <li
      className={cn(
        "group hover:bg-muted/60 focus-within:bg-muted/60 relative flex items-center gap-2 rounded-xl pr-2 transition-colors",
        !alert.seen && LOOK[alert.kind].wash,
      )}
    >
      <Link
        href={alert.href}
        data-alert={alert.seen ? "seen" : "new"}
        data-alert-kind={alert.kind}
        className="flex min-w-0 flex-1 gap-3 rounded-xl px-3 py-3 outline-none"
        onClick={() => {
          if (!alert.seen) onSeen();
        }}
      >
        <AlertIcon kind={alert.kind} seen={alert.seen} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex items-baseline justify-between gap-3">
            <span className={cn("truncate text-sm", !alert.seen && "font-medium")}>
              {alertTitle(alert)}
            </span>
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
              {alertTime(alert.at, now)}
            </span>
          </span>
          <span className="text-muted-foreground line-clamp-2 text-sm break-words">
            {alertDetail(alert)}
          </span>
          <span className="text-foreground/80 mt-1 inline-flex items-center gap-1 text-xs font-medium">
            {LOOK[alert.kind].action}
            <ArrowRight className="size-3" aria-hidden="true" />
          </span>
        </span>
      </Link>
      {!alert.seen && (
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-8 shrink-0"
          onClick={onSeen}
          title="Mark as seen"
        >
          <Check />
          <span className="sr-only">Mark as seen: {alertTitle(alert)}</span>
        </Button>
      )}
    </li>
  );
}
