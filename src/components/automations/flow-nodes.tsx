"use client";

import {
  type AutomationNode,
  type Brand,
  BRAND_WORDS,
  missingBrandOf,
  missingSettings,
  NODE_GAP,
  type NodeGroup,
  nodeTypeOf,
} from "@ncat-dash/automation-core";
import { getStep, type StepCategory } from "@ncat-dash/step-catalog";
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
} from "@xyflow/react";
import {
  CalendarClock,
  Clapperboard,
  Code,
  Film,
  FolderInput,
  Hand,
  Layers,
  HardDriveUpload,
  Image as ImageIcon,
  type LucideIcon,
  Music,
  Plus,
  Scissors,
  Shapes,
  Terminal,
  TriangleAlert,
  Upload,
  UserCheck,
  Webhook,
  Zap,
} from "lucide-react";
import { createContext, useContext } from "react";

import {
  nodeTitle,
  type Trigger,
  type TriggerKind,
  TRIGGER_LABELS,
  triggerSummary,
} from "@/lib/automations";
import { CATEGORY_LABELS } from "@/lib/catalog";
import { cn } from "@/lib/utils";

import { STEP_ICONS } from "./step-icons";

import { type ShownStepStatus, StatusIcon } from "./run-status";

export const TRIGGER_ID = "__trigger";

export const CATEGORY_ICONS: Record<StepCategory, LucideIcon> = {
  video: Film,
  audio: Music,
  media: Shapes,
  image: ImageIcon,
  recipe: Layers,
  ffmpeg: Terminal,
  code: Code,
  storage: HardDriveUpload,
};

/** The icon each group of the step list is shown with. */
export const GROUP_ICONS: Record<NodeGroup, LucideIcon> = {
  ...CATEGORY_ICONS,
  trigger: Zap,
  "ready-made": Scissors,
  people: UserCheck,
};

export const TRIGGER_ICONS: Record<TriggerKind, LucideIcon> = {
  manual: Hand,
  webhook: Webhook,
  schedule: CalendarClock,
  upload: Upload,
  folder: FolderInput,
};

// One colour per kind of step, so a graph can be read at a glance.
const CATEGORY_TINTS: Record<StepCategory, string> = {
  video: "text-violet-600 dark:text-violet-400",
  audio: "text-sky-600 dark:text-sky-400",
  media: "text-teal-600 dark:text-teal-400",
  image: "text-pink-600 dark:text-pink-400",
  recipe: "text-amber-600 dark:text-amber-400",
  ffmpeg: "text-slate-600 dark:text-slate-300",
  code: "text-emerald-600 dark:text-emerald-400",
  storage: "text-blue-600 dark:text-blue-400",
};
export const TRIGGER_TINT = "text-rose-600 dark:text-rose-400";

/** The icon, colour and second line for a step, shared by the canvas and the small previews. */
export function nodeLook(node: Pick<AutomationNode, "kind" | "stepId" | "input">): {
  icon: LucideIcon;
  tint: string;
  kind: string;
} {
  if (node.kind === "approval") {
    return {
      icon: UserCheck,
      tint: "text-amber-600 dark:text-amber-400",
      kind: "Waits for a person",
    };
  }
  if (node.kind === "clips") {
    return {
      icon: Scissors,
      tint: "text-orange-600 dark:text-orange-400",
      kind: String(node.input.platform ?? "No platform picked"),
    };
  }
  if (node.kind === "export") {
    return {
      icon: Clapperboard,
      tint: "text-indigo-600 dark:text-indigo-400",
      kind: "Premiere, Resolve, Final Cut",
    };
  }
  const step = getStep(node.stepId ?? "");
  if (!step)
    return { icon: Shapes, tint: "text-muted-foreground", kind: "No longer in the catalog" };
  return {
    icon: STEP_ICONS[step.id] ?? CATEGORY_ICONS[step.category],
    tint: CATEGORY_TINTS[step.category],
    kind: CATEGORY_LABELS[step.category],
  };
}

