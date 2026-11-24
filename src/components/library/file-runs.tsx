"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { RunStatusBadge } from "@/components/automations/run-status";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/catalog";

/** How a run on this file started, and what it made, in a few words. */
export function runLine(run: { byHand: boolean; followed: boolean; made: number }): string {
  const how = run.byHand ? "Run by hand" : run.followed ? "Followed another" : "Ran by itself";
  if (run.made === 0) return how;
  return `${how} · made ${run.made === 1 ? "1 file" : `${run.made} files`}`;
}

/**
 * The automations that ran on an uploaded file, newest first, each with how it is doing,
 * then those set to ask first that fit it, one press each. Shows nothing for a file an
 * automation made, which says what made it instead.
 */
export function FileRuns(props: { itemId: Id<"libraryItems"> } | { uploadId: Id<"uploads"> }) {
  const byItem = useQuery(api.library.runsOnFile, "itemId" in props ? props : "skip");
  const byUpload = useQuery(api.library.runsOnUpload, "uploadId" in props ? props : "skip");
  const found = "itemId" in props ? byItem : byUpload;
  const runAutomation = useAction(api.library.runAutomation);
  const [starting, setStarting] = useState<string | null>(null);
  if (!found) return null;
  const { itemId, runs, suggested } = found;

  async function run(automationId: Id<"automations">, name: string) {
    setStarting(automationId);
    try {
      await runAutomation({ itemId, automationId });
      toast.success(`${name} is running on this file.`);
    } catch (caught) {
      toast.error(errorMessage(caught, `${name} could not start. Try again.`));
    } finally {
      setStarting(null);
    }
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Automations on this file">
      <h2 className="text-sm font-medium">Automations on this file</h2>
      {runs.length === 0 && suggested.length === 0 && (
        <p className="text-muted-foreground text-xs">
          None yet. Each automation that runs on this file shows here, with how it is doing.
        </p>
      )}
      {runs.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Ran on this file">
          {runs.map((each) => (
            <li key={each._id}>
              <Link
                href={`/automations/${each.automationId}/runs/${each._id}`}
                className="hover:bg-muted/60 -mx-2 flex flex-col gap-1 rounded-md px-2 py-1.5"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm">{each.automationName}</span>
                  <RunStatusBadge status={each.status} />
                </span>
                <span className="text-muted-foreground text-xs">{runLine(each)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {suggested.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-muted-foreground text-xs">Suggested for this file</p>
          <ul className="flex flex-col gap-1" aria-label="Suggested for this file">
            {suggested.map((automation) => (
              <li key={automation._id} className="flex items-center justify-between gap-2">
                <span className="truncate text-sm">{automation.name}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={starting !== null}
                  aria-label={`Run ${automation.name} on this file`}
                  onClick={() => void run(automation._id, automation.name)}
                >
                  <Play />
                  Run
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
