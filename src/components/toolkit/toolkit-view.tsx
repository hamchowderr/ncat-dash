"use client";

import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CircleAlert, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

type Reading = FunctionReturnType<typeof api.toolkitHealth.read>;
type Health = Extract<Reading, { ok: true }>["health"];
type Activity = FunctionReturnType<typeof api.toolkitHealth.activity>;

/** How often the page reads the toolkit again while it is open and in view. */
export const READ_EVERY_MS = 10_000;
// Above this share of CPU or memory the tile turns amber, and says what it means.
const BUSY = 85;

export function bytes(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

export function uptime(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} days`;
}

function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)} min ago`;
}

/** Reads the toolkit now and then every READ_EVERY_MS while the tab is in view. */
function useHealth(organizationId: string) {
  const read = useAction(api.toolkitHealth.read);
  const [reading, setReading] = useState<Reading | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      setReading(await read({ organizationId }));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [read, organizationId]);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, READ_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  return { reading, failed, busy, refresh };
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The Toolkit page: how busy the team's toolkit server is (CPU, memory, disk, its
 * queue), its build, and every job of the team's it is working on now, like a hosting
 * dashboard's resource view beside a job queue's.
 */
/** A team on a toolkit run for it has nothing to look after here; its own team does. */
export function ToolkitView() {
  const team = useActiveTeam();
  const shown = useQuery(api.toolkitHealth.shown, { organizationId: team.id });
  if (shown === undefined) return <Skeleton className="h-64 rounded-xl" />;
  if (!shown) return <RunForYou />;
  return <ToolkitDetails />;
}

function RunForYou() {
  return (
    <div className="flex w-full flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Toolkit</h1>
      <div className="bg-surface flex flex-col items-start gap-3 rounded-xl p-6">
        <p className="text-muted-foreground max-w-prose text-sm">
          Your toolkit is run for you, so there is no server here to look after. Your runs and jobs
          are on the Runs and Jobs pages.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href="/runs">See your runs</Link>
        </Button>
      </div>
    </div>
  );
}

function ToolkitDetails() {
  const team = useActiveTeam();
  const connections = useQuery(api.toolkitConnections.list, { organizationId: team.id });
  const activity = useQuery(api.toolkitHealth.activity, { organizationId: team.id });
  const { reading, failed, busy, refresh } = useHealth(team.id);
  const now = useNow();
  const connection = connections?.[0];

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Toolkit</h1>
          <p className="text-muted-foreground max-w-prose truncate text-sm">
            {connection
              ? `${connection.baseUrl}${reading?.ok && reading.health.buildNumber ? ` · build ${reading.health.buildNumber}` : connection.buildNumber ? ` · build ${connection.buildNumber}` : ""}`
              : "How busy your toolkit is, and what it is working on for your team."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {reading && (
            <span className="text-muted-foreground text-xs" data-testid="checked">
              Checked {ago(reading.checkedAt, now)}
            </span>
          )}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw className={busy ? "animate-spin" : ""} />
            Check now
          </Button>
        </div>
      </div>

      <ServerLoad reading={reading} failed={failed} />

      <TeamJobs activity={activity} now={now} />
    </div>
  );
}

function ServerLoad({ reading, failed }: { reading: Reading | null; failed: boolean }) {
  if (failed && !reading) {
    return <Problem text="The toolkit could not be checked. Try again in a moment." />;
  }
  if (!reading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }
  if (!reading.ok) {
    if (reading.reason === "no_toolkit") {
      return (
        <div className="bg-surface flex flex-col items-start gap-3 rounded-xl p-6">
          <p className="text-muted-foreground text-sm">No toolkit is connected yet.</p>
          <Button asChild size="sm">
            <Link href="/onboarding?toolkit=connect">Connect your toolkit</Link>
          </Button>
        </div>
      );
    }
    const text = {
      hosted: "This toolkit is run for you, so its load is not shown here.",
      unreachable: "The toolkit did not answer at its address. It may be restarting or stopped.",
      unauthorized: "The toolkit no longer accepts the saved key. Connect it again with its key.",
      no_health:
        "This toolkit build does not report its load yet. Update it to the latest build of the toolkit to see CPU, memory and its queue here.",
      error: "The toolkit answered with an error when asked how busy it is.",
    }[reading.reason];
    return <Problem text={text} />;
  }
  return <LoadTiles health={reading.health} />;
}

function Problem({ text }: { text: string }) {
  return (
    <p
      role="alert"
      className="bg-surface text-destructive flex items-start gap-2 rounded-xl px-5 py-4 text-sm"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {text}
    </p>
  );
}

function Tile({
  label,
  value,
  detail,
  percent,
  warning,
}: {
  label: string;
  value: string;
  detail: string;
  percent?: number;
  warning?: string | null;
}) {
  return (
    <section aria-label={label} className="bg-surface flex flex-col gap-2 rounded-xl px-5 py-4">
      <h2 className="text-muted-foreground text-sm">{label}</h2>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {percent !== undefined && (
        <Progress
          value={percent}
          aria-label={`${label} in use`}
          className={cn(
            "h-1.5",
            percent >= BUSY && "[&>[data-slot=progress-indicator]]:bg-amber-500",
          )}
        />
      )}
      <p className="text-muted-foreground text-xs">{detail}</p>
      {warning && <p className="text-xs text-amber-700 dark:text-amber-300">{warning}</p>}
    </section>
  );
}

