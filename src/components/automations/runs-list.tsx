"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TRIGGER_LABELS } from "@/lib/automations";
import { formatDuration } from "@/lib/catalog";

import { RunStatusBadge } from "./run-status";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function RunsList({ automationId }: { automationId: Id<"automations"> }) {
  const runs = useQuery(api.runs.listForAutomation, { automationId });
  if (runs === undefined) return <Skeleton className="h-40 rounded-xl" />;
  if (runs.length === 0) {
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-sm">
        This automation has not run yet. Press Run now to try it.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Started</TableHead>
            <TableHead>Started by</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Took</TableHead>
            <TableHead>
              <span className="sr-only">Open</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run._id}>
              <TableCell className="font-medium">{when.format(run.startedAt)}</TableCell>
              <TableCell className="text-muted-foreground">
                {TRIGGER_LABELS[run.triggerKind]}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-2">
                  <RunStatusBadge status={run.status} />
                  {run.retries > 0 && (
                    <span className="text-muted-foreground text-xs">
                      {run.retries === 1 ? "Tried again once" : `Tried again ${run.retries} times`}
                    </span>
                  )}
                </div>
                {run.status === "failed" && run.error && (
                  <p
                    className="text-muted-foreground mt-1 max-w-md truncate text-xs"
                    title={run.error}
                  >
                    {run.error}
                  </p>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {run.finishedAt ? formatDuration(run.finishedAt - run.startedAt) : ""}
              </TableCell>
              <TableCell className="text-right">
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/automations/${automationId}/runs/${run._id}`}>
                    View<span className="sr-only"> run from {when.format(run.startedAt)}</span>
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
