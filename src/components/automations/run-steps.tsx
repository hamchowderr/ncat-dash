"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  type AutomationEdge,
  type AutomationNode,
  BRANCH_LABELS,
  FAILURE_WAY,
  failsOver,
  IF_BRANCHES,
  waitsForRun,
} from "@ncat-dash/automation-core";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowUpRight,
  Check,
  FileText,
  MessagesSquare,
  Music,
  Play,
  Workflow,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { MediaPreview, OutputNamesProvider, useFileName } from "@/components/jobs/media-preview";
import { FailureText } from "@/components/failure-text";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { nodeTitle, RUN_TRIGGER_LABELS } from "@/lib/automations";
import { formatDuration } from "@/lib/catalog";
import { cn } from "@/lib/utils";

import { ApprovalWaitingNote, decidedSentence } from "./approval-status";
import { nodeLook, RUN_TRIGGER_ICONS, TRIGGER_ID, TRIGGER_TINT } from "./flow-nodes";
import { RunStatusBadge, shownStatus } from "./run-status";

export type RunDetails = NonNullable<FunctionReturnType<typeof api.runs.get>>;
type RunStep = RunDetails["steps"][number];

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const timeOnly = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

/** How many files a step shows before pointing to Outputs for the rest. */
const FILES_SHOWN = 8;

const VIDEO = /\.(mp4|mov|webm|mkv|m4v)(\?|$)/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i;
const IMAGE = /\.(png|jpe?g|gif|webp|avif)(\?|$)/i;

/** A moment as a person says it: just the time when it is today, the date too when it is not. */
export function until(moment: number): string {
  const today = new Date().toDateString() === new Date(moment).toDateString();
  return today ? timeOnly.format(moment) : when.format(moment);
}

/**
 * What a logic step did, in a few words: which way an If sent its files, or when a Wait
 * carries on. Null for every other step.
 */
export function logicNote(step: {
  status: string;
  branches?: Record<string, string[]>;
  stage?: string;
  resumeAt?: number;
}): string | null {
  if (step.branches) {
    const went = IF_BRANCHES.filter((way) => (step.branches?.[way]?.length ?? 0) > 0);
    const total = went.reduce((sum, way) => sum + step.branches![way].length, 0);
    if (total === 1) return `Went ${BRANCH_LABELS[went[0]]}`;
    return went.map((way) => `${step.branches![way].length} ${BRANCH_LABELS[way]}`).join(", ");
  }
  if (step.stage === "check" && step.status === "running") return "Reading the files";
  if (step.stage === "wait" && step.status === "running" && step.resumeAt) {
    return `Until ${until(step.resumeAt)}`;
  }
  return null;
}

/** What an If did with its files, as a sentence. */
function sortedSentence(branches: Record<string, string[]>): string {
  const counts = IF_BRANCHES.map(
    (way) => [BRANCH_LABELS[way], branches[way]?.length ?? 0] as const,
  );
  const total = counts.reduce((sum, [, count]) => sum + count, 0);
  if (total === 1) return `The file went out by ${counts.find(([, count]) => count === 1)![0]}.`;
  return `${counts
    .map(([label, count]) => `${count} ${count === 1 ? "file" : "files"} went out by ${label}`)
    .join(", ")}.`;
}

/** One line under a step's name saying what happened there. */
function stepSentence(
  node: AutomationNode,
  step: RunStep,
  runStatus: string,
  failsOver = false,
): string {
  if (step.status === "skipped") {
    return runStatus === "cancelled" ? "The run was stopped first." : "No files came this way.";
  }
  if (step.status === "pending") return "Not reached yet.";
  if (node.off) return "Turned off, so its files went straight on.";
  if (node.kind === "if" && step.branches) return sortedSentence(step.branches);
  if (node.kind === "wait" && step.resumeAt) {
    return step.status === "done"
      ? `Carried on at ${until(step.resumeAt)}.`
      : `Carries on at ${until(step.resumeAt)}.`;
  }
  const note = logicNote(step);
  if (note) return `${note}.`;
  if (step.status === "waiting_approval") return "Waiting for someone to check the files.";
  if (node.kind === "automation" && step.status !== "failed") {
    if (step.status === "running") return "Waiting for its run to finish.";
    return waitsForRun(node)
      ? "Its run finished, and its files carried on from here."
      : "Started its run, and carried on without waiting.";
  }
  if (node.kind === "approval") {
    return step.status === "done" ? "Approved." : step.status === "failed" ? "Not approved." : "";
  }
  if (step.status === "running") {
    if (step.retryAt) return "Waiting to try again.";
    const finished = step.jobs.filter((job) => job.status === "done").length;
    return step.jobs.length > 1
      ? `${finished} of ${step.jobs.length} files finished.`
      : "Working on it.";
  }
  if (step.status === "failed") {
    return failsOver ? "Failed, so its files went the way for when it fails." : "Stopped here.";
  }
  const made = node.kind === "step" ? step.outputs.length : 0;
  if (made === 1) return "Made 1 file.";
  if (made > 1) return `Made ${made} files.`;
  return "Finished.";
}

