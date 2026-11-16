"use client";

import type { AutomationNode } from "@ncat-dash/automation-core";
import { getStep, type StepCategory } from "@ncat-dash/step-catalog";
import { type Edge, Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import {
  Code,
  Film,
  HardDriveUpload,
  Image as ImageIcon,
  type LucideIcon,
  Music,
  Shapes,
  Terminal,
  UserCheck,
  Wand2,
  Zap,
} from "lucide-react";

import { nodeTitle, type Trigger, TRIGGER_LABELS, triggerSummary } from "@/lib/automations";
import { CATEGORY_LABELS } from "@/lib/catalog";
import { cn } from "@/lib/utils";

import { StatusIcon, type StepStatus } from "./run-status";

export const TRIGGER_ID = "__trigger";

export const CATEGORY_ICONS: Record<StepCategory, LucideIcon> = {
  video: Film,
  audio: Music,
  media: Shapes,
  image: ImageIcon,
  recipe: Wand2,
  ffmpeg: Terminal,
  code: Code,
  storage: HardDriveUpload,
};

export type StepNodeData = {
  node: Omit<AutomationNode, "position">;
  status?: StepStatus;
  /** How many jobs the step fanned out to, in a run. */
  jobCount?: number;
};
export type TriggerNodeData = { trigger: Trigger; summary?: string };
export type StepFlowNode = Node<StepNodeData, "step">;
export type TriggerFlowNode = Node<TriggerNodeData, "trigger">;
export type FlowNode = StepFlowNode | TriggerFlowNode;

const shell =
  "bg-card text-card-foreground flex w-60 items-center gap-3 rounded-xl border p-3 shadow-xs transition-shadow";
const handle = "!size-2.5 !border-2 !border-background !bg-muted-foreground";

function StepNode({ data, selected }: NodeProps<StepFlowNode>) {
  const { node, status, jobCount } = data;
  const step = node.kind === "step" ? getStep(node.stepId ?? "") : undefined;
  const Icon = node.kind === "approval" ? UserCheck : step ? CATEGORY_ICONS[step.category] : Shapes;
  return (
    <div
      className={cn(
        shell,
        selected && "ring-ring/50 border-ring ring-3",
        status === "failed" && "border-destructive/60",
        status === "skipped" && "opacity-60",
      )}
    >
      <Handle type="target" position={Position.Top} className={handle} />
      <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <div className="grid min-w-0 flex-1 leading-tight">
        <span className="truncate text-sm font-medium">{nodeTitle(node)}</span>
        <span className="text-muted-foreground truncate text-xs">
          {node.kind === "approval"
            ? "Waits for a person"
            : step
              ? jobCount && jobCount > 1
                ? `${jobCount} files`
                : CATEGORY_LABELS[step.category]
              : "No longer in the catalog"}
        </span>
      </div>
      {status && <StatusIcon status={status} />}
      <Handle type="source" position={Position.Bottom} className={handle} />
    </div>
  );
}

function TriggerNode({ data, selected }: NodeProps<TriggerFlowNode>) {
  return (
    <div
      className={cn(
        shell,
        "border-primary/30 bg-primary/5",
        selected && "ring-ring/50 border-ring ring-3",
      )}
    >
      <div className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
        <Zap className="size-4" aria-hidden="true" />
      </div>
      <div className="grid min-w-0 flex-1 leading-tight">
        <span className="truncate text-sm font-medium">{TRIGGER_LABELS[data.trigger.kind]}</span>
        <span className="text-muted-foreground truncate text-xs">
          {data.summary ?? triggerSummary(data.trigger)}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className={handle} />
    </div>
  );
}

export const nodeTypes = { step: StepNode, trigger: TriggerNode };

/** Where the trigger box sits: centred above the highest step. */
export function triggerPosition(nodes: { position: { x: number; y: number } }[]) {
  if (nodes.length === 0) return { x: 0, y: 0 };
  const top = nodes.reduce((a, b) => (b.position.y < a.position.y ? b : a));
  return { x: top.position.x, y: top.position.y - 130 };
}

/** Dashed lines from the trigger to every step that nothing else feeds. */
export function triggerEdges(nodeIds: string[], edges: { target: string }[]): Edge[] {
  const fed = new Set(edges.map((edge) => edge.target));
  return nodeIds
    .filter((id) => !fed.has(id))
    .map((id) => ({
      id: `${TRIGGER_ID}>${id}`,
      source: TRIGGER_ID,
      target: id,
      deletable: false,
      selectable: false,
      focusable: false,
      style: { strokeDasharray: "5 5" },
    }));
}