export type StepNodeData = {
  node: Omit<AutomationNode, "position">;
  status?: ShownStepStatus;
  /** How many jobs the step fanned out to, in a run. */
  jobCount?: number;
  /** Nothing follows this step yet, so it offers to add one. */
  last?: boolean;
};
export type TriggerNodeData = { trigger: Trigger; summary?: string };
export type StepFlowNode = Node<StepNodeData, "step">;
export type TriggerFlowNode = Node<TriggerNodeData, "trigger">;
export type FlowNode = StepFlowNode | TriggerFlowNode;

/** Set by the editor; absent on a run, where nothing can be added. */
/** The team's brand, so a step knows whether Settings already supplies its logo or font. */
export const BrandContext = createContext<Brand>({});

export const AddAfterContext = createContext<((nodeId: string) => void) | null>(null);

const tile =
  "bg-card relative flex size-20 items-center justify-center border shadow-sm transition-[box-shadow,border-color]";
const caption =
  "pointer-events-none absolute top-full left-1/2 mt-2 grid w-44 -translate-x-1/2 text-center leading-tight";
const handle = "!size-2.5 !border-2 !border-background !bg-muted-foreground";

function StepNode({ id, data, selected }: NodeProps<StepFlowNode>) {
  const { node, status, jobCount, last } = data;
  const look = nodeLook({ ...node, input: node.input });
  const addAfter = useContext(AddAfterContext);
  const brand = useContext(BrandContext);
  const nodeType = nodeTypeOf(node);
  const missing = status ? [] : missingSettings({ ...node, position: { x: 0, y: 0 } }, brand);
  const missingBrand = status || !nodeType ? [] : missingBrandOf(nodeType, node.input, brand);
  const second =
    jobCount && jobCount > 1 && status && status !== "pending"
      ? `${jobCount} ${node.kind === "clips" ? "clips" : "files"}`
      : missingBrand.length > 0
        ? `Needs your ${BRAND_WORDS[missingBrand[0]]}`
        : missing.length > 0
          ? "Needs settings"
          : look.kind;
  return (
    <div className="relative" data-node={id}>
      <div
        className={cn(
          tile,
          "rounded-2xl",
          selected && "ring-ring/50 border-ring ring-3",
          status === "running" && "border-primary",
          status === "retrying" && "border-amber-500/70",
          status === "done" && "border-emerald-600/60",
          status === "failed" && "border-destructive",
          status === "skipped" && "opacity-50",
        )}
      >
        <Handle type="target" position={Position.Left} className={handle} />
        <look.icon className={cn("size-8", look.tint)} strokeWidth={1.6} aria-hidden="true" />
        {status && status !== "pending" && (
          <span className="bg-card absolute -right-1.5 -bottom-1.5 rounded-full p-0.5">
            <StatusIcon status={status} />
          </span>
        )}
        {missing.length > 0 && (
          <span
            className="bg-card absolute -top-1.5 -right-1.5 rounded-full p-0.5 text-amber-600 dark:text-amber-400"
            title={
              missingBrand.length > 0
                ? `Add your team's ${missingBrand.map((key) => BRAND_WORDS[key]).join(" and ")} in Settings`
                : `Still needs: ${missing.join(", ")}`
            }
          >
            <TriangleAlert className="size-4" aria-hidden="true" />
          </span>
        )}
        <Handle type="source" position={Position.Right} className={handle} />
      </div>
      {last && addAfter && (
        <button
          type="button"
          aria-label={`Add a step after ${nodeTitle(node)}`}
          onClick={(event) => {
            event.stopPropagation();
            addAfter(id);
          }}
          className="nodrag bg-card text-muted-foreground hover:text-foreground hover:border-foreground/40 focus-visible:ring-ring/50 absolute top-1/2 left-full ml-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-md border outline-none before:absolute before:right-full before:h-px before:w-10 before:bg-[var(--xy-edge-stroke-default,#b1b1b7)] focus-visible:ring-3"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      )}
      <div className={caption}>
        <span className="truncate text-sm font-medium">{nodeTitle(node)}</span>
        <span
          className={cn(
            "truncate text-xs",
            missing.length > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
          )}
        >
          {second}
        </span>
      </div>
    </div>
  );
}

