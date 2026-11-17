"use client";

import "@xyflow/react/style.css";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { type AutomationNode, readClipsSetup } from "@ncat-dash/automation-core";
import { Background, Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Check, CircleStop, X } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { MediaPreview } from "@/components/jobs/media-preview";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { nodeTitle, type Trigger, TRIGGER_LABELS, type TriggerKind } from "@/lib/automations";
import { errorMessage, formatDuration } from "@/lib/catalog";

import { type FlowNode, nodeTypes, TRIGGER_ID, triggerEdges, triggerPosition } from "./flow-nodes";
import { ClipsRun } from "./clips-run";
import { RunStatusBadge } from "./run-status";

/** A run only records which kind of trigger started it, which is all the canvas shows. */
function runTrigger(kind: TriggerKind): Trigger {
  if (kind === "schedule") return { kind, schedule: { mode: "interval", minutes: 60 } };
  if (kind === "upload") return { kind, fileType: "any" };
  if (kind === "folder") return { kind, prefix: "", fileType: "any" };
  return { kind };
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** One run: the canvas with each step's live state, and what each step produced. */
export function RunView({
  automationId,
  runId,
}: {
  automationId: Id<"automations">;
  runId: Id<"runs">;
}) {
  const run = useQuery(api.runs.get, { runId });
  const decide = useMutation(api.runs.decide);
  const cancel = useMutation(api.runs.cancel);
  const { resolvedTheme } = useTheme();
  const [busy, setBusy] = useState(false);
  const [showClips, setShowClips] = useState(false);

  const flow = useMemo(() => {
    if (!run) return null;
    const byNode = new Map(run.steps.map((step) => [step.nodeId, step]));
    const nodes: FlowNode[] = [
      {
        id: TRIGGER_ID,
        type: "trigger",
        position: triggerPosition(run.nodes),
        data: { trigger: runTrigger(run.triggerKind), summary: "Started this run" },
      },
      ...(run.nodes as AutomationNode[]).map(({ position, ...node }) => ({
        id: node.id,
        type: "step" as const,
        position,
        data: {
          node,
          status: byNode.get(node.id)?.status,
          jobCount: byNode.get(node.id)?.jobs.length,
        },
      })),
    ];
    const edges = [
      ...triggerEdges(
        run.nodes.map((node) => node.id),
        run.edges,
      ),
      ...run.edges.map((edge) => ({
        ...edge,
        animated: byNode.get(edge.target)?.status === "running",
      })),
    ];
    return { nodes, edges, byNode };
  }, [run]);

  if (run === undefined) return <Skeleton className="h-[70vh] rounded-xl" />;
  if (run === null || !flow) {
    return <p className="text-muted-foreground text-sm">This run no longer exists.</p>;
  }

  const active = run.status === "running" || run.status === "waiting";
  const clipsSetup = readClipsSetup(run.nodes as AutomationNode[], run.edges);

  async function act(work: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    try {
      await work();
    } catch (caught) {
      toast.error(errorMessage(caught, fallback));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="-ml-2">
          <Link href={`/automations/${automationId}`}>
            <ArrowLeft />
            <span className="sr-only">Back to the automation</span>
          </Link>
        </Button>
        <div className="grid">
          <h1 className="text-lg font-semibold tracking-tight">{run.automationName}</h1>
          <p className="text-muted-foreground text-sm">
            {TRIGGER_LABELS[run.triggerKind]} run, started {when.format(run.startedAt)}
            {run.finishedAt ? `, took ${formatDuration(run.finishedAt - run.startedAt)}` : ""}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <RunStatusBadge status={run.status} />
          {clipsSetup && (
            <Button variant="ghost" size="sm" onClick={() => setShowClips((shown) => !shown)}>
              {showClips ? "Show the canvas" : "Show clips"}
            </Button>
          )}
          {active && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => act(() => cancel({ runId }), "The run could not be stopped.")}
            >
              <CircleStop />
              Stop run
            </Button>
          )}
        </div>
      </div>

      {clipsSetup && showClips && (
        <ClipsRun
          run={run}
          setup={clipsSetup}
          busy={busy}
          onDecide={(runStepId, approved) =>
            act(() => decide({ runStepId, approved }), "The decision could not be saved.")
          }
        />
      )}

      {(!clipsSetup || !showClips) && (
        <div className="grid gap-4">
          <div className="bg-muted/30 h-80 overflow-hidden rounded-xl border">
            <ReactFlowProvider>
              <ReactFlow
                nodes={flow.nodes}
                edges={flow.edges}
                nodeTypes={nodeTypes}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                forceColorMode={resolvedTheme === "dark" ? "dark" : "light"}
                fitView
                fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={20} />
                <Controls showInteractive={false} fitViewOptions={{ maxZoom: 1, padding: 0.3 }} />
              </ReactFlow>
            </ReactFlowProvider>
          </div>

          <ol className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(run.nodes as AutomationNode[]).map((node) => {
              const step = flow.byNode.get(node.id);
              if (!step) return null;
              const finished = step.jobs.filter((job) => job.status === "done").length;
              return (
                <li
                  key={node.id}
                  data-step={node.id}
                  className="bg-card flex flex-col gap-3 rounded-xl border p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="truncate text-sm font-medium">{nodeTitle(node)}</h2>
                    <RunStatusBadge status={step.status} />
                  </div>
                  {step.status === "running" && step.jobs.length > 1 && (
                    <p className="text-muted-foreground text-sm tabular-nums">
                      {finished} of {step.jobs.length} files finished
                    </p>
                  )}
                  {step.error && (
                    <Alert variant="destructive">
                      <AlertDescription>{step.error}</AlertDescription>
                    </Alert>
                  )}
                  {step.status === "waiting_approval" && (
                    <div className="flex flex-col gap-3">
                      <p className="text-muted-foreground text-sm">
                        Check the files from the step before, then decide. Approving sends them on.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            act(
                              () => decide({ runStepId: step._id, approved: true }),
                              "The approval could not be saved.",
                            )
                          }
                        >
                          <Check />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            act(
                              () => decide({ runStepId: step._id, approved: false }),
                              "The decision could not be saved.",
                            )
                          }
                        >
                          <X />
                          Reject
                        </Button>
                      </div>
                    </div>
                  )}
                  {node.kind === "step" &&
                    step.outputs
                      .slice(0, 6)
                      .map((url, index) => <MediaPreview key={`${index}-${url}`} url={url} />)}
                  {node.kind === "step" && step.outputs.length > 6 && (
                    <p className="text-muted-foreground text-sm">
                      And {step.outputs.length - 6} more in{" "}
                      <Link href="/outputs" className="underline underline-offset-4">
                        Outputs
                      </Link>
                      .
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </>
  );
}
