import {
  type AutomationEdge,
  type AutomationNode,
  downstreamOf,
  failsOver,
  nodeTypeOf,
} from "@ncat-dash/automation-core";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { advance } from "./runner";

/**
 * Picking a failed run up where it stopped: the steps that worked keep their files, the
 * step that failed starts again, and everything after it runs as usual. Unlike Run
 * again, nothing that already worked is done twice.
 */

export type PickUpCheck =
  { ok: true; stepId: Id<"runSteps">; stepName: string | null } | { ok: false; reason: string };

/** The step that ended a failed run: one that failed with no way for when it fails. */
export function brokenSteps(run: Doc<"runs">, steps: Doc<"runSteps">[]): Doc<"runSteps">[] {
  const edges = run.edges as AutomationEdge[];
  return steps.filter((step) => step.status === "failed" && !failsOver(step.nodeId, edges));
}

function stepName(run: Doc<"runs">, nodeId: string): string | null {
  const node = (run.nodes as AutomationNode[]).find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  return node.label ?? nodeTypeOf(node)?.title ?? null;
}

/** Whether a run can be picked up where it stopped, or why not, in plain words. */
export function pickUpCheck(run: Doc<"runs">, steps: Doc<"runSteps">[]): PickUpCheck {
  if (run.status !== "failed") {
    return { ok: false, reason: "Only a run that failed can be picked up where it stopped." };
  }
  if (run.test) {
    return { ok: false, reason: "This was a test of one step. Test it again instead." };
  }
  if (run.parentRunStepId) {
    return {
      ok: false,
      reason: "Another run's step started this one. Pick up that run instead.",
    };
  }
  const broken = brokenSteps(run, steps);
  if (broken.length === 0) {
    return { ok: false, reason: "No step failed in this run. Run it again instead." };
  }
  if (broken.every((step) => step.decidedBy || step.decidedAutomatically)) {
    return {
      ok: false,
      reason: "It was rejected at an approval step. Run it again to ask for approval again.",
    };
  }
  const first = broken.find((step) => !step.decidedBy && !step.decidedAutomatically)!;
  return { ok: true, stepId: first._id, stepName: stepName(run, first.nodeId) };
}

/** Same steps, same kinds, joined the same way: settings can change, the shape not. */
export function sameShape(
  run: Pick<Doc<"runs">, "nodes" | "edges">,
  automation: Pick<Doc<"automations">, "nodes" | "edges">,
): boolean {
  const nodeKey = (node: AutomationNode) => `${node.id}|${node.kind}|${node.stepId ?? ""}`;
  const edgeKey = (edge: AutomationEdge) => `${edge.source}>${edge.target}|${edge.branch ?? ""}`;
  const keys = <T>(items: T[], key: (item: T) => string) => items.map(key).sort().join("\n");
  return (
    keys(run.nodes as AutomationNode[], nodeKey) ===
      keys(automation.nodes as AutomationNode[], nodeKey) &&
    keys(run.edges as AutomationEdge[], edgeKey) ===
      keys(automation.edges as AutomationEdge[], edgeKey)
  );
}

export async function stepsOf(ctx: QueryCtx, runId: Id<"runs">) {
  return await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .take(200);
}

/**
 * Picks a failed run up where it stopped. The failed steps, and the ones skipped
 * because of them, start over; when the automation still has the same steps, they use
 * its settings as they are now, so a fixed setting counts.
 */
export async function pickUp(
  ctx: MutationCtx,
  run: Doc<"runs">,
): Promise<{ ok: true; withCurrentSettings: boolean } | { ok: false; reason: string }> {
  const steps = await stepsOf(ctx, run._id);
  const check = pickUpCheck(run, steps);
  if (!check.ok) return check;

  const automation = await ctx.db.get(run.automationId);
  const withCurrentSettings = automation !== null && sameShape(run, automation);

  const edges = run.edges as AutomationEdge[];
  const again = new Set<string>();
  for (const step of brokenSteps(run, steps)) {
    again.add(step.nodeId);
    for (const below of downstreamOf(step.nodeId, edges)) again.add(below);
  }
  for (const step of steps) {
    if (!again.has(step.nodeId)) continue;
    // Only what never got to finish starts over; a step further on that did finish (on
    // another branch) keeps its work.
    if (step.status !== "failed" && step.status !== "skipped") continue;
    await ctx.db.replace(step._id, {
      runId: step.runId,
      organizationId: step.organizationId,
      nodeId: step.nodeId,
      status: "pending",
      jobIds: [],
      outputs: [],
      error: null,
      startedAt: null,
      finishedAt: null,
    });
  }

  await ctx.db.patch(run._id, {
    status: "running",
    error: null,
    finishedAt: null,
    pickedUp: (run.pickedUp ?? 0) + 1,
    ...(withCurrentSettings && automation
      ? { nodes: automation.nodes, automationName: automation.name }
      : {}),
  });
  await advance(ctx, run._id);
  return { ok: true, withCurrentSettings };
}
