"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { type Starter, STARTERS } from "@ncat-dash/automation-core";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowRight, CircleAlert, Circle, Hourglass, RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { RunStatusBadge } from "@/components/automations/run-status";
import { TemplateCard } from "@/components/automations/template-gallery";
import { FailureText } from "@/components/failure-text";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
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

/** One ready-made automation from each kind of job, to start from on the home page. */
const FEATURED = [
  "social-clips",
  "every-shape",
  "podcast-master",
  "music-release-pack",
  "delivery-pass",
  "branded-clip",
]
  .map((id) => STARTERS.find((starter) => starter.id === id))
  .filter((starter): starter is Starter => starter !== undefined);

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
  const router = useRouter();
  const summary = useQuery(api.home.summary, { organizationId: team.id });
  const approvals = useQuery(api.runs.waitingApprovals, { organizationId: team.id });
  const connections = useQuery(api.toolkitConnections.list, { organizationId: team.id });
  const create = useMutation(api.automations.create);
  const [starting, setStarting] = useState(false);

  async function start(starter: Starter) {
    setStarting(true);
    try {
      const id = await create({
        organizationId: team.id,
        name: starter.name,
        starterId: starter.id,
      });
      router.push(`/automations/${id}`, { transitionTypes: ["nav-forward"] });
    } catch (caught) {
      toast.error(errorMessage(caught, "The automation could not be created. Try again."));
      setStarting(false);
    }
  }

  const loading = summary === undefined || approvals === undefined;
  const needsYou = (approvals?.length ?? 0) + (summary?.failures.length ?? 0);
  // Until something is switched on, ready-made automations lead the page.
  const readyFirst = summary !== undefined && summary.automations.on === 0;

  const ready = (
    <Section
      title="Ready-made automations"
      action={
        <Button asChild variant="ghost" size="sm">
          <Link href="/automations/new" transitionTypes={["nav-forward"]}>
            See all {STARTERS.length}
            <ArrowRight />
          </Link>
        </Button>
      }
    >
      <p className="text-muted-foreground -mt-1 text-sm text-pretty">
        Switch one on and it runs by itself on every file, with plain editing steps. No AI is spent
        on each video.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {FEATURED.map((starter) => (
          <TemplateCard
            key={starter.id}
            starter={starter}
            disabled={starting}
            onPick={() => start(starter)}
          />
        ))}
      </div>
    </Section>
  );

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
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
        <ToolkitStatus connections={connections} />
      </div>

      {loading ? (
        <div className="grid gap-4">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : (
        <div className="reveal grid gap-8">
          {needsYou > 0 && (
            <Section title="Needs you">
              <ul className="bg-surface divide-background grid divide-y-2 rounded-xl">
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

          <GettingStarted setup={summary.setup} />

          {readyFirst && ready}

          <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Section
              title="Latest runs"
              action={
                summary.recentRuns.length > 0 && (
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/outputs" transitionTypes={["nav-forward"]}>
                      Everything made
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
          </div>

          {!readyFirst && ready}
        </div>
      )}
    </>
  );
}

type Summary = FunctionReturnType<typeof api.home.summary>;

function weekSentence(summary: Summary) {
  const { automations, week } = summary;
  if (automations.total === 0) return "No automations yet. Start from a ready-made one below.";
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
  const steps = [
    {
      done: setup.toolkit,
      label: "Connect your toolkit",
      detail: "Its address and API key.",
      href: "/onboarding",
    },
    {
      done: setup.bucket,
      label: "Find the toolkit's file storage",
      detail: "Uploads and finished files are kept there. Check your toolkit again to find it.",
      href: "/uploads",
    },
    {
      done: setup.brand,
      label: "Add your logo",
      detail: "Set once, then every automation that needs it uses it.",
      href: "/settings/brand",
    },
    {
      done: setup.automationOn,
      label: "Switch on an automation",
      detail: "Start from a ready-made one and switch it on.",
      href: "/automations/new",
    },
    {
      done: setup.firstRun,
      label: "See your first run finish",
      detail: "Upload a file, or press Run now on an automation.",
      href: "/uploads",
    },
  ];
  const left = steps.filter((step) => !step.done).length;
  if (left === 0) return null;
  return (
    <Section title={`Getting started, ${steps.length - left} of ${steps.length} done`}>
      <ol className="bg-surface grid rounded-xl p-1">
        {steps
          .filter((step) => !step.done)
          .map((step) => (
            <li key={step.label}>
              <Link
                href={step.href}
                transitionTypes={["nav-forward"]}
                className="hover:bg-muted focus-visible:ring-ring/50 flex items-center gap-3 rounded-lg px-3 py-2.5 outline-none focus-visible:ring-3"
              >
                <Circle className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{step.label}</span>
                  <span className="text-muted-foreground block text-xs">{step.detail}</span>
                </span>
                <ArrowRight className="text-muted-foreground size-4" aria-hidden="true" />
              </Link>
            </li>
          ))}
      </ol>
    </Section>
  );
}

type Connection = {
  _id: Id<"toolkitConnections">;
  baseUrl: string;
  apiKeyHint: string;
  status: "ok" | "failing";
  buildNumber: string | null;
  bucket: string | null;
  lastCheckedAt: number;
  lastError: string | null;
};

/** The toolkit's state in one line, with the details and a fresh check one click away. */
function ToolkitStatus({ connections }: { connections: Connection[] | undefined }) {
  const recheck = useAction(api.toolkitConnections.recheck);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  if (connections === undefined) return <Skeleton className="h-8 w-48" />;
  const connection = connections[0];
  if (!connection) {
    return (
      <Button asChild size="sm">
        <Link href="/onboarding">Connect your toolkit</Link>
      </Button>
    );
  }
  const ok = connection.status === "ok";

  async function onRecheck() {
    setChecking(true);
    try {
      const result = await recheck({ connectionId: connection._id });
      if (result.ok) toast.success("Your toolkit is connected.");
      else toast.error("Your toolkit did not pass the check.");
    } catch {
      toast.error("The check could not run. Try again in a moment.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="hover:bg-muted focus-visible:ring-ring/50 flex items-center gap-2 rounded-md px-2 py-1 text-sm outline-none focus-visible:ring-3"
        >
          {ok ? (
            <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
          ) : (
            <CircleAlert className="text-destructive size-4" aria-hidden="true" />
          )}
          <span data-testid="connection-status">
            {ok ? "Toolkit connected" : "Toolkit not responding"}
          </span>
        </button>
        <Button variant="ghost" size="sm" disabled={checking} onClick={onRecheck}>
          <RefreshCw className={checking ? "animate-spin" : ""} />
          {checking ? "Checking" : "Check again"}
        </Button>
      </div>
      {(open || !ok) && (
        <div className="bg-surface reveal grid w-full max-w-md gap-2 rounded-xl px-4 py-3 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
            <dt className="text-muted-foreground">Address</dt>
            <dd className="break-all">{connection.baseUrl}</dd>
            <dt className="text-muted-foreground">API key</dt>
            <dd>Ends in {connection.apiKeyHint}</dd>
            {connection.buildNumber && (
              <>
                <dt className="text-muted-foreground">Toolkit build</dt>
                <dd>{connection.buildNumber}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Files</dt>
            <dd>
              {connection.bucket
                ? `Kept in the toolkit's bucket, ${connection.bucket}`
                : "Check again to find the toolkit's storage"}
            </dd>
            <dt className="text-muted-foreground">Last checked</dt>
            <dd>{since(connection.lastCheckedAt)}</dd>
          </dl>
          {!ok && connection.lastError && (
            <FailureText className="text-destructive" text={connection.lastError} />
          )}
        </div>
      )}
    </div>
  );
}
