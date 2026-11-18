"use client";

import {
  type AutomationEdge,
  type AutomationNode,
  type Brand,
  BRANCH_LABELS,
  BRAND_WORDS,
  branchesOfKind,
  canFailOver,
  FAILURE_WAY,
  conditionSentence,
  missingBrandOf,
  missingSettings,
  NODE_GAP,
  type NodeGroup,
  nodeTypeOf,
  waitSentence,
  approvalShort,
  waitsForRun,
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
  Clock,
  Code,
  Film,
  FolderInput,
  FolderKanban,
  Hand,
  Layers,
  HardDriveUpload,
  Image as ImageIcon,
  type LucideIcon,
  Music,
  Plus,
  Scissors,
  Shapes,
  Signpost,
  Terminal,
  TriangleAlert,
  Upload,
  UserCheck,
  Waypoints,
  Webhook,
  Zap,
  CircleCheckBig,
  Workflow,
} from "lucide-react";
import { createContext, useContext } from "react";

import {
  nodeTitle,
  RUN_TRIGGER_LABELS,
  type RunTriggerKind,
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
  logic: Waypoints,
  people: UserCheck,
};

export const TRIGGER_ICONS: Record<TriggerKind, LucideIcon> = {
  manual: Hand,
  webhook: Webhook,
  schedule: CalendarClock,
  upload: Upload,
  folder: FolderInput,
  finished: CircleCheckBig,
  slot: FolderKanban,
};

