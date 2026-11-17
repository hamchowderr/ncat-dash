"use client";

import "@xyflow/react/style.css";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  type AutomationEdge,
  type AutomationNode,
  readClipsSetup,
} from "@ncat-dash/automation-core";
import { Background, Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, CircleStop, RotateCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type Trigger, TRIGGER_LABELS, type TriggerKind } from "@/lib/automations";
import { errorMessage, formatDuration } from "@/lib/catalog";

import {
  canvasEdge,
  edgeTypes,
  FIT_VIEW,
  flowEdge,
  type FlowNode,
  nodeTypes,
  TRIGGER_ID,
  triggerEdges,
  triggerPosition,
} from "./flow-nodes";
import { ClipsRun } from "./clips-run";
import { logicNote, RunSteps } from "./run-steps";
import { EditorExport } from "./editor-export";
import { RunStatusBadge, shownStatus } from "./run-status";

/** A run only records which kind of trigger started it, which is all the canvas shows. */
function runTrigger(kind: TriggerKind): Trigger {
  if (kind === "schedule") return { kind, schedule: { mode: "interval", minutes: 60 } };
  if (kind === "upload") return { kind, fileType: "any" };
  if (kind === "folder") return { kind, prefix: "", fileType: "any" };
  return { kind };
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** One run: the canvas with each step's live state, and below it what each step did. */
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
  const runAgain = useMutation(api.runs.runAgain);
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [busy, setBusy] = useState(false);
  const [showClips, setShowClips] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  // Choosing a step on the canvas brings its row below into view and marks it for a moment.
  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => setHighlighted(null), 1800);
    return () => clearTimeout(timer);
  }, [highlighted]);
  function showStep(nodeId: string) {
    const row = document.querySelector(`[data-step="${CSS.escape(nodeId)}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlighted(nodeId);
  }

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
          status: byNode.has(node.id) ? shownStatus(byNode.get(node.id)!) : undefined,
          jobCount: byNode.get(node.id)?.jobs.length,
          note: logicNote(byNode.get(node.id) ?? { status: "pending" }) ?? undefined,
        },
      })),
    ];
    const edges = [
      ...triggerEdges(
        run.nodes.map((node) => node.id),
        run.edges,
      ),
      ...(run.edges as AutomationEdge[]).map((edge) => ({
        ...flowEdge(canvasEdge(edge)),
        animated:
          byNode.get(edge.target)?.status === "running" && !byNode.get(edge.target)?.retryAt,
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
            {run.testOf ? `Test of ${run.testOf}` : `${TRIGGER_LABELS[run.triggerKind]} run`},
            started {when.format(run.startedAt)}
            {run.finishedAt ? `, took ${formatDuration(run.finishedAt - run.startedAt)}` : ""}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <RunStatusBadge status={run.status} />
          {run.hasCuts && <EditorExport runId={runId} />}
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
          {!active && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const next = await runAgain({ runId });
                  router.push(`/automations/${automationId}/runs/${next}`);
                }, "The run could not be started again.")
              }
            >
              <RotateCw />
              Run again
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
                edgeTypes={edgeTypes}
                minZoom={0.25}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                forceColorMode={resolvedTheme === "dark" ? "dark" : "light"}
                onNodeClick={(_, node) => showStep(node.id)}
                fitView
                fitViewOptions={FIT_VIEW}
              >
                <Background gap={20} />
                <Controls showInteractive={false} fitViewOptions={FIT_VIEW} />
              </ReactFlow>
            </ReactFlowProvider>
          </div>

          <RunSteps
            run={run}
            highlighted={highlighted}
            busy={busy}
            onDecide={(runStepId, approved) =>
              act(
                () => decide({ runStepId, approved }),
                approved ? "The approval could not be saved." : "The decision could not be saved.",
              )
            }
          />
        </div>
      )}
    </>
  );
}
