"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";

import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration } from "@/lib/catalog";

import { MediaPreview } from "./media-preview";
import { StatusBadge } from "./status-badge";

const WAITING = {
  queued: "Sending the job to your toolkit.",
  running: "Your toolkit is working on it. This updates by itself when it finishes.",
} as const;

/** One job, live: its status, then its files and data once the toolkit reports back. */
export function JobResult({ jobId }: { jobId: Id<"jobs"> }) {
  const job = useQuery(api.jobs.get, { jobId });

  if (job === undefined) return <Skeleton className="h-24 rounded-lg" />;
  if (job === null) return <p className="text-muted-foreground text-sm">This job is gone.</p>;

  const took =
    job.finishedAt && job.startedAt ? formatDuration(job.finishedAt - job.startedAt) : null;
  const hasData = job.result !== undefined && typeof job.result !== "string";

  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <div className="flex items-center gap-3">
        <StatusBadge status={job.status} />
        {took && <span className="text-muted-foreground text-sm">Took {took}</span>}
      </div>

      {(job.status === "queued" || job.status === "running") && (
        <p className="text-muted-foreground text-sm">{WAITING[job.status]}</p>
      )}

      {job.status === "failed" && <p className="text-destructive text-sm">{job.error}</p>}

      {job.outputs.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {job.outputs.map((url) => (
            <MediaPreview key={url} url={url} />
          ))}
        </div>
      )}

      {job.status === "done" && hasData && (
        <details className="group" open={job.outputs.length === 0}>
          <summary className="text-muted-foreground cursor-pointer text-sm">Returned data</summary>
          <pre className="bg-surface mt-2 max-h-96 overflow-auto rounded-lg p-3 text-xs">
            {JSON.stringify(job.result, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