/** Counts down to a step's next try. */
function RetryCountdown({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = at - now;
  return <>{left > 0 ? `in ${formatDuration(left)}` : "now"}</>;
}

/** Points to the room an approval step opened, where the team can watch and comment first. */
function ReviewLink({ runStepId }: { runStepId: Id<"runSteps"> }) {
  const reviewId = useQuery(api.reviews.forStep, { runStepId });
  if (!reviewId) return null;
  return (
    <Button asChild size="sm" variant="outline">
      <Link href={`/review/${reviewId}`} transitionTypes={["nav-forward"]}>
        <MessagesSquare />
        Open the review room
      </Link>
    </Button>
  );
}

/** A small picture of one file a step made. Choosing it plays the file in a larger view. */
function FileTile({ url, onOpen }: { url: string; onOpen: () => void }) {
  const name = useFileName()(url);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group hover:bg-muted focus-visible:ring-ring/50 flex w-full flex-col overflow-hidden rounded-lg bg-background text-left shadow-xs outline-none focus-visible:ring-[3px]"
      >
        <span className="bg-muted relative grid aspect-video place-items-center overflow-hidden">
          {VIDEO.test(url) ? (
            <>
              <video
                src={`${url}#t=0.5`}
                preload="metadata"
                muted
                playsInline
                tabIndex={-1}
                className="pointer-events-none absolute inset-0 size-full bg-black object-cover"
              />
              <span className="relative grid size-8 place-items-center rounded-full bg-black/55 text-white transition-transform group-hover:scale-110">
                <Play className="size-3.5 fill-current" aria-hidden="true" />
              </span>
            </>
          ) : IMAGE.test(url) ? (
            // Result files live on the customer's own storage, so the domain is not known ahead of time.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt=""
              loading="lazy"
              className="absolute inset-0 size-full object-cover"
            />
          ) : AUDIO.test(url) ? (
            <Music className="text-muted-foreground size-5" aria-hidden="true" />
          ) : (
            <FileText className="text-muted-foreground size-5" aria-hidden="true" />
          )}
        </span>
        <span className="truncate px-2 py-1.5 text-xs font-medium" title={name}>
          {name}
        </span>
      </button>
    </li>
  );
}

