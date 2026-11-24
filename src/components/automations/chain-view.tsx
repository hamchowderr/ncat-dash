"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { type Starter, STARTERS } from "@takewon/automation-core";
import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { useQuery } from "convex/react";
import { Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { triggerSummary } from "@/lib/automations";
import { cn } from "@/lib/utils";

import { CanvasBar, CanvasZoom, FitOnResize } from "./canvas-bar";
import { FIT_VIEW } from "./flow-nodes";
import { FlowStrip } from "./flow-strip";
import { useSetUp } from "./follow-ons";
import { RunStatusBadge } from "./run-status";
import { useWorkflowOf, WorkflowBar, workflowMarks } from "./workflow-bar";

type ChainView = NonNullable<ReturnType<typeof useChainView>>;
type Member = ChainView["automations"][number];
type How = ChainView["links"][number]["how"];

/** Every automation linked to this one, or undefined while it loads. */
export function useChainView(automationId: Id<"automations">) {
  return useQuery(api.automations.chainView, { automationId });
}

/** What a line between two automations says. */
export const HOW_WORDS: Record<How, string> = {
  done: "after it works",
  failed: "if it fails",
  either: "whenever it ends",
  step: "runs it as a step",
};

const CARD_WIDTH = 300;
const COLUMN_GAP = 140;
const ROW_HEIGHT = 230;
/** Ready-made follow-ons shown after each automation, so the page does not fill with them. */
const SUGGESTED_EACH = 2;

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

type AutomationCard = Node<
  { member: Member; current: boolean; reviewHere?: boolean; covered?: boolean },
  "automation"
>;
type SuggestionCard = Node<
  { starter: Starter; after: Member; onSetUp: () => void; pending: boolean; disabled: boolean },
  "suggestion"
>;
type ChainEdge = Edge<{ words: string; how: How | "suggested" }, "chain">;

const handle = "!size-2 !border-0 !bg-transparent";

function AutomationNode({ data }: NodeProps<AutomationCard>) {
  const { member, current, reviewHere, covered } = data;
  const follows = member.trigger.kind === "finished";
  return (
    <article
      className={cn(
        "bg-card grid gap-3 rounded-xl p-4 shadow-xs",
        current && "ring-primary/40 ring-2",
      )}
      style={{ width: CARD_WIDTH }}
      aria-label={member.name}
      data-chain-automation={member.automationId}
    >
      <Handle type="target" position={Position.Left} className={handle} isConnectable={false} />
      <div className="grid gap-0.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              member.enabled ? "bg-emerald-500" : "bg-muted-foreground/40",
            )}
            aria-hidden="true"
          />
          {current ? (
            <span className="min-w-0 truncate text-sm font-medium">{member.name}</span>
          ) : (
            <Link
              href={`/automations/${member.automationId}`}
              className="min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline"
            >
              {member.name}
            </Link>
          )}
          {current && (
            <span className="text-muted-foreground shrink-0 text-xs">This automation</span>
          )}
        </div>
        <span className="text-muted-foreground text-xs">
          {member.enabled ? "On" : "Off"}
          {follows ? "" : `, ${triggerSummary(member.trigger).toLowerCase()}`}
        </span>
      </div>
      <FlowStrip
        size="sm"
        trigger={member.trigger}
        nodes={member.nodes}
        edges={member.edges}
        className="justify-start overflow-hidden"
      />
      {(reviewHere || covered) && (
        <ul className="text-muted-foreground grid gap-0.5 text-xs" aria-label="Workflow review">
          {reviewHere && (
            <li className="text-foreground flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
              Reviewed here before the files go out
            </li>
          )}
          {covered && <li>Its own Approval step is covered by the workflow&apos;s review</li>}
        </ul>
      )}
      {member.lastRun ? (
        <Link
          href={`/automations/${member.automationId}/runs/${member.lastRun.runId}`}
          className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-xs"
        >
          <RunStatusBadge status={member.lastRun.status} />
          <span>Last run {when.format(member.lastRun.at)}</span>
        </Link>
      ) : (
        <span className="text-muted-foreground text-xs">Has not run yet</span>
      )}
      <Handle type="source" position={Position.Right} className={handle} isConnectable={false} />
    </article>
  );
}

function SuggestionNode({ data }: NodeProps<SuggestionCard>) {
  const { starter, after, onSetUp, pending, disabled } = data;
  return (
    <article
      className="bg-muted/40 grid gap-2 rounded-xl border border-dashed p-4"
      style={{ width: CARD_WIDTH }}
      aria-label={`Suggested: ${starter.name}`}
      data-chain-suggestion={starter.id}
    >
      <Handle type="target" position={Position.Left} className={handle} isConnectable={false} />
      <span className="text-muted-foreground text-xs">Goes well after {after.name}</span>
      <span className="text-sm font-medium">{starter.name}</span>
      <span className="text-muted-foreground line-clamp-2 text-sm">{starter.description}</span>
      <Button
        variant="outline"
        size="sm"
        className="justify-self-start"
        disabled={disabled}
        aria-label={`Build ${starter.name}`}
        onClick={onSetUp}
      >
        <Plus />
        {pending ? "Building it" : "Build it"}
      </Button>
    </article>
  );
}

