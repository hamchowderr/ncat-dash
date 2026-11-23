import type { AutomationEdge, AutomationNode } from "@takewon/automation-core";
import { Fragment } from "react";

import { nodeTitle, type Trigger, TRIGGER_LABELS } from "@/lib/automations";
import { cn } from "@/lib/utils";

import { nodeLook, TRIGGER_ICONS, TRIGGER_TINT } from "./flow-nodes";

type Step = Pick<AutomationNode, "id" | "kind" | "stepId" | "input" | "label" | "position">;

/** Steps grouped into columns, left to right, the way they sit on the canvas. */
function columns(nodes: Step[], edges: AutomationEdge[]): Step[][] {
  const depth = new Map<string, number>();
  const depthOf = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const sources = edges.filter((edge) => edge.target === id).map((edge) => edge.source);
    const value = sources.length ? Math.max(...sources.map((s) => depthOf(s, seen))) + 1 : 0;
    depth.set(id, value);
    return value;
  };
  const result: Step[][] = [];
  for (const node of nodes) (result[depthOf(node.id, new Set())] ??= []).push(node);
  return result.filter(Boolean);
}

const tile = "bg-card flex items-center justify-center shadow-xs";

/** A small, still picture of an automation: its trigger and steps joined by lines. */
export function FlowStrip({
  trigger,
  nodes,
  edges,
  size = "md",
  maxColumns,
  className,
}: {
  trigger: Trigger;
  nodes: Step[];
  edges: AutomationEdge[];
  size?: "sm" | "md";
  /** At most this many columns of steps; the rest are counted in a last "+n" tile. */
  maxColumns?: number;
  className?: string;
}) {
  const TriggerIcon = TRIGGER_ICONS[trigger.kind];
  const box = size === "sm" ? "size-7 rounded-md" : "size-10 rounded-lg";
  const icon = size === "sm" ? "size-3.5" : "size-5";
  const line = size === "sm" ? "w-3" : "w-5";
  const all = columns(nodes, edges);
  const shown =
    maxColumns !== undefined && all.length > maxColumns ? all.slice(0, maxColumns) : all;
  const more = all.slice(shown.length).reduce((count, column) => count + column.length, 0);
  return (
    <div
      className={cn("flex items-center", className)}
      role="img"
      aria-label={`${TRIGGER_LABELS[trigger.kind]}, then ${nodes.map((node) => nodeTitle(node)).join(", then ")}`}
    >
      <span
        className={cn(tile, box, size === "sm" ? "rounded-l-xl" : "rounded-l-2xl")}
        title={TRIGGER_LABELS[trigger.kind]}
      >
        <TriggerIcon className={cn(icon, TRIGGER_TINT)} strokeWidth={1.7} aria-hidden="true" />
      </span>
      {shown.map((column, index) => (
        <Fragment key={index}>
          <span className={cn("bg-border h-px shrink-0", line)} aria-hidden="true" />
          <span className="flex flex-col gap-1">
            {column.map((node) => {
              const look = nodeLook(node);
              return (
                <span key={node.id} className={cn(tile, box)} title={nodeTitle(node)}>
                  <look.icon className={cn(icon, look.tint)} strokeWidth={1.7} aria-hidden="true" />
                </span>
              );
            })}
          </span>
        </Fragment>
      ))}
      {more > 0 && (
        <>
          <span className={cn("bg-border h-px shrink-0", line)} aria-hidden="true" />
          <span
            className={cn(tile, box, "text-muted-foreground text-xs font-medium tabular-nums")}
            title={`${more} more ${more === 1 ? "step" : "steps"}`}
            data-testid="flow-strip-more"
          >
            +{more}
          </span>
        </>
      )}
    </div>
  );
}