/** What a step found out, as labelled lines. Nothing when it found out nothing. */
export function StepFacts({ facts }: { facts: { label: string; value: string }[] }) {
  if (facts.length === 0) return null;
  return (
    <dl className="bg-muted/40 grid gap-x-6 gap-y-2 rounded-lg px-3 py-2.5 text-sm sm:grid-cols-[max-content_1fr]">
      {facts.map((fact) => (
        <div key={fact.label} className="contents">
          <dt className="text-muted-foreground">{fact.label}</dt>
          <dd className="min-w-0 break-words">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The files a step made, as small tiles. Choosing one plays it larger. Past a handful,
 * the rest are left to Outputs.
 */
export function StepFiles({
  label,
  files,
  className,
}: {
  label: string;
  files: string[];
  className?: string;
}) {
  const [playing, setPlaying] = useState<string | null>(null);
  const nameOf = useFileName();
  if (files.length === 0) return null;
  return (
    <>
      <ul
        aria-label={label}
        className={cn(
          "grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]",
          className,
        )}
      >
        {files.slice(0, FILES_SHOWN).map((url, at) => (
          <FileTile key={`${at}-${url}`} url={url} onOpen={() => setPlaying(url)} />
        ))}
      </ul>
      {files.length > FILES_SHOWN && (
        <p className="text-muted-foreground text-sm">
          And {files.length - FILES_SHOWN} more in{" "}
          <Link href="/outputs" className="underline underline-offset-4">
            Outputs
          </Link>
          .
        </p>
      )}
      <Dialog open={playing !== null} onOpenChange={(open) => !open && setPlaying(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogTitle className="truncate pr-8 text-sm">
            {playing ? nameOf(playing) : ""}
          </DialogTitle>
          {playing && <MediaPreview url={playing} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * What went along each line of a run, by "source>target": the files a finished step handed
 * on that way (for an If, only those that left by that way out), and the starting file
 * for lines from the trigger. Lines whose step has not finished are left out.
 */
export function passedAlong(run: {
  trigger: unknown;
  edges: { source: string; target: string; branch?: string }[];
  nodes: { id: string }[];
  steps: {
    nodeId: string;
    status: string;
    outputs: string[];
    branches?: Record<string, string[]>;
  }[];
}): Map<string, string[]> {
  const byNode = new Map(run.steps.map((step) => [step.nodeId, step]));
  const passed = new Map<string, string[]>();
  for (const edge of run.edges) {
    const from = byNode.get(edge.source);
    // A step that failed hands the files it was given to its way for when it fails.
    if (from?.status === "failed" && edge.branch === FAILURE_WAY) {
      passed.set(`${edge.source}>${edge.target}`, from.outputs);
      continue;
    }
    if (from?.status !== "done" || edge.branch === FAILURE_WAY) continue;
    const files = from.branches
      ? edge.branch
        ? (from.branches[edge.branch] ?? [])
        : Object.values(from.branches).flat()
      : from.outputs;
    passed.set(`${edge.source}>${edge.target}`, files);
  }
  const fileUrl = (run.trigger as { file_url?: unknown } | null)?.file_url;
  const fed = new Set(run.edges.map((edge) => edge.target));
  for (const node of run.nodes) {
    if (fed.has(node.id)) continue;
    passed.set(`${TRIGGER_ID}>${node.id}`, typeof fileUrl === "string" && fileUrl ? [fileUrl] : []);
  }
  return passed;
}

/** The files that reached a step, from every line into it. */
function receivedBy(nodeId: string, passed: Map<string, string[]>): string[] {
  return [...passed].flatMap(([key, files]) => (key.endsWith(`>${nodeId}`) ? files : []));
}

/** "a.mp4, b.mp4 and 3 more". */
function fileList(files: string[], nameOf: (url: string) => string): string {
  const names = files.slice(0, 2).map(nameOf);
  return files.length > 2
    ? `${names.join(", ")} and ${files.length - 2} more`
    : names.join(" and ");
}

/** Puts steps in the order the canvas reads, left to right and then top to bottom. */
function inCanvasOrder(nodes: AutomationNode[]): AutomationNode[] {
  return [...nodes].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
}

/** "3 done, 1 skipped": the run at a glance. */
function tally(steps: RunStep[]): string {
  const words: [string, string][] = [
    ["done", "done"],
    ["running", "running"],
    ["waiting_approval", "waiting for approval"],
    ["failed", "failed"],
    ["skipped", "skipped"],
    ["pending", "not reached"],
  ];
  return words
    .map(([status, word]) => [steps.filter((step) => step.status === status).length, word] as const)
    .filter(([count]) => count > 0)
    .map(([count, word]) => `${count} ${word}`)
    .join(", ");
}

/**
 * What happened in a run, step by step in the canvas's order: one row per step with what
 * it did, how long it took, what it found out and the files it made.
 */
export function RunSteps({
  run,
  highlighted,
  busy,
  onDecide,
}: {
  run: RunDetails;
  /** The step chosen on the canvas, shown marked. */
  highlighted: string | null;
  busy: boolean;
  onDecide: (runStepId: Id<"runSteps">, approved: boolean) => void;
}) {
  const byNode = new Map(run.steps.map((step) => [step.nodeId, step]));
  const rows = inCanvasOrder(run.nodes as AutomationNode[]).filter((node) => byNode.has(node.id));
  const TriggerIcon = RUN_TRIGGER_ICONS[run.triggerKind];
  const passed = passedAlong({
    trigger: run.trigger,
    edges: run.edges as { source: string; target: string; branch?: string }[],
    nodes: run.nodes,
    steps: run.steps,
  });

  return (
    <OutputNamesProvider names={run.outputNames}>
      <section aria-labelledby="run-steps-title" className="rounded-xl bg-surface">
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
          <h2 id="run-steps-title" className="text-sm font-semibold">
            What happened
          </h2>
          <p className="text-muted-foreground text-xs">{tally(run.steps)}</p>
        </header>

        <ol className="py-2">
          <Row
            icon={<TriggerIcon className={cn("size-4", TRIGGER_TINT)} aria-hidden="true" />}
            title={run.testOf ? "Test of one step" : RUN_TRIGGER_LABELS[run.triggerKind]}
            sentence={
              run.startedWith ? (
                <>
                  Started with{" "}
                  <span className="text-foreground font-medium">{run.startedWith}</span>
                </>
              ) : (
                "Started this run."
              )
            }
            aside={<span className="tabular-nums">{until(run.startedAt)}</span>}
            last={rows.length === 0}
          />
          {rows.map((node, index) => {
            const step = byNode.get(node.id)!;
            const look = nodeLook(node);
            const Icon = look.icon;
            const quiet = step.status === "skipped" || step.status === "pending";
            const took =
              // Under a second says nothing worth reading, so it is left out.
              step.startedAt && step.finishedAt && step.finishedAt - step.startedAt >= 1000
                ? formatDuration(step.finishedAt - step.startedAt)
                : null;
            // A step joining others that have not all finished says which it is waiting for.
            const sources = (run.edges as AutomationEdge[])
              .filter((edge) => edge.target === node.id)
              .map((edge) => edge.source);
            const unfinished = sources.filter((source) =>
              ["pending", "running", "waiting_approval"].includes(byNode.get(source)?.status ?? ""),
            );
            const waitingFor =
              step.status === "pending" && sources.length > 1 && unfinished.length < sources.length
                ? unfinished.flatMap((source) => {
                    const other = run.nodes.find((candidate) => candidate.id === source);
                    return other ? [nodeTitle(other as AutomationNode)] : [];
                  })
                : [];
            // Only what the step made: not what it handed on while off or after failing.
            const files =
              (node.kind === "step" || (node.kind === "automation" && waitsForRun(node))) &&
              !node.off &&
              step.status !== "failed"
                ? step.outputs
                : [];
            const child = step.childRunId
              ? run.startedRuns.find((started) => started.runId === step.childRunId)
              : undefined;
            return (
              <Row
                key={node.id}
                stepId={node.id}
                quiet={quiet}
                marked={highlighted === node.id}
                last={index === rows.length - 1}
                icon={<Icon className={cn("size-4", look.tint)} aria-hidden="true" />}
                title={nodeTitle(node)}
                sentence={
                  waitingFor.length > 0
                    ? `Waiting for ${waitingFor.join(" and ")} to finish.`
                    : stepSentence(
                        node,
                        step,
                        run.status,
                        failsOver(node.id, run.edges as AutomationEdge[]),
                      )
                }
                got={quiet ? undefined : receivedBy(node.id, passed)}
                aside={
                  <>
                    {took && <span className="tabular-nums">{took}</span>}
                    <RunStatusBadge status={shownStatus(step)} />
                  </>
                }
              >
                {step.retryAt && step.status === "running" && (
                  <div data-retry="waiting" className="flex flex-col gap-0.5 text-sm">
                    <p className="font-medium tabular-nums">
                      Trying again <RetryCountdown at={step.retryAt} />, try {step.retries + 1} of{" "}
                      {Math.max(run.retryLimit, step.retries) + 1}
                    </p>
                    {step.retryError && (
                      <FailureText
                        className="text-muted-foreground"
                        lead="The last try failed: "
                        text={step.retryError}
                      />
                    )}
                  </div>
                )}
                {step.retries > 0 && !step.retryAt && step.status !== "skipped" && (
                  <p data-retry="used" className="text-muted-foreground text-sm">
                    {step.status === "done"
                      ? `Worked on try ${step.retries + 1}.`
                      : step.status === "failed"
                        ? `Gave up after ${step.retries + 1} tries.`
                        : `On try ${step.retries + 1}.`}
                  </p>
                )}
                {step.error && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      <FailureText text={step.error} />
                    </AlertDescription>
                  </Alert>
                )}
                {step.approval &&
                  (step.status === "done" ||
                    (step.status === "failed" && !step.approval.decidedAutomatically)) &&
                  decidedSentence(step.approval, step.status === "done") && (
                    <p className="text-muted-foreground text-sm" data-decided>
                      {decidedSentence(step.approval, step.status === "done")}
                    </p>
                  )}
                {step.status === "waiting_approval" && step.approval && (
                  <ApprovalWaitingNote view={step.approval} />
                )}
                {step.status === "waiting_approval" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      disabled={busy || step.approval?.mayDecide === false}
                      onClick={() => onDecide(step._id, true)}
                    >
                      <Check />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || step.approval?.mayDecide === false}
                      onClick={() => onDecide(step._id, false)}
                    >
                      <X />
                      Reject
                    </Button>
                    <ReviewLink runStepId={step._id} />
                  </div>
                )}
                {child && <StartedRunLink run={child} />}
                {/* A logic step reads its files only to decide; that is not news to anyone. */}
                {node.kind === "step" && <StepFacts facts={step.facts} />}
                <StepFiles label={`Files from ${nodeTitle(node)}`} files={files} />
              </Row>
            );
          })}
        </ol>
      </section>
    </OutputNamesProvider>
  );
}

/** A link to a run another run started, or was started by. */
export function StartedRunLink({
  run,
  lead = "Run of",
}: {
  run: RunDetails["startedRuns"][number];
  lead?: string;
}) {
  return (
    <Link
      href={`/automations/${run.automationId}/runs/${run.runId}`}
      className="hover:bg-muted -mx-1 inline-flex w-fit items-center gap-2 rounded-md px-1 py-0.5 text-sm"
      data-run-link={run.runId}
    >
      <Workflow className="text-muted-foreground size-4" aria-hidden="true" />
      <span>
        {lead} <span className="font-medium">{run.automationName}</span>
      </span>
      <RunStatusBadge status={run.status} />
      <ArrowUpRight className="text-muted-foreground size-3.5" aria-hidden="true" />
    </Link>
  );
}

/** One line of the run: an icon on the thread that joins the steps, what happened, and any detail below. */
function Row({
  stepId,
  icon,
  title,
  sentence,
  got,
  aside,
  quiet = false,
  marked = false,
  last = false,
  children,
}: {
  stepId?: string;
  icon: React.ReactNode;
  title: string;
  sentence: React.ReactNode;
  /** The files that reached the step. */
  got?: string[];
  aside: React.ReactNode;
  quiet?: boolean;
  marked?: boolean;
  last?: boolean;
  children?: React.ReactNode;
}) {
  const nameOf = useFileName();
  return (
    <li
      data-step={stepId}
      data-marked={marked || undefined}
      className={cn(
        "relative grid scroll-mt-24 grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 px-4 py-2.5 transition-colors duration-500",
        marked && "bg-primary/5",
      )}
    >
      {!last && (
        <span
          aria-hidden="true"
          className="bg-border absolute top-[2.875rem] -bottom-2.5 left-[2.125rem] w-px -translate-x-1/2"
        />
      )}
      <span
        className={cn(
          "bg-background relative grid size-9 place-items-center rounded-lg shadow-xs",
          quiet && "opacity-50",
        )}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
          <div className={cn("grid min-w-0 flex-1", quiet && "opacity-60")}>
            <h3 className="truncate text-sm font-medium">{title}</h3>
            {got && got.length > 0 && (
              <p
                className="text-muted-foreground truncate text-xs"
                data-got
                title={got.map(nameOf).join(", ")}
              >
                Got {fileList(got, nameOf)}
              </p>
            )}
            <p className="text-muted-foreground text-sm" data-note>
              {sentence}
            </p>
          </div>
          <div className="text-muted-foreground flex shrink-0 items-center gap-3 text-xs">
            {aside}
          </div>
        </div>
        {children}
      </div>
    </li>
  );
}