export function LoadTiles({ health }: { health: Health }) {
  const memoryPercent =
    health.memory.limit > 0 ? Math.round((health.memory.used / health.memory.limit) * 100) : 0;
  const diskUsed = health.disk ? health.disk.total - health.disk.free : 0;
  const diskPercent =
    health.disk && health.disk.total > 0 ? Math.round((diskUsed / health.disk.total) * 100) : 0;
  const { queue, jobs } = health;
  return (
    <div className="reveal grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="CPU"
          value={`${Math.round(health.cpuPercent)}%`}
          percent={health.cpuPercent}
          detail={`Of ${health.cpus} ${health.cpus === 1 ? "CPU" : "CPUs"} · running for ${uptime(health.uptimeSeconds)}`}
          warning={
            health.cpuPercent >= BUSY
              ? "Busy. New jobs wait their turn; long videos take longer."
              : null
          }
        />
        <Tile
          label="Memory"
          value={bytes(health.memory.used)}
          percent={memoryPercent}
          detail={`Of ${bytes(health.memory.limit)} · ${memoryPercent}% in use`}
          warning={
            memoryPercent >= BUSY
              ? "Nearly full. A long video can fail when memory runs out."
              : null
          }
        />
        <Tile
          label="Space for work files"
          value={health.disk ? `${bytes(health.disk.free)} free` : "Unknown"}
          percent={health.disk ? diskPercent : undefined}
          detail={health.disk ? `Of ${bytes(health.disk.total)}` : "The toolkit did not say."}
          warning={
            health.disk && diskPercent >= 90
              ? "Nearly full. Big videos need room while they are worked on."
              : null
          }
        />
        <Tile
          label="Queue"
          value={
            queue.shared && queue.waiting !== null
              ? `${queue.waiting} waiting`
              : `${jobs.queued} waiting`
          }
          detail={
            queue.shared && queue.workers !== null
              ? `${queue.busy ?? 0} of ${queue.workers} ${queue.workers === 1 ? "worker" : "workers"} busy`
              : "Each toolkit process keeps its own queue"
          }
        />
      </div>
      <p className="text-muted-foreground text-xs" data-testid="everyone">
        Everyone using this toolkit, last hour: {jobs.running} running, {jobs.queued} waiting,{" "}
        {jobs.done} finished.
      </p>
    </div>
  );
}

const STATE_WORDS: Record<Activity["jobs"][number]["state"], string> = {
  toolkit: "With the toolkit",
  sending: "Being sent",
  held: "Waiting for a free slot",
};

export function TeamJobs({ activity, now }: { activity: Activity | undefined; now: number }) {
  if (activity === undefined) return <Skeleton className="h-48 rounded-xl" />;
  const { counts, lastDay } = activity;
  return (
    <section aria-label="Your team's jobs" className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="grid gap-0.5">
          <h2 className="text-base font-semibold">Your team&apos;s jobs now</h2>
          <p className="text-muted-foreground text-sm">
            Up to {activity.limit} go to the toolkit at once. Change it in{" "}
            <Link href="/settings/runs" className="underline underline-offset-2">
              Settings, under Runs
            </Link>
            .
          </p>
        </div>
        <p className="text-muted-foreground text-sm" data-testid="last-day">
          Last 24 hours: {lastDay.done} finished, {lastDay.failed} failed
          {lastDay.typicalMs !== null && `, usually ${formatDuration(lastDay.typicalMs)} each`}
        </p>
      </div>
      {activity.jobs.length === 0 ? (
        <p className="bg-surface text-muted-foreground rounded-xl px-5 py-8 text-sm">
          Nothing is being worked on for your team right now. Jobs show up here while they run.
        </p>
      ) : (
        <div className="reveal overflow-hidden rounded-xl bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Step</TableHead>
                <TableHead>Run</TableHead>
                <TableHead>Where it is</TableHead>
                <TableHead>For</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activity.jobs.map((job) => (
                <TableRow key={job._id} data-job={job._id}>
                  <TableCell className="font-medium">{job.step}</TableCell>
                  <TableCell>
                    {job.run ? (
                      <Link
                        href={`/automations/${job.run.automationId}/runs/${job.run.runId}`}
                        transitionTypes={["nav-forward"]}
                        className="underline-offset-2 hover:underline"
                      >
                        {job.run.automationName}
                      </Link>
                    ) : (
                      <Link href="/jobs" className="text-muted-foreground hover:underline">
                        Run by hand
                      </Link>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{STATE_WORDS[job.state]}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatDuration(now - job.since)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {activity.more > 0 && (
            <p className="text-muted-foreground px-4 py-3 text-xs">And {activity.more} more.</p>
          )}
        </div>
      )}
      <p className="sr-only">
        {counts.toolkit} with the toolkit, {counts.sending} being sent, {counts.held} waiting for a
        free slot.
      </p>
    </section>
  );
}