export const RUN_TRIGGER_ICONS: Record<RunTriggerKind, LucideIcon> = {
  ...TRIGGER_ICONS,
  automation: Workflow,
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
const LOGIC_TINT = "text-indigo-600 dark:text-indigo-400";

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
      kind: approvalShort(node.input),
    };
  }
  if (node.kind === "clips") {
    return {
      icon: Scissors,
      tint: "text-orange-600 dark:text-orange-400",
      kind: String(node.input.platform ?? "No platform picked"),
    };
  }
  if (node.kind === "if") {
    return { icon: Signpost, tint: LOGIC_TINT, kind: conditionSentence(node.input) };
  }
  if (node.kind === "wait") {
    return { icon: Clock, tint: LOGIC_TINT, kind: waitSentence(node.input) };
  }
  if (node.kind === "automation") {
    return {
      icon: Workflow,
      tint: LOGIC_TINT,
      kind: waitsForRun(node) ? "Waits for it to finish" : "Starts it and carries on",
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
  /** For an If in the editor: the ways out nothing hangs off yet. Each offers to add a step. */
  openWays?: string[];
  /** In a run: what happened here in a few words, shown in place of the usual second line. */
  note?: string;
  /**
   * The way out for when this step fails: "used" when something hangs off it, "offered"
   * when the step is chosen in the editor, so a line can be drawn from it.
   */
  failWay?: "used" | "offered";
};
/** On a run's canvas, `runKind` is what started the run, which can be another run. */
export type TriggerNodeData = { trigger: Trigger; summary?: string; runKind?: RunTriggerKind };
export type StepFlowNode = Node<StepNodeData, "step">;
export type TriggerFlowNode = Node<TriggerNodeData, "trigger">;
export type FlowNode = StepFlowNode | TriggerFlowNode;

/** Set by the editor; absent on a run, where nothing can be added. */
/** The team's brand, so a step knows whether Settings already supplies its logo or font. */
export const BrandContext = createContext<Brand>({});

export const AddAfterContext = createContext<((nodeId: string, way?: string) => void) | null>(null);

const tile =
  "bg-card relative flex size-20 items-center justify-center border border-transparent shadow-[0_1px_2px_rgb(0_0_0/0.05),0_6px_16px_-4px_rgb(0_0_0/0.10)] transition-[box-shadow,border-color]";
const caption =
  "pointer-events-none absolute top-full left-1/2 mt-2 grid w-44 -translate-x-1/2 text-center leading-tight";
const handle = "!size-2.5 !border-2 !border-background !bg-muted-foreground";
const plus =
  "nodrag bg-card text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring/50 absolute left-full ml-10 flex -translate-y-1/2 items-center justify-center rounded-md shadow-xs outline-none before:absolute before:right-full before:h-px before:w-10 before:bg-[var(--xy-edge-stroke-default,#b1b1b7)] focus-visible:ring-3";
/** How far down the tile each way out of an If sits, in percent: Yes above, No below. */
const WAY_TOP = [28, 72];
/** How far down the tile the way out for when a step fails sits, in percent. */
const FAIL_TOP = 84;

function StepNode({ id, data, selected }: NodeProps<StepFlowNode>) {
  const { node, status, jobCount, last, openWays, note, failWay } = data;
  const ways = branchesOfKind(node.kind);
  const look = nodeLook({ ...node, input: node.input });
  const addAfter = useContext(AddAfterContext);
  const brand = useContext(BrandContext);
  const nodeType = nodeTypeOf(node);
  const missing = status ? [] : missingSettings({ ...node, position: { x: 0, y: 0 } }, brand);
  const missingBrand = status || !nodeType ? [] : missingBrandOf(nodeType, node.input, brand);
  const second = node.off
    ? "Turned off"
    : note
      ? note
      : jobCount && jobCount > 1 && status && status !== "pending" && ways.length === 0
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
          node.off && "border-muted-foreground/40 border-dashed opacity-50",
        )}
      >
        <Handle type="target" position={Position.Left} className={handle} />
        <look.icon
          className={cn("size-8", look.tint, ways.length > 0 && "-translate-x-2")}
          strokeWidth={1.6}
          aria-hidden="true"
        />
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
        {canFailOver(node.kind) && (
          // The way out for when the step fails, low on its right, in the colour of an error.
          // Always there, so lines can attach to it; seen only when it is used or chosen.
          <span className={cn(!failWay && "pointer-events-none opacity-0")} aria-hidden={!failWay}>
            {failWay === "used" && (
              <span
                className="text-destructive pointer-events-none absolute right-2 -translate-y-1/2 text-[10px] leading-none font-medium"
                style={{ top: `${FAIL_TOP}%` }}
              >
                Fails
              </span>
            )}
            <Handle
              id={FAILURE_WAY}
              type="source"
              position={Position.Right}
              isConnectable={Boolean(failWay)}
              className="!border-background !bg-destructive !size-2.5 !border-2"
              style={{ top: `${FAIL_TOP}%` }}
              title="Drag to the step that runs when this one fails"
            />
          </span>
        )}
        {ways.length === 0 ? (
          <Handle type="source" position={Position.Right} className={handle} />
        ) : (
          // An If has a way out for the files that pass and one for the rest, each named.
          ways.map((way, index) => (
            <span key={way}>
              <span
                className="text-muted-foreground pointer-events-none absolute right-2 -translate-y-1/2 text-[10px] leading-none font-medium"
                style={{ top: `${WAY_TOP[index]}%` }}
              >
                {BRANCH_LABELS[way] ?? way}
              </span>
              <Handle
                id={way}
                type="source"
                position={Position.Right}
                className={handle}
                style={{ top: `${WAY_TOP[index]}%` }}
              />
            </span>
          ))
        )}
      </div>
      {last && addAfter && ways.length === 0 && (
        <button
          type="button"
          aria-label={`Add a step after ${nodeTitle(node)}`}
          onClick={(event) => {
            event.stopPropagation();
            addAfter(id);
          }}
          className={cn(plus, "top-1/2 size-7")}
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      )}
      {addAfter &&
        ways.map(
          (way, index) =>
            openWays?.includes(way) && (
              <button
                key={way}
                type="button"
                aria-label={`Add a step after ${nodeTitle(node)}, on ${BRANCH_LABELS[way] ?? way}`}
                onClick={(event) => {
                  event.stopPropagation();
                  addAfter(id, way);
                }}
                className={cn(plus, "size-6")}
                style={{ top: `${WAY_TOP[index]}%` }}
              >
                <Plus className="size-3.5" aria-hidden="true" />
              </button>
            ),
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
  const Icon = data.runKind ? RUN_TRIGGER_ICONS[data.runKind] : TRIGGER_ICONS[data.trigger.kind];
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
        <span className="truncate text-sm font-medium">
          {data.runKind ? RUN_TRIGGER_LABELS[data.runKind] : TRIGGER_LABELS[data.trigger.kind]}
        </span>
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
  sourceHandleId,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  // The way for when a step fails is dashed, in the colour of an error.
  const failing = sourceHandleId === FAILURE_WAY;
  const insert = useContext(InsertOnEdgeContext);
  // On a run: how many files went along this line, once the step before has finished.
  const passed = (data as { passed?: number } | undefined)?.passed;
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
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        style={failing ? { ...style, stroke: "var(--destructive)", strokeDasharray: "5 4" } : style}
      />
      {insert && (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label="Add a step here"
            onClick={() => insert(source, target)}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className="nodrag nopan bg-card text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring/50 pointer-events-auto absolute flex size-5 items-center justify-center rounded-md shadow-xs opacity-70 outline-none transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-3"
          >
            <Plus className="size-3" aria-hidden="true" />
          </button>
        </EdgeLabelRenderer>
      )}
      {!insert && passed !== undefined && (
        <EdgeLabelRenderer>
          <span
            data-passed={passed}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className={cn(
              "bg-card absolute rounded-full px-1.5 py-px text-[10px] leading-4 font-medium tabular-nums shadow-xs",
              passed === 0 ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {passed === 0 ? "none" : passed === 1 ? "1 file" : `${passed} files`}
          </span>
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

/** A saved connection as the canvas holds it. The way out of an If becomes the handle it leaves by. */
export function canvasEdge({ id, source, target, branch }: AutomationEdge): Edge {
  return { id, source, target, ...(branch ? { sourceHandle: branch } : {}) };
}

/** A connection on the canvas as it is saved. */
export function savedEdge(edge: Edge): AutomationEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle ? { branch: edge.sourceHandle } : {}),
  };
}

/** The ways out of each If that nothing hangs off yet, by step id. */
export function openWaysOf(
  nodes: { id: string; kind: string }[],
  edges: AutomationEdge[],
): Map<string, string[]> {
  return new Map(
    nodes.flatMap((node) => {
      const ways = branchesOfKind(node.kind);
      if (ways.length === 0) return [];
      const used = edges.filter((edge) => edge.source === node.id).map((edge) => edge.branch);
      return [[node.id, ways.filter((way) => !used.includes(way))]];
    }),
  );
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
export function lastNodeIds(
  nodeIds: string[],
  edges: { source: string; sourceHandle?: string | null }[],
): Set<string> {
  // A step that only has a way for when it fails still offers to carry on.
  const feeding = new Set(
    edges.filter((edge) => edge.sourceHandle !== FAILURE_WAY).map((edge) => edge.source),
  );
  return new Set(nodeIds.filter((id) => !feeding.has(id)));
}
