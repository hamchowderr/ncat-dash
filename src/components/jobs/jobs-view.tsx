"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration, stepTitle } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { JobResult } from "./job-result";
import { StatusBadge } from "./status-badge";

const startedAt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function JobsView() {
  const team = useActiveTeam();
  const jobs = useQuery(api.jobs.list, { organizationId: team.id });
  const [openId, setOpenId] = useState<Id<"jobs"> | null>(null);
  const open = jobs?.find((job) => job._id === openId) ?? null;

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="text-muted-foreground text-sm">
          Every step you have run, newest first. Statuses update by themselves.
        </p>
      </div>

      {jobs === undefined ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl bg-surface p-6">
          <p className="text-muted-foreground text-sm">
            Nothing has run yet. Pick a step and try it on a sample file.
          </p>
          <Button asChild size="sm">
            <Link href="/steps">Browse steps</Link>
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Step</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Took</TableHead>
                <TableHead>Files</TableHead>
                <TableHead>
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job._id}>
                  <TableCell className="font-medium">{stepTitle(job.stepId)}</TableCell>
                  <TableCell>
                    <StatusBadge status={job.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {startedAt.format(job._creationTime)}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {job.finishedAt && job.startedAt
                      ? formatDuration(job.finishedAt - job.startedAt)
                      : ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {job.outputs.length || ""}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setOpenId(job._id)}>
                      View<span className="sr-only"> {stepTitle(job.stepId)} job</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={open !== null} onOpenChange={(next) => !next && setOpenId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle>{stepTitle(open.stepId)}</SheetTitle>
                <SheetDescription>Started {startedAt.format(open._creationTime)}</SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-6 px-4 pb-6">
                <JobResult jobId={open._id} />
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">Input</h3>
                  <pre className="bg-surface max-h-72 overflow-auto rounded-lg p-3 text-xs">
                    {JSON.stringify(open.input, null, 2)}
                  </pre>
                </div>
                <Button asChild variant="outline" size="sm" className="self-start">
                  <Link href={`/steps/${open.stepId}`}>Run this step again</Link>
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
