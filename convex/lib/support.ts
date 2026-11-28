import { SupportTickets } from "convex-support-tickets";

import { components } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** Customers' help requests, kept by the convex-support-tickets component (support.ts). */
export const support = new SupportTickets(components.supportTickets);

/** The longest step log kept with a request. */
export const STEP_LOG_LIMIT = 8_000;

/**
 * A failed run's steps as plain lines, in the automation's order: "Caption video: failed:
 * <error>". Kept with a problem report so support (and the Factory, once a platform
 * admin sends it there) sees what broke without opening the team's runs.
 */
export async function stepLogOf(ctx: QueryCtx, run: Doc<"runs">): Promise<string> {
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .collect();
  const order = new Map(run.nodes.map((node, index) => [node.id, index]));
  const nameOf = (nodeId: string) => {
    const node = run.nodes.find((each) => each.id === nodeId);
    return node?.label?.trim() || node?.stepId || node?.kind || nodeId;
  };
  const lines = [`${run.automationName}: ${run.status}${run.error ? `: ${run.error}` : ""}`];
  for (const step of [...steps].sort(
    (a, b) => (order.get(a.nodeId) ?? 0) - (order.get(b.nodeId) ?? 0),
  )) {
    lines.push(`- ${nameOf(step.nodeId)}: ${step.status}${step.error ? `: ${step.error}` : ""}`);
  }
  const log = lines.join("\n");
  return log.length > STEP_LOG_LIMIT ? `${log.slice(0, STEP_LOG_LIMIT - 1)}�` : log;
}
