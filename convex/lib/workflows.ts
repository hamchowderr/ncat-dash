// Workflows on the server: which automations each of a team's workflows is made of now,
// and what a run of one of them looks like with the workflow's review in it. The rules
// are in automation-core's workflows.ts.
import {
  type AutomationEdge,
  type AutomationNode,
  type ChainMember,
  type WorkflowKind,
  workflowEnds,
  workflowMembers,
  workflowReview,
  withWorkflowReview,
} from "@takewon/automation-core";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** The most workflows one team can have. */
export const MAX_WORKFLOWS = 100;

/** The team's automations as the links between them go: their live versions, which run. */
export function chainMembersOf(team: Doc<"automations">[]): ChainMember[] {
  return team.map((each) => ({
    id: each._id,
    name: each.name,
    trigger: each.trigger as ChainMember["trigger"],
    ...(each.moreTriggers?.length
      ? { moreTriggers: each.moreTriggers as ChainMember["moreTriggers"] }
      : {}),
    nodes: each.nodes,
  }));
}

export async function teamAutomations(
  ctx: QueryCtx,
  organizationId: string,
): Promise<Doc<"automations">[]> {
  return await ctx.db
    .query("automations")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(500);
}

export interface PlacedWorkflow {
  workflow: Doc<"workflows">;
  /** Its automations now, in the order they run. */
  ids: Id<"automations">[];
  /** Those whose files go out, where the review happens. */
  ends: Set<string>;
  /**
   * Set when its chain was joined to an older workflow's: that one's name. Its own
   * settings are not used until the chains are apart again.
   */
  joinedTo: string | null;
}

/**
 * Every workflow the team has, with the automations each is made of now. When two of
 * them have come to hold the same chain, the older one keeps it.
 */
export async function placedWorkflows(
  ctx: QueryCtx,
  organizationId: string,
  team?: Doc<"automations">[],
): Promise<PlacedWorkflow[]> {
  const workflows = await ctx.db
    .query("workflows")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(MAX_WORKFLOWS);
  if (workflows.length === 0) return [];
  const members = chainMembersOf(team ?? (await teamAutomations(ctx, organizationId)));
  const taken = new Map<string, string>();
  return workflows.map((workflow) => {
    const ids = workflowMembers(members, workflow.automationIds) as Id<"automations">[];
    const owner = ids.map((id) => taken.get(id)).find((name) => name !== undefined) ?? null;
    if (owner === null) for (const id of ids) taken.set(id, workflow.name);
    return { workflow, ids, ends: workflowEnds(members, ids), joinedTo: owner };
  });
}

/** The workflow an automation is part of now, or null. */
export async function workflowOf(
  ctx: QueryCtx,
  automation: Doc<"automations">,
  team?: Doc<"automations">[],
): Promise<PlacedWorkflow | null> {
  const placed = await placedWorkflows(ctx, automation.organizationId, team);
  return placed.find((each) => each.joinedTo === null && each.ids.includes(automation._id)) ?? null;
}

/**
 * The steps a run of `automation` takes: its own, with the review of the workflow it is
 * part of when that review is on. A test of one step never gets it.
 */
export async function workflowRunGraph(
  ctx: MutationCtx,
  automation: Doc<"automations">,
  nodes: AutomationNode[],
  edges: AutomationEdge[],
  test: boolean,
): Promise<{ nodes: AutomationNode[]; edges: AutomationEdge[]; workflowId?: Id<"workflows"> }> {
  if (test) return { nodes, edges };
  const placed = await workflowOf(ctx, automation);
  if (!placed) return { nodes, edges };
  const { workflow } = placed;
  const review = workflowReview(workflow.review, workflow.kind as WorkflowKind);
  if (!review.on) return { nodes, edges };
  const made = withWorkflowReview(
    nodes,
    edges,
    review,
    { id: workflow._id, name: workflow.name },
    placed.ends.has(automation._id),
  );
  return { ...made, workflowId: workflow._id };
}
