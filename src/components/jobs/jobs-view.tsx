"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { FileVideo } from "lucide-react";
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
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ItemBadge, ItemList, ItemRow, MetaLine, Pager, usePages } from "@/components/ui/item-list";
import { formatDuration, stepHref, stepTitle } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { exactly, timeAgo } from "@/lib/when";

import { JobResult } from "./job-result";
import { StatusBadge } from "./status-badge";
import { waitingWords } from "./waiting-words";

const startedAt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function JobsView() {
  const team = useActiveTeam();
  const jobs = useQuery(api.jobs.list, { organizationId: team.id });
  const [openId, setOpenId] = useState<Id<"jobs"> | null>(null);
  const open = jobs?.find((job) => job._id === openId) ?? null;
  const { shown, pager } = usePages(jobs ?? [], "jobs");

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
        <div className="flex flex-col gap-4">
          <ItemList label="Jobs">
            {shown.map((job) => {
              const title = stepTitle(job.stepId);
              const files = job.outputs.length;
              return (
                <ItemRow
                  key={job._id}
                  data-job={job._id}
                  name={title}
                  onOpen={() => setOpenId(job._id)}
                  openLabel={`${title} job, started ${startedAt.format(job._creationTime)}`}
                  meta={
                    <MetaLine>
                      <span title={exactly(job._creationTime)}>
                        Started {timeAgo(job._creationTime)}
                      </span>
                      {job.finishedAt && job.startedAt && (
                        <span>Took {formatDuration(job.finishedAt - job.startedAt)}</span>
                      )}
                      {job.waiting && <span>{waitingWords(job.waiting)}</span>}
                    </MetaLine>
                  }
                  badges={
                    <>
                      {files > 0 && (
                        <ItemBadge title={files === 1 ? "1 file made" : `${files} files made`}>
                          <FileVideo aria-hidden="true" />
                          {files}
                          <span className="sr-only">{files === 1 ? " file" : " files"}</span>
                        </ItemBadge>
                      )}
                      <StatusBadge status={job.status} />
                    </>
                  }
                  menuLabel={`More for the ${title} job`}
                  menu={
                    <>
                      <DropdownMenuItem onSelect={() => setOpenId(job._id)}>
                        View details
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href={stepHref(job.stepId)}>Run this step again</Link>
                      </DropdownMenuItem>
                    </>
                  }
                />
              );
            })}
          </ItemList>
          <Pager {...pager} noun="jobs" />
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
                  <Link href={stepHref(open.stepId)}>Run this step again</Link>
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
