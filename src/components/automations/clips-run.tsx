"use client";

import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { type ClipsSetup, type Frame, getPlatform } from "@ncat-dash/automation-core";
import type { FunctionReturnType } from "convex/server";
import { Check, CircleAlert, Copy, Download, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

import { fileNameOf } from "@/components/jobs/media-preview";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ApprovalWaitingNote } from "./approval-status";

type Run = NonNullable<FunctionReturnType<typeof api.runs.get>>;
type Step = Run["steps"][number];

type ClipState =
  | { state: "waiting" | "cutting" | "captioning" }
  | { state: "ready"; url: string }
  | { state: "failed" };

// The shape a clip's preview is drawn in.
const ASPECT: Record<Frame, string> = {
  "9:16": "aspect-[9/16]",
  "4:5": "aspect-[4/5]",
  "1:1": "aspect-square",
  "16:9": "aspect-video",
  original: "aspect-video",
};

function clipState(index: number, cut: Step | undefined, caption: Step | undefined): ClipState {
  const cutJob = cut?.stage === "cut" ? cut.jobs[index] : undefined;
  if (!cutJob || cutJob.status === "queued") return { state: "waiting" };
  if (cutJob.status === "running") return { state: "cutting" };
  // A clip whose job failed is waiting, not lost, while the step is due another try.
  if (cutJob.status === "failed") return { state: cut?.retryAt ? "waiting" : "failed" };
  if (!caption) {
    return cutJob.outputs[0] ? { state: "ready", url: cutJob.outputs[0] } : { state: "failed" };
  }
  if (caption.status === "skipped" || caption.status === "failed") return { state: "failed" };
  const captionJob = caption.jobs[index];
  if (captionJob?.status === "done" && captionJob.outputs[0]) {
    return { state: "ready", url: captionJob.outputs[0] };
  }
  if (captionJob?.status === "failed") {
    return { state: caption.retryAt ? "captioning" : "failed" };
  }
  return { state: "captioning" };
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

/** A clips run as a person wants to see it: how far along it is, and the clips. */
export function ClipsRun({
  run,
  setup,
  busy,
  onDecide,
}: {
  run: Run;
  setup: ClipsSetup;
  busy: boolean;
  onDecide: (runStepId: Id<"runSteps">, approved: boolean) => void;
}) {
  const byNode = new Map(run.steps.map((step) => [step.nodeId, step]));
  const cut = byNode.get("clips");
  const caption = setup.captions ? byNode.get("captions") : undefined;
  const approval = byNode.get("approval");
  const platform = getPlatform(setup.platform);
  const frame = platform?.frame ?? "original";
  const tall = frame === "9:16" || frame === "4:5";
  const shape = ASPECT[frame];
  const plan = cut?.plan ?? [];
  const clips = plan.map((clip, index) => ({ ...clip, ...clipState(index, cut, caption) }));
  const ready = clips.filter((clip) => clip.state === "ready").length;
  const active = run.status === "running" || run.status === "waiting";

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  const label =
    run.status === "failed"
      ? (run.error ?? "The run failed.")
      : run.status === "cancelled"
        ? "The run was stopped."
        : plan.length === 0
          ? "Reading the video and finding pauses in speech"
          : ready === plan.length
            ? approval?.status === "waiting_approval"
              ? `All ${plan.length} clips are ready for you to look at`
              : `All ${plan.length} clips are ready`
            : `${ready} of ${plan.length} clips ready`;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5 pb-8">
      <section className="grid gap-3 rounded-2xl bg-surface p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            aria-hidden="true"
            className={cn(
              "size-2.5 rounded-full",
              run.status === "done"
                ? "bg-emerald-500"
                : run.status === "failed" || run.status === "cancelled"
                  ? "bg-destructive"
                  : "bg-primary animate-pulse motion-reduce:animate-none",
            )}
          />
          <h2 className="text-xl font-semibold tracking-tight">{setup.platform}</h2>
          <span className="text-muted-foreground ml-auto font-mono text-sm tabular-nums">
            {clock(((run.finishedAt ?? now) - run.startedAt) / 1000)}
          </span>
        </div>
        {plan[0] && (
          <p className="text-muted-foreground truncate font-mono text-xs">
            {fileNameOf(plan[0].source)}
          </p>
        )}
        <p
          className={cn("text-sm", run.status === "failed" && "text-destructive flex gap-2")}
          aria-live="polite"
        >
          {run.status === "failed" && (
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          )}
          {label}
        </p>
        {plan.length > 0 ? (
          <div className="flex h-2 gap-1" aria-hidden="true">
            {clips.map((clip) => (
              <span
                key={clip.part}
                className={cn(
                  "flex-1 rounded-full transition-colors duration-500",
                  clip.state === "ready"
                    ? "bg-primary"
                    : clip.state === "failed"
                      ? "bg-destructive/60"
                      : clip.state === "waiting"
                        ? "bg-muted"
                        : "bg-primary/40 animate-pulse motion-reduce:animate-none",
                )}
              />
            ))}
          </div>
        ) : (
          active && (
            <div className="bg-muted h-2 overflow-hidden rounded-full" aria-hidden="true">
              <div className="bg-primary/60 h-full w-1/3 animate-pulse rounded-full motion-reduce:animate-none" />
            </div>
          )
        )}
        {approval?.status === "waiting_approval" && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <div className="mr-auto flex flex-col gap-0.5">
              <p className="text-muted-foreground text-sm">
                Happy with them? Approving finishes the run.
              </p>
              {approval.approval && <ApprovalWaitingNote view={approval.approval} />}
            </div>
            <Button
              size="sm"
              disabled={busy || approval.approval?.mayDecide === false}
              onClick={() => onDecide(approval._id, true)}
            >
              <Check />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || approval.approval?.mayDecide === false}
              onClick={() => onDecide(approval._id, false)}
            >
              <X />
              Reject
            </Button>
          </div>
        )}
      </section>

      <div className={cn("grid gap-4", tall ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2")}>
        {clips.map((clip) => (
          <section key={clip.part} className="grid content-start gap-3 rounded-2xl bg-surface p-4">
            <div className="text-muted-foreground flex items-center justify-between font-mono text-[11.5px]">
              <h3 className="text-foreground tracking-[0.08em] uppercase">
                Part {clip.part} of {clip.parts}
              </h3>
              <span>
                {clock(clip.seconds)} · from {clock(clip.start)}
              </span>
            </div>
            {clip.state === "ready" ? (
              <>
                <video
                  src={clip.url}
                  controls
                  preload="metadata"
                  className={cn("w-full rounded-lg bg-black", shape)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm">
                    <a href={clip.url} download target="_blank" rel="noreferrer">
                      <Download />
                      Download
                    </a>
                  </Button>
                  <CopyLink url={clip.url} />
                </div>
              </>
            ) : (
              <div
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg text-sm",
                  shape,
                  clip.state === "failed"
                    ? "bg-destructive/10 text-destructive"
                    : clip.state === "waiting"
                      ? "bg-muted text-muted-foreground"
                      : "bg-primary/10 font-medium",
                )}
              >
                {(clip.state === "cutting" || clip.state === "captioning") && (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                )}
                {clip.state === "cutting"
                  ? "Cutting now"
                  : clip.state === "captioning"
                    ? "Adding captions"
                    : clip.state === "failed"
                      ? "This clip did not finish"
                      : "Waiting its turn"}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
