"use client";

import "@xyflow/react/style.css";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  type AutomationEdge,
  type AutomationNode,
  failsOver,
  readClipsSetup,
} from "@ncat-dash/automation-core";
import { Background, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, CircleStop, RotateCw, StepForward } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RUN_TRIGGER_LABELS, type RunTriggerKind, type Trigger } from "@/lib/automations";
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
import { CanvasBar, CanvasZoom, FitOnResize } from "./canvas-bar";
import { ClipsRun } from "./clips-run";
import { logicNote, passedAlong, RunSteps, StartedRunLink } from "./run-steps";
import { EditorExport } from "./editor-export";
import { RunStatusBadge, shownStatus } from "./run-status";

/** A run only records which kind of trigger started it, which is all the canvas shows. */
function runTrigger(kind: RunTriggerKind): Trigger {
  if (kind === "automation" || kind === "finished") {
    return { kind: "finished", automationId: "", when: "done" };
  }
  if (kind === "schedule") return { kind, schedule: { mode: "interval", minutes: 60 } };
  if (kind === "upload") return { kind, fileType: "any" };
  if (kind === "folder") return { kind, prefix: "", fileType: "any" };
  if (kind === "slot") return { kind, status: "approved", slotKind: "any" };
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
  const pickUp = useMutation(api.runs.pickUp);
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
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
        data: {
          trigger: runTrigger(run.triggerKind),
          runKind: run.triggerKind,
          summary: run.startedByRun
            ? `Started by a run of ${run.startedByRun.automationName}`
            : "Started this run",
        },
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
          failWay: failsOver(node.id, run.edges as AutomationEdge[])
            ? ("used" as const)
            : undefined,
        },
      })),
    ];
    // How many files went along each line, once the step before it has finished.
    const passed = passedAlong(run as Parameters<typeof passedAlong>[0]);
    const count = (source: string, target: string) => {
      const files = passed.get(`${source}>${target}`);
      return files ? { data: { passed: files.length } } : {};
    };
    const edges = [
      ...triggerEdges(
        run.nodes.map((node) => node.id),
        run.edges,
      ).map((edge) => (run.startedWith ? { ...edge, ...count(edge.source, edge.target) } : edge)),
      ...(run.edges as AutomationEdge[]).map((edge) => ({
        ...flowEdge(canvasEdge(edge)),
        ...count(edge.source, edge.target),
        animated:
          byNode.get(edge.target)?.status === "running" && !byNode.get(edge.target)?.retryAt,
      })),
    ];
    return { nodes, edges, byNode };
  }, [run]);

  if (run === undefined) return <RunSkeleton />;
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

  // Automations that follow this one and started when it ended. Runs a step started are
  // shown on that step's line instead.
  const followed = run.startedRuns.filter((next) => next.how === "followed");

  return (
    <div className="reveal flex flex-col gap-4 md:gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="-ml-2">
          <Link href={`/automations/${automationId}`} transitionTypes={["nav-back"]}>
            <ArrowLeft />
            <span className="sr-only">Back to the automation</span>
          </Link>
        </Button>
        <div className="grid">
          <h1 className="text-lg font-semibold tracking-tight">{run.automationName}</h1>
          <p className="text-muted-foreground text-sm">
            {run.testOf ? `Test of ${run.testOf}` : `${RUN_TRIGGER_LABELS[run.triggerKind]} run`},
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
          {run.pickUp?.ok && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const result = await pickUp({ runId });
                  toast.success(
                    result.withCurrentSettings
                      ? "Picked up where it stopped."
                      : "Picked up where it stopped. The automation's steps have changed since, so it carries on with the steps it had.",
                  );
                }, "The run could not be picked up.")
              }
            >
              <StepForward />
              Pick up from {run.pickUp.stepName ?? "the failed step"}
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

      {(run.startedByRun || followed.length > 0) && (
        <nav aria-label="Linked runs" className="flex flex-wrap items-center gap-x-6 gap-y-1">
          {run.startedByRun && <StartedRunLink run={run.startedByRun} lead="Started by a run of" />}
          {followed.map((next) => (
            <StartedRunLink key={next.runId} run={next} lead="Then started" />
          ))}
        </nav>
      )}

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
          <div className="flex h-80 flex-col overflow-hidden rounded-xl bg-surface">
            <ReactFlowProvider>
              <CanvasBar>
                <CanvasZoom fitViewOptions={FIT_VIEW} />
                <FitOnResize canvasRef={canvasRef} fitViewOptions={FIT_VIEW} />
              </CanvasBar>
              <div
                ref={canvasRef}
                className="bg-background relative mx-2 mb-2 min-h-0 flex-1 overflow-hidden rounded-lg"
              >
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
                </ReactFlow>
              </div>
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
    </div>
  );
}

/** The run page's own shape in grey, so the run arrives in place. */
function RunSkeleton() {
  return (
    <div className="flex flex-col gap-4 md:gap-6" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-3">
        <Skeleton className="-ml-2 size-9 rounded-md" />
        <div className="grid gap-1.5">
          <Skeleton className="h-5 w-40 rounded-md" />
          <Skeleton className="h-4 w-64 rounded-md" />
        </div>
        <Skeleton className="ml-auto h-7 w-36 rounded-full" />
      </div>
      <div className="bg-surface h-80 rounded-xl" />
      <div className="bg-surface flex flex-col gap-3 rounded-xl p-4">
        <Skeleton className="h-4 w-32 rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    </div>
  );
}
