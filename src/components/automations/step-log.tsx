"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { useFileName } from "@/components/jobs/media-preview";
import { FailureText } from "@/components/failure-text";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { formatDuration } from "@/lib/catalog";
import { cn } from "@/lib/utils";

import { RunStatusBadge } from "./run-status";

const clock = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });

/** How long a job waited for a free slot and how long the toolkit took, in words. */
export function jobTiming(job: {
  queuedAt: number;
  sentAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
}): string {
  const parts: string[] = [];
  const sent = job.sentAt ?? job.startedAt;
  if (sent === null) return "Waiting for a free slot";
  const waited = sent - job.queuedAt;
  // Under a second of waiting says nothing worth reading.
  if (waited >= 1000) parts.push(`waited ${formatDuration(waited)} for a free slot`);
  if (job.finishedAt !== null) {
    parts.push(`${formatDuration(Math.max(job.finishedAt - sent, 0))} on the toolkit`);
  } else {
    parts.push(`sent ${clock.format(sent)}`);
  }
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What a step sent, try by try: each job's settings, timing, toolkit id and error. */
export function StepLog({ runStepId, title }: { runStepId: Id<"runSteps">; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs">
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        {open ? "Hide what was sent" : "Show what was sent"}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {open && <LogBody runStepId={runStepId} title={title} />}
      </CollapsibleContent>
    </Collapsible>
  );
}

function LogBody({ runStepId, title }: { runStepId: Id<"runSteps">; title: string }) {
  const log = useQuery(api.runs.stepLog, { runStepId });
  const nameOf = useFileName();
  if (log === undefined) return <Spinner className="mt-2 size-4" />;
  if (log === null || (log.jobs.length === 0 && log.tries.length === 0)) {
    return (
      <p className="text-muted-foreground mt-2 text-sm">This step sent nothing to the toolkit.</p>
    );
  }
  return (
    <section aria-label={`What ${title} sent`} className="mt-2 flex flex-col gap-3">
      {log.tries.length > 0 && (
        <ol aria-label="Tries that failed" className="flex flex-col gap-1 text-sm">
          {log.tries.map((attempt, index) => (
            <li key={attempt.at} className="text-muted-foreground">
              <span className="text-foreground tabular-nums">
                Try {index + 1}, {clock.format(attempt.at)}:
              </span>{" "}
              <FailureText text={attempt.error} />
            </li>
          ))}
        </ol>
      )}
      <ol aria-label="Jobs" className="flex flex-col gap-2">
        {log.jobs.map((job) => (
          <li key={job._id} className="bg-background flex flex-col gap-1.5 rounded-lg p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-medium">
                {job.title}
                {job.file && (
                  <span className="text-muted-foreground font-normal"> · {nameOf(job.file)}</span>
                )}
              </p>
              <RunStatusBadge status={job.status === "queued" ? "pending" : job.status} />
            </div>
            <p className="text-muted-foreground text-xs tabular-nums">
              {jobTiming(job)}
              {job.toolkitJobId && <> · Toolkit job {job.toolkitJobId}</>}
            </p>
            {job.error && (
              <p className="text-destructive text-sm">
                <FailureText text={job.error} />
                {job.permanent && " The toolkit refused it, so it was not tried again."}
              </p>
            )}
            <pre className="text-muted-foreground max-h-48 overflow-auto text-xs whitespace-pre-wrap break-all">
              {JSON.stringify(job.input, null, 2)}
            </pre>
          </li>
        ))}
      </ol>
      {log.more && (
        <p className="text-muted-foreground text-xs">Only the first 100 jobs are listed.</p>
      )}
    </section>
  );
}
