"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowRight, Circle, CircleAlert, Hourglass, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { RunStatusBadge } from "@/components/automations/run-status";
import { FailureText } from "@/components/failure-text";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const ago = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "5 minutes ago", "yesterday", or a date for anything older than a week. */
function since(at: number, now = Date.now()) {
  const minutes = Math.round((at - now) / 60_000);
  if (Math.abs(minutes) < 60) return ago.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return ago.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return ago.format(days, "day");
  return when.format(at);
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const id = `home-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className={cn("grid content-start gap-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="text-sm font-medium">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function HomeView() {
  const team = useActiveTeam();
  const summary = useQuery(api.home.summary, { organizationId: team.id });
  const approvals = useQuery(api.runs.waitingApprovals, { organizationId: team.id });
  const connections = useQuery(api.toolkitConnections.list, { organizationId: team.id });
  const loading = summary === undefined || approvals === undefined;
  // Processing that stopped answering is the only part of the toolkit Home ever mentions;
  // everything else about it lives in Settings.
  const processing = connections?.[0];
  const processingDown =
    connections !== undefined && (processing === undefined || processing.status !== "ok");
  const needsYou =
    (approvals?.length ?? 0) + (summary?.failures.length ?? 0) + (processingDown ? 1 : 0);

  return (
    <>
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{team.name}</h1>
        {summary === undefined ? (
          <Skeleton className="h-5 w-72" />
        ) : (
          <p className="text-muted-foreground text-sm text-pretty" data-testid="home-week">
            {weekSentence(summary)}
          </p>
        )}
      </div>

      {loading ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      ) : (
        // Two columns, like Stripe's and Vercel's overviews: what happened in the wide one,
        // getting started and the week's numbers in a narrow one on the right that stays at
        // the top. On a phone the narrow one comes first.
        <div className="reveal grid content-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <aside
            aria-label="Your team at a glance"
            className="grid content-start gap-8 lg:order-last"
          >
            <GettingStarted setup={summary.setup} />
            <Section title="This week">
              <dl className="bg-surface grid grid-cols-2 gap-px overflow-hidden rounded-xl">
                <Stat label="Runs" value={summary.week.runs} />
                <Stat label="Finished" value={summary.week.done} />
                <Stat label="Failed" value={summary.week.failed} tone={summary.week.failed > 0} />
                <Stat
                  label="Automations on"
                  value={summary.automations.on}
                  of={summary.automations.total}
                />
              </dl>
              <Button asChild variant="outline" className="justify-between">
                <Link href="/automations" transitionTypes={["nav-forward"]}>
                  {summary.automations.total === 0
                    ? "Your automations"
                    : `All ${plural(summary.automations.total, "automation")}`}
                  <ArrowRight />
                </Link>
              </Button>
            </Section>
          </aside>

          <div className="grid min-w-0 content-start gap-8">
            {needsYou > 0 && (
              <Section
                title="Needs you"
                action={
                  summary.failures.length > 0 && (
                    <Button asChild variant="ghost" size="sm">
                      <Link href="/runs?show=failed" transitionTypes={["nav-forward"]}>
                        Pick up failed runs
                        <ArrowRight />
                      </Link>
                    </Button>
                  )
                }
              >
                <ul className="bg-surface divide-background grid divide-y-2 rounded-xl">
                  {processingDown && (
                    <li className="flex items-center gap-3 px-4 py-3">
                      <CircleAlert
                        className="text-destructive size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <p className="min-w-0 flex-1 text-sm" data-testid="processing-status">
                        {processing === undefined
                          ? "Video processing is not set up yet."
                          : processing.ours
                            ? "Video processing is not answering right now. We're on it."
                            : "Video processing is not answering."}
                      </p>
                      {!processing?.ours && (
                        <Button asChild variant="outline" size="sm">
                          <Link href="/settings/toolkit" transitionTypes={["nav-forward"]}>
                            Open settings
                          </Link>
                        </Button>
                      )}
                    </li>
                  )}
                  {approvals.map((approval) => (
                    <li key={approval.runStepId} className="flex items-center gap-3 px-4 py-3">
                      <Hourglass
                        className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          <span className="font-medium">{approval.automationName}</span> is waiting
                          for approval
                          {approval.forYou && approval.asked.length > 0 && (
                            <span className="ml-2 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                              Asks you
                            </span>
                          )}
                        </p>
                        {approval.waitingSince && (
                          <p className="text-muted-foreground text-xs">
                            Since {since(approval.waitingSince)}
                          </p>
                        )}
                      </div>
                      <Button asChild variant="outline" size="sm">
                        <Link
                          href={`/automations/${approval.automationId}/runs/${approval.runId}`}
                          transitionTypes={["nav-forward"]}
                        >
                          Review
                        </Link>
                      </Button>
                    </li>
                  ))}
                  {summary.failures.map((run) => (
                    <li key={run.runId} className="flex items-center gap-3 px-4 py-3">
                      <TriangleAlert
                        className="text-destructive size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          <span className="font-medium">{run.automationName}</span> failed
                          {run.startedWith && <> on {run.startedWith}</>}
                          <span className="text-muted-foreground"> · {since(run.startedAt)}</span>
                        </p>
                        {run.error && (
                          <FailureText
                            className="text-muted-foreground line-clamp-1 text-xs"
                            text={run.error}
                          />
                        )}
                      </div>
                      <Button asChild variant="outline" size="sm">
                        <Link
                          href={`/automations/${run.automationId}/runs/${run.runId}`}
                          transitionTypes={["nav-forward"]}
                        >
                          See what happened
                        </Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section
              title="Latest runs"
              action={
                summary.recentRuns.length > 0 && (
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/runs" transitionTypes={["nav-forward"]}>
                      All runs
                      <ArrowRight />
                    </Link>
                  </Button>
                )
              }
            >
              {summary.recentRuns.length === 0 ? (
                <p className="bg-surface text-muted-foreground rounded-xl px-4 py-6 text-sm text-pretty">
                  Nothing has run yet. Runs show up here as soon as an automation starts, with what
                  it was working on.
                </p>
              ) : (
                <ul className="bg-surface grid rounded-xl p-1">
                  {summary.recentRuns.map((run) => (
                    <li key={run.runId}>
                      <Link
                        href={`/automations/${run.automationId}/runs/${run.runId}`}
                        transitionTypes={["nav-forward"]}
                        className="hover:bg-muted focus-visible:ring-ring/50 flex items-center gap-3 rounded-lg px-3 py-2.5 outline-none focus-visible:ring-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{run.automationName}</p>
                          <p className="text-muted-foreground truncate text-xs">
                            {run.startedWith ?? "Started without a file"} · {since(run.startedAt)}
                          </p>
                        </div>
                        <RunStatusBadge status={run.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      )}
    </>
  );
}

type Summary = FunctionReturnType<typeof api.home.summary>;

function weekSentence(summary: Summary) {
  const { automations, week } = summary;
  if (automations.total === 0)
    return "No automations yet. Start from a template on the Automations page.";
  const on =
    automations.on === 0
      ? "None of your automations are on yet."
      : `${plural(automations.on, "automation")} on.`;
  if (week.runs === 0) return `${on} Nothing has run this week.`;
  const failed = week.failed > 0 ? `, ${week.failed} failed` : "";
  return `${on} ${plural(week.runs, "run")} this week${failed}.`;
}

function Stat({
  label,
  value,
  of,
  tone = false,
}: {
  label: string;
  value: number;
  of?: number;
  tone?: boolean;
}) {
  return (
    <div className="bg-surface flex flex-col gap-0.5 px-4 py-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={cn("text-2xl font-semibold tabular-nums", tone && "text-destructive")}>
        {value}
        {of !== undefined && <span className="text-muted-foreground text-sm"> of {of}</span>}
      </dd>
    </div>
  );
}

function GettingStarted({ setup }: { setup: Summary["setup"] }) {
  // Only what a person does in the app. Connecting video processing is done for them, or in
  // Settings by those who run their own.
  const steps = [
    { done: setup.goals, label: "Tell us what you make", href: "/get-started" },
    { done: setup.brand, label: "Add your logo", href: "/settings/brand" },
    { done: setup.automationOn, label: "Switch on an automation", href: "/automations/new" },
    { done: setup.firstRun, label: "See your first run finish", href: "/library" },
  ];
  const done = steps.filter((step) => step.done).length;
  if (done === steps.length) return null;
  return (
    <Section title={`Getting started, ${done} of ${steps.length} done`}>
      <div className="bg-surface grid gap-1 rounded-xl p-1">
        <div
          role="progressbar"
          aria-label="Getting started"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done}
          className="bg-background mx-3 mt-3 mb-1 h-1.5 overflow-hidden rounded-full"
        >
          <div
            className="bg-primary h-full rounded-full transition-[width]"
            style={{ width: `${(done / steps.length) * 100}%` }}
          />
        </div>
        <ol className="grid">
          {steps
            .filter((step) => !step.done)
            .map((step) => (
              <li key={step.label}>
                <Link
                  href={step.href}
                  transitionTypes={["nav-forward"]}
                  className="hover:bg-muted focus-visible:ring-ring/50 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium outline-none focus-visible:ring-3"
                >
                  <Circle className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">{step.label}</span>
                  <ArrowRight className="text-muted-foreground size-4" aria-hidden="true" />
                </Link>
              </li>
            ))}
        </ol>
      </div>
    </Section>
  );
}
