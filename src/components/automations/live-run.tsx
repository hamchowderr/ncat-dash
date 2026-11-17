"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { logicNote } from "./run-steps";
import { type ShownStepStatus, shownStatus, StatusIcon } from "./run-status";

type Latest = NonNullable<FunctionReturnType<typeof api.runs.latestForAutomation>>;

/** How long a finished run is still pointed to on the canvas. */
const RECENT_MS = 2 * 60_000;

/** What the canvas shows on one step while a run goes through it. */
export type LiveStep = { status: ShownStepStatus; jobCount: number; note?: string };

/**
 * The automation's newest run while it goes: each step's state by node, for the canvas,
 * and the run itself, for the badge. Steps are empty once the run has finished.
 */
export function useLiveRun(automationId: Id<"automations">) {
  const latest = useQuery(api.runs.latestForAutomation, { automationId }) ?? null;
  const active = latest !== null && (latest.status === "running" || latest.status === "waiting");
  // One map per change to the run, so the canvas only redraws when the run moves on.
  const steps = useMemo(() => {
    const byNode = new Map<string, LiveStep>();
    if (!active) return byNode;
    for (const step of latest.steps) {
      byNode.set(step.nodeId, {
        status: shownStatus(step),
        jobCount: step.jobCount,
        note: logicNote(step) ?? undefined,
      });
    }
    return byNode;
  }, [latest, active]);
  return { latest, active, steps };
}

/** Whether a finished run ended recently enough to still point to, rechecked as time passes. */
function useRecent(finishedAt: number | undefined): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!finishedAt) return;
    const left = finishedAt + RECENT_MS - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), left + 50);
    return () => clearTimeout(timer);
  }, [finishedAt]);
  return finishedAt !== undefined && now - finishedAt < RECENT_MS;
}

const ENDED: Record<string, string> = {
  done: "Last run finished",
  failed: "Last run failed",
  cancelled: "Last run was stopped",
};

/**
 * A small badge in the bar above the canvas: "Running now" with how far the run has got while it goes,
 * then for a couple of minutes how it ended. Either way it opens the run.
 */
export function LiveRunBadge({
  automationId,
  latest,
  active,
}: {
  automationId: Id<"automations">;
  latest: Latest | null;
  active: boolean;
}) {
  const recent = useRecent(latest?.finishedAt ?? undefined);
  if (!latest || (!active && !recent)) return null;
  const finished = latest.steps.filter((step) =>
    ["done", "skipped", "failed"].includes(step.status),
  ).length;
  const waiting = latest.status === "waiting";
  return (
    <Link
      href={`/automations/${automationId}/runs/${latest._id}`}
      role="status"
      aria-live="polite"
      data-live-run={active ? "running" : latest.status}
      className={cn(
        "bg-background hover:bg-muted focus-visible:ring-ring/50 flex max-w-full min-w-0 items-center gap-2 overflow-hidden rounded-full py-1 shadow-xs pr-2.5 pl-3 text-xs whitespace-nowrap outline-none focus-visible:ring-3 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300",
      )}
    >
      {active ? (
        <span className="relative flex size-2" aria-hidden="true">
          <span
            className={cn(
              "absolute inline-flex size-full rounded-full opacity-75 motion-safe:animate-ping",
              waiting ? "bg-amber-500" : "bg-emerald-500",
            )}
          />
          <span
            className={cn(
              "relative inline-flex size-2 rounded-full",
              waiting ? "bg-amber-500" : "bg-emerald-500",
            )}
          />
        </span>
      ) : (
        <StatusIcon
          status={latest.status === "cancelled" ? "skipped" : (latest.status as ShownStepStatus)}
          className="size-3.5"
        />
      )}
      <span className="truncate font-medium">
        {active ? (waiting ? "Waiting for approval" : "Running now") : ENDED[latest.status]}
      </span>
      {active && (
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {finished} of {latest.steps.length} steps
        </span>
      )}
      <span className="text-muted-foreground flex shrink-0 items-center gap-0.5">
        {active ? "Watch" : "Open"}
        <ArrowRight className="size-3" aria-hidden="true" />
      </span>
    </Link>
  );
}
