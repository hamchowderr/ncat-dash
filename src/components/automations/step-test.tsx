"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { AutomationNode } from "@ncat-dash/automation-core";
import { useMutation, useQuery } from "convex/react";
import { ArrowRight, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/catalog";

import { RunDialog } from "./run-dialog";
import { RunStatusBadge, shownStatus } from "./run-status";
import { StepFacts, StepFiles } from "./run-steps";

/**
 * Tries one step on its own, on a file of the person's choosing, with its settings as
 * they are in the editor right now. The result shows under the button and updates live.
 */
export function StepTest({
  automationId,
  node,
  runId,
  onStarted,
}: {
  automationId: Id<"automations">;
  node: Omit<AutomationNode, "position">;
  /** The last test of this step, if there was one since the editor opened. */
  runId: Id<"runs"> | undefined;
  onStarted: (runId: Id<"runs">) => void;
}) {
  const testStep = useMutation(api.automations.testStep);
  const [choosing, setChoosing] = useState(false);
  const run = useQuery(api.runs.get, runId ? { runId } : "skip");
  const step = run?.steps[0];
  const going = step !== undefined && (step.status === "running" || step.status === "pending");

  return (
    <section aria-label="Test this step" className="flex flex-col gap-3 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <div className="grid">
          <h3 className="text-sm font-medium">Test this step</h3>
          <p className="text-muted-foreground text-xs">
            Runs just this step on one file. Nothing after it runs.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={going}
          onClick={() => setChoosing(true)}
        >
          <Play />
          {run ? "Test again" : "Test"}
        </Button>
      </div>

      {run && step && (
        <div className="flex flex-col gap-3" aria-live="polite" data-step-test={step.status}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <RunStatusBadge status={shownStatus(step)} />
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
              {run.startedWith ? `On ${run.startedWith}` : "With no file"}
              {step.startedAt && step.finishedAt && step.finishedAt - step.startedAt >= 1000
                ? `, took ${formatDuration(step.finishedAt - step.startedAt)}`
                : ""}
            </span>
          </div>
          {going && (
            <p className="text-muted-foreground text-sm">
              {step.retryAt
                ? "The first try failed. Trying again."
                : "Working on it. This updates by itself."}
            </p>
          )}
          {step.error && (
            <Alert variant="destructive">
              <AlertDescription>{step.error}</AlertDescription>
            </Alert>
          )}
          <StepFacts facts={step.facts} />
          <StepFiles label="Files from the test" files={step.outputs} className="sm:grid-cols-2" />
          {step.status === "done" && step.outputs.length === 0 && step.facts.length === 0 && (
            <p className="text-muted-foreground text-sm">Finished, with nothing to show.</p>
          )}
          <Link
            href={`/automations/${automationId}/runs/${run._id}`}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 self-start text-xs underline-offset-4 hover:underline"
          >
            Open the test run
            <ArrowRight className="size-3" aria-hidden="true" />
          </Link>
        </div>
      )}

      <RunDialog
        open={choosing}
        onOpenChange={setChoosing}
        startsOnUpload={false}
        onUploadedOnly={() => setChoosing(false)}
        title="Test this step on one file"
        description="Only this step runs, with its settings as they are now, even if they are not saved yet."
        withoutFile={false}
        start={async (fileUrl) => {
          const started = await testStep({
            automationId,
            node: { ...node, position: { x: 0, y: 0 } },
            fileUrl,
          });
          onStarted(started);
          setChoosing(false);
        }}
      />
    </section>
  );
}
