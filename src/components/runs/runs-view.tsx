"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { explainFailure } from "@ncat-dash/automation-core";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { StepForward } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { RunStatusBadge } from "@/components/automations/run-status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RUN_TRIGGER_LABELS } from "@/lib/automations";
import { errorMessage, formatDuration } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

type Row = FunctionReturnType<typeof api.runs.listForTeam>["runs"][number];
type Show = "all" | "failed";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function pickedUpWords(count: number, withCurrentSettings?: boolean) {
  const runs = count === 1 ? "run" : "runs";
  return withCurrentSettings === false
    ? `Picked up the ${runs}. The automation's steps have changed since, so it carries on with the steps it had.`
    : `Picked up ${count === 1 ? "the run" : `${count} runs`} where ${count === 1 ? "it" : "they"} stopped.`;
}

/**
 * Every run across the team's automations, newest first, like an automation tool's run
 * history. The Failed view lists the runs that failed, each with the step it stopped at,
 * and picks them up from that step, one at a time or all at once.
 */
export function RunsView() {
  const team = useActiveTeam();
  const router = useRouter();
  const pathname = usePathname();
  const show: Show = useSearchParams().get("show") === "failed" ? "failed" : "all";
  const data = useQuery(api.runs.listForTeam, { organizationId: team.id, status: show });
  const pickUp = useMutation(api.runs.pickUp);
  const pickUpMany = useMutation(api.runs.pickUpMany);
  const [chosen, setChosen] = useState<Set<Id<"runs">>>(new Set());
  const [busy, setBusy] = useState(false);

  const runs = data?.runs ?? [];
  const pickable = runs.filter((run) => run.canPickUp);
  // Runs that were chosen and are still waiting to be picked up.
  const picked = pickable.filter((run) => chosen.has(run._id));

  function choose(next: Show) {
    setChosen(new Set());
    router.replace(next === "failed" ? `${pathname}?show=failed` : pathname);
  }

  async function act(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (caught) {
      toast.error(errorMessage(caught, "The runs could not be picked up."));
    } finally {
      setBusy(false);
    }
  }

  const pickUpOne = (run: Row) =>
    act(async () => {
      const result = await pickUp({ runId: run._id });
      toast.success(pickedUpWords(1, result.withCurrentSettings));
    });

  const pickUpChosen = () =>
    act(async () => {
      const result = await pickUpMany({
        organizationId: team.id,
        // Nothing chosen: every failed run that can be picked up.
        ...(picked.length > 0 ? { runIds: picked.map((run) => run._id) } : {}),
      });
      setChosen(new Set());
      if (result.pickedUp === 0) toast.info("None of these runs could be picked up.");
      else {
        toast.success(
          `${pickedUpWords(result.pickedUp)}${result.more ? " Press again for the rest." : ""}`,
        );
      }
    });

  const allChosen = pickable.length > 0 && picked.length === pickable.length;

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
        <p className="text-muted-foreground max-w-prose text-sm">
          Every run across your automations, newest first. A run that failed can pick up from the
          step it stopped at, keeping what already worked.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Show" className="flex flex-wrap gap-1.5">
          {(["all", "failed"] as const).map((each) => {
            const active = show === each;
            const count = each === "failed" ? (data?.failedCount ?? 0) : 0;
            return (
              <button
                key={each}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => choose(each)}
                className={cn(
                  "focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm outline-none transition-colors focus-visible:ring-3",
                  active
                    ? "bg-foreground text-background"
                    : "bg-surface text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {each === "all" ? "All runs" : "Failed"}
                {count > 0 && (
                  <span
                    className={cn(
                      "min-w-5 rounded-full px-1.5 text-xs leading-5 font-medium tabular-nums",
                      active ? "bg-background/20" : "bg-destructive text-white",
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {show === "failed" && pickable.length > 0 && (
          <Button size="sm" disabled={busy} onClick={pickUpChosen}>
            <StepForward />
            {picked.length > 0
              ? `Pick up ${picked.length} chosen`
              : pickable.length === 1
                ? "Pick up the failed run"
                : `Pick up all ${pickable.length}`}
          </Button>
        )}
      </div>

      {data === undefined ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : runs.length === 0 ? (
        <p className="text-muted-foreground bg-surface rounded-xl px-5 py-8 text-sm">
          {show === "failed"
            ? "No failed runs. If a run fails, even after its retries, it shows up here."
            : "Nothing has run yet. Runs show up here as soon as an automation starts."}
        </p>
      ) : (
        <div className="reveal overflow-hidden rounded-xl bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                {show === "failed" && (
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Choose every run that can be picked up"
                      disabled={pickable.length === 0}
                      checked={allChosen}
                      onCheckedChange={(checked) =>
                        setChosen(new Set(checked ? pickable.map((run) => run._id) : []))
                      }
                    />
                  </TableHead>
                )}
                <TableHead>Automation</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Took</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <RunRow
                  key={run._id}
                  run={run}
                  choosing={show === "failed"}
                  chosen={chosen.has(run._id)}
                  busy={busy}
                  onChoose={(checked) =>
                    setChosen((current) => {
                      const next = new Set(current);
                      if (checked) next.add(run._id);
                      else next.delete(run._id);
                      return next;
                    })
                  }
                  onPickUp={() => pickUpOne(run)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function RunRow({
  run,
  choosing,
  chosen,
  busy,
  onChoose,
  onPickUp,
}: {
  run: Row;
  choosing: boolean;
  chosen: boolean;
  busy: boolean;
  onChoose: (checked: boolean) => void;
  onPickUp: () => void;
}) {
  const failed = run.status === "failed";
  return (
    <TableRow data-run={run._id}>
      {choosing && (
        <TableCell>
          {run.canPickUp && (
            <Checkbox
              aria-label={`Choose ${run.automationName}, ${when.format(run.startedAt)}`}
              checked={chosen}
              onCheckedChange={(checked) => onChoose(checked === true)}
            />
          )}
        </TableCell>
      )}
      <TableCell className="max-w-64">
        <p className="truncate font-medium">{run.automationName}</p>
        <p className="text-muted-foreground truncate text-xs">
          {run.startedWith ?? RUN_TRIGGER_LABELS[run.triggerKind]}
        </p>
      </TableCell>
      <TableCell className="max-w-md">
        <div className="flex flex-wrap items-center gap-2">
          <RunStatusBadge status={run.status} />
          {run.pickedUp > 0 && (
            <span className="text-muted-foreground text-xs">
              {run.pickedUp === 1 ? "Picked up once" : `Picked up ${run.pickedUp} times`}
            </span>
          )}
        </div>
        {failed && (
          <p
            className="text-muted-foreground mt-1 truncate text-xs"
            title={run.error ? explainFailure(run.error).reason : undefined}
          >
            {run.failedStep && <span className="text-foreground">At {run.failedStep}. </span>}
            {run.error ? explainFailure(run.error).reason : ""}
          </p>
        )}
        {failed && run.whyNot && (
          <p className="text-muted-foreground mt-0.5 truncate text-xs" title={run.whyNot}>
            {run.whyNot}
          </p>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground whitespace-nowrap">
        {when.format(run.startedAt)}
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        {run.finishedAt ? formatDuration(run.finishedAt - run.startedAt) : ""}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          {run.canPickUp && (
            <Button variant="outline" size="sm" disabled={busy} onClick={onPickUp}>
              <StepForward />
              Pick up<span className="sr-only"> {run.automationName}</span>
            </Button>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link
              href={`/automations/${run.automationId}/runs/${run._id}`}
              transitionTypes={["nav-forward"]}
            >
              View<span className="sr-only"> run from {when.format(run.startedAt)}</span>
            </Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