function ChainLine({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<ChainEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const how = data?.how;
  const style =
    how === "failed"
      ? { stroke: "var(--destructive)", strokeDasharray: "5 4" }
      : how === "suggested"
        ? { stroke: "var(--muted-foreground)", strokeDasharray: "3 5", opacity: 0.5 }
        : undefined;
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      {data && how !== "suggested" && (
        <EdgeLabelRenderer>
          <span
            className={cn(
              "bg-background absolute rounded-full px-2 py-0.5 text-xs shadow-xs",
              how === "failed" ? "text-destructive" : "text-muted-foreground",
            )}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.words}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const chainNodeTypes = { automation: AutomationNode, suggestion: SuggestionNode };
const edgeTypes = { chain: ChainLine };

/**
 * Where each card sits: one column per step along the chain, the ready-made suggestions
 * in the column after the automation they would follow, below what is already there.
 */
export function chainLayout(view: Pick<ChainView, "columns" | "automations">): {
  automations: Map<string, { x: number; y: number }>;
  suggestions: [string, string][][];
} {
  const automations = new Map<string, { x: number; y: number }>();
  const suggestions: [string, string][][] = [];
  const byId = new Map(view.automations.map((member) => [member.automationId as string, member]));
  const width = view.columns.length + 1;
  for (let column = 0; column < width; column++) {
    const here = view.columns[column] ?? [];
    here.forEach((id, row) => {
      automations.set(id, { x: column * (CARD_WIDTH + COLUMN_GAP), y: row * ROW_HEIGHT });
    });
    // Suggestions for the column before, after what this column already holds.
    const before = view.columns[column - 1] ?? [];
    suggestions[column] = before.flatMap((id) =>
      (byId.get(id)?.suggestions ?? [])
        .slice(0, SUGGESTED_EACH)
        .map((starterId) => [id, starterId] as [string, string]),
    );
  }
  return { automations, suggestions };
}

function ChainCanvas({ view, automationId }: { view: ChainView; automationId: Id<"automations"> }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const { pending, onSetUp } = useSetUp({ open: false });
  const workflow = useWorkflowOf(automationId)?.workflow;
  const { nodes, edges } = useMemo(() => {
    const marks = workflowMarks(workflow);
    const byId = new Map(view.automations.map((member) => [member.automationId as string, member]));
    const layout = chainLayout(view);
    const nodes: (AutomationCard | SuggestionCard)[] = view.automations.map((member) => ({
      id: member.automationId,
      type: "automation",
      // Nothing on this canvas is dragged or picked, but its links and buttons still work.
      style: { pointerEvents: "all" },
      position: layout.automations.get(member.automationId)!,
      data: {
        member,
        current: member.automationId === automationId,
        ...marks.get(member.automationId),
      },
    }));
    const edges: ChainEdge[] = view.links.map((link) => ({
      id: `${link.from}-${link.to}`,
      source: link.from,
      target: link.to,
      type: "chain",
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { words: HOW_WORDS[link.how], how: link.how },
    }));
    layout.suggestions.forEach((picks, column) => {
      const taken = view.columns[column]?.length ?? 0;
      picks.forEach(([afterId, starterId], index) => {
        const starter = STARTERS.find((each) => each.id === starterId);
        const after = byId.get(afterId);
        if (!starter || !after) return;
        const id = `suggest:${afterId}:${starterId}`;
        const key = `${afterId}:${starterId}`;
        nodes.push({
          id,
          type: "suggestion",
          style: { pointerEvents: "all" },
          position: {
            x: column * (CARD_WIDTH + COLUMN_GAP),
            y: (taken + index) * ROW_HEIGHT,
          },
          data: {
            starter,
            after,
            pending: pending === key,
            disabled: pending !== null,
            onSetUp: () => void onSetUp(after.automationId, after.name, starter),
          },
        });
        edges.push({
          id: `${afterId}-${id}`,
          source: afterId,
          target: id,
          type: "chain",
          data: { words: "", how: "suggested" },
        });
      });
    });
    return { nodes, edges };
  }, [view, automationId, pending, onSetUp, workflow]);

  // A card built from here, or one that went, brings the whole chain back into view.
  const { fitView } = useReactFlow();
  const count = nodes.length;
  useEffect(() => {
    const timer = setTimeout(() => void fitView({ ...FIT_VIEW, duration: 300 }), 60);
    return () => clearTimeout(timer);
  }, [count, fitView]);

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-surface lg:min-h-[28rem] lg:flex-[1_1_0px]">
      <CanvasBar>
        <p className="text-muted-foreground min-w-0 flex-1 text-sm">
          {view.automations.length === 1
            ? "Nothing starts this automation and nothing starts after it yet."
            : `${view.automations.length} automations that start each other. Each still runs on its own, with the files the one before it made.`}
        </p>
        <CanvasZoom fitViewOptions={FIT_VIEW} />
        <FitOnResize canvasRef={canvasRef} fitViewOptions={FIT_VIEW} />
      </CanvasBar>
      <WorkflowBar automationId={automationId} />
      <div
        ref={canvasRef}
        className="bg-background relative mx-2 mb-2 h-[32rem] min-h-0 overflow-hidden rounded-lg lg:h-auto lg:flex-1"
        data-testid="chain-canvas"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={chainNodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={FIT_VIEW}
          minZoom={0.25}
          proOptions={{ hideAttribution: true }}
        />
      </div>
    </div>
  );
}

/**
 * The chain tab on an automation: it and every automation linked to it, however far
 * along, on one canvas, with what goes well after each.
 */
export function ChainView({ automationId }: { automationId: Id<"automations"> }) {
  const view = useChainView(automationId);
  if (view === undefined) return <Skeleton className="h-96 rounded-xl" />;
  return (
    <ReactFlowProvider>
      <ChainCanvas view={view} automationId={automationId} />
    </ReactFlowProvider>
  );
}