function TriggerNode({ data, selected }: NodeProps<TriggerFlowNode>) {
  const Icon = TRIGGER_ICONS[data.trigger.kind];
  return (
    <div className="relative" data-node={TRIGGER_ID}>
      <div
        className={cn(
          tile,
          "rounded-l-[2.5rem] rounded-r-2xl",
          selected && "ring-ring/50 border-ring ring-3",
        )}
      >
        <Icon className={cn("size-8", TRIGGER_TINT)} strokeWidth={1.6} aria-hidden="true" />
        <Handle type="source" position={Position.Right} className={handle} />
      </div>
      <div className={caption}>
        <span className="truncate text-sm font-medium">{TRIGGER_LABELS[data.trigger.kind]}</span>
        <span className="text-muted-foreground line-clamp-2 text-xs">
          {data.summary ?? triggerSummary(data.trigger)}
        </span>
      </div>
    </div>
  );
}

export const nodeTypes = { step: StepNode, trigger: TriggerNode };

/** Set by the editor; absent on a run, where nothing can be inserted. */
export const InsertOnEdgeContext = createContext<((source: string, target: string) => void) | null>(
  null,
);

/** A line between two steps, with a plus in the middle to put a step between them. */
function FlowEdge({
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
}: EdgeProps) {
  const insert = useContext(InsertOnEdgeContext);
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      {insert && (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label="Add a step here"
            onClick={() => insert(source, target)}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className="nodrag nopan bg-card text-muted-foreground hover:text-foreground hover:border-foreground/40 focus-visible:ring-ring/50 pointer-events-auto absolute flex size-5 items-center justify-center rounded-md border opacity-70 outline-none transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-3"
          >
            <Plus className="size-3" aria-hidden="true" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/**
 * Room around the flow when it is fitted. React Flow 13 reads a plain number as pixels,
 * and a node's caption hangs below and beside its tile, so the sides and bottom get more.
 */
export const FIT_VIEW = {
  maxZoom: 1,
  padding: { x: "80px", top: "40px", bottom: "90px" },
} as const;

export const edgeTypes = { flow: FlowEdge };

/** How every line on the canvas is drawn: with an arrow showing which way files go. */
export function flowEdge<T extends { id: string; source: string; target: string }>(edge: T) {
  return { ...edge, type: "flow" as const, markerEnd: { type: MarkerType.ArrowClosed } };
}

/** Where the trigger sits: one place to the left of the first step. */
export function triggerPosition(nodes: { position: { x: number; y: number } }[]) {
  if (nodes.length === 0) return { x: -NODE_GAP, y: 0 };
  const left = Math.min(...nodes.map((node) => node.position.x));
  const firsts = nodes.filter((node) => node.position.x === left);
  const y = firsts.reduce((sum, node) => sum + node.position.y, 0) / firsts.length;
  return { x: left - NODE_GAP, y };
}

/** Lines from the trigger to every step that nothing else feeds. */
export function triggerEdges(nodeIds: string[], edges: { target: string }[]): Edge[] {
  const fed = new Set(edges.map((edge) => edge.target));
  return nodeIds
    .filter((id) => !fed.has(id))
    .map((id) =>
      flowEdge({
        id: `${TRIGGER_ID}>${id}`,
        source: TRIGGER_ID,
        target: id,
        deletable: false,
        selectable: false,
        focusable: false,
      }),
    );
}

/** Ids of the steps nothing follows. */
export function lastNodeIds(nodeIds: string[], edges: { source: string }[]): Set<string> {
  const feeding = new Set(edges.map((edge) => edge.source));
  return new Set(nodeIds.filter((id) => !feeding.has(id)));
}
