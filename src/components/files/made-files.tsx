"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronRight, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { RunStatusBadge } from "@/components/automations/run-status";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { nodeTitle, RUN_TRIGGER_LABELS } from "@/lib/automations";
import { errorMessage, stepTitle } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { MediaPreview, OutputNamesProvider } from "@/components/jobs/media-preview";

type RunOutputs = FunctionReturnType<typeof api.outputs.byRun>["page"][number];
type FileGroup = RunOutputs["finished"][number];

const PAGE = 10;
const ALL = "all";
const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const countOf = (groups: FileGroup[]) => groups.reduce((sum, group) => sum + group.files.length, 0);
const files = (count: number) => (count === 1 ? "1 file" : `${count} files`);

function groupTitle(group: FileGroup): string {
  return nodeTitle({
    kind: group.kind as Parameters<typeof nodeTitle>[0]["kind"],
    stepId: group.stepId ?? undefined,
    label: group.label ?? undefined,
  });
}

/** Opens a review room with these files, so the team can look at them together. */
function useSendToReview() {
  const team = useActiveTeam();
  const createReview = useMutation(api.reviews.create);
  const router = useRouter();
  const [sending, setSending] = useState<string | null>(null);
  async function send(key: string, title: string, urls: string[], names: Record<string, string>) {
    setSending(key);
    try {
      const reviewId = await createReview({ organizationId: team.id, title, urls, names });
      router.push(`/review/${reviewId}`, { transitionTypes: ["nav-forward"] });
    } catch (error) {
      toast.error(errorMessage(error, "The review could not be opened."));
      setSending(null);
    }
  }
  return { sending, send };
}

const HAND = "hand";

/**
 * The files automations and steps made, newest first, by the run that made them. Lives on
 * the Files page beside the folders, so there is one place for every file.
 */
export function MadeFiles() {
  const team = useActiveTeam();
  const [madeBy, setMadeBy] = useState(ALL);
  const automations = useQuery(api.automations.list, { organizationId: team.id });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={madeBy} onValueChange={setMadeBy}>
          <SelectTrigger aria-label="Made by" className="min-w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All automations</SelectItem>
            {(automations ?? []).map((item) => (
              <SelectItem key={item._id} value={item._id}>
                {item.name}
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value={HAND}>Steps run by hand</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {madeBy === HAND ? <ByHand /> : <ByRun automation={madeBy} />}
    </div>
  );
}

function ByRun({ automation }: { automation: string }) {
  const team = useActiveTeam();
  const { results, status, loadMore } = usePaginatedQuery(
    api.outputs.byRun,
    {
      organizationId: team.id,
      ...(automation === ALL ? {} : { automationId: automation as Id<"automations"> }),
    },
    { initialNumItems: PAGE },
  );
  const review = useSendToReview();

  // Runs that made no files are left out of each page, so keep looking further back until
  // a page's worth is showing or there are no more runs.
  useEffect(() => {
    if (status === "CanLoadMore" && results.length < PAGE) loadMore(PAGE);
  }, [status, results.length, loadMore]);

  return (
    <div className="flex flex-col gap-4">
      {results.length === 0 && status !== "Exhausted" ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : results.length === 0 ? (
        <Empty
          text={
            automation === ALL
              ? "No files yet. They show up here as soon as an automation's step finishes."
              : "This automation has not made any files yet."
          }
          href="/automations"
          action="Go to Automations"
        />
      ) : (
        results.map((run) => <RunCard key={run.runId} run={run} review={review} />)
      )}
      <More status={status} onMore={() => loadMore(PAGE)} />
    </div>
  );
}

function RunCard({ run, review }: { run: RunOutputs; review: ReturnType<typeof useSendToReview> }) {
  const finishedCount = countOf(run.finished);
  const alongCount = countOf(run.along);
  const how = run.test ? "Test of one step" : RUN_TRIGGER_LABELS[run.triggerKind];
  const title = run.startedWith ? `${run.automationName}: ${run.startedWith}` : run.automationName;
  const toReview = run.finished.flatMap((group) => group.files);

  return (
    <OutputNamesProvider names={run.names}>
      <section
        aria-label={`${run.automationName}, ${when.format(run.startedAt)}`}
        className="flex flex-col gap-4 rounded-xl bg-surface p-4"
      >
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">
                <Link
                  href={`/automations/${run.automationId}`}
                  transitionTypes={["nav-forward"]}
                  className="hover:underline"
                >
                  {run.automationName}
                </Link>
              </h2>
              {run.status !== "done" && <RunStatusBadge status={run.status} />}
            </div>
            <p className="text-muted-foreground text-sm">
              {run.startedWith ? (
                <>
                  From <span className="text-foreground font-medium">{run.startedWith}</span>
                  {" · "}
                </>
              ) : null}
              {how} · {when.format(run.startedAt)} · {files(finishedCount + alongCount)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="ghost">
              <Link
                href={`/automations/${run.automationId}/runs/${run.runId}`}
                transitionTypes={["nav-forward"]}
              >
                See the run
              </Link>
            </Button>
            {toReview.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={review.sending !== null}
                onClick={() => review.send(run.runId, title, toReview, run.names)}
              >
                <MessagesSquare />
                Send to review
              </Button>
            )}
          </div>
        </header>

        {run.finished.map((group) => (
          <Group key={group.nodeId} group={group} />
        ))}

        {alongCount > 0 && (
          <Collapsible className="flex flex-col gap-3">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="group w-fit px-2">
                <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
                {run.finished.length > 0 ? "Made along the way" : "Made so far"} (
                {files(alongCount)})
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-4">
              {run.along.map((group) => (
                <Group key={group.nodeId} group={group} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </section>
    </OutputNamesProvider>
  );
}

function Group({ group }: { group: FileGroup }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">
        {groupTitle(group)}{" "}
        <span className="text-muted-foreground font-normal">· {files(group.files.length)}</span>
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {group.files.map((url) => (
          <MediaPreview key={url} url={url} />
        ))}
      </div>
    </div>
  );
}

function ByHand() {
  const team = useActiveTeam();
  const { results, status, loadMore } = usePaginatedQuery(
    api.outputs.byHand,
    { organizationId: team.id },
    { initialNumItems: PAGE },
  );
  const review = useSendToReview();

  if (status === "LoadingFirstPage") return <Skeleton className="h-48 rounded-xl" />;
  return (
    <div className="flex flex-col gap-4">
      {results.length === 0 ? (
        <Empty
          text="Nothing run by hand yet. Steps you run on their own from the Steps page show up here."
          href="/steps"
          action="Browse steps"
        />
      ) : (
        results.map((job) => (
          <section
            key={job.jobId}
            aria-label={stepTitle(job.stepId)}
            className="flex flex-col gap-3 rounded-xl bg-surface p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium">
                {stepTitle(job.stepId)}
                {job.finishedAt && (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    · {when.format(job.finishedAt)}
                  </span>
                )}
              </h2>
              <Button
                size="sm"
                variant="outline"
                disabled={review.sending !== null}
                onClick={() => review.send(job.jobId, stepTitle(job.stepId), job.urls, job.names)}
              >
                <MessagesSquare />
                Send to review
              </Button>
            </div>
            <OutputNamesProvider names={job.names}>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {job.urls.map((url) => (
                  <MediaPreview key={url} url={url} />
                ))}
              </div>
            </OutputNamesProvider>
          </section>
        ))
      )}
      <More status={status} onMore={() => loadMore(PAGE)} />
    </div>
  );
}

function More({ status, onMore }: { status: string; onMore: () => void }) {
  if (status === "CanLoadMore") {
    return (
      <Button variant="outline" className="self-center" onClick={onMore}>
        Load more
      </Button>
    );
  }
  if (status === "LoadingMore") {
    return <Skeleton className="h-9 w-28 self-center rounded-lg" />;
  }
  return null;
}

function Empty({ text, href, action }: { text: string; href: string; action: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl bg-surface p-6">
      <p className="text-muted-foreground text-sm">{text}</p>
      <Button asChild size="sm">
        <Link href={href}>{action}</Link>
      </Button>
    </div>
  );
}
