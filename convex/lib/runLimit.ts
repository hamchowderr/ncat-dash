/**
 * How many runs of one automation go at once. An automation can be set to run only a few
 * at a time; a run started while that many are under way waits, steps untouched, until
 * one ends, and then starts in the order they came in. Test runs of a single step are
 * never held and never count.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { advance } from "./runner";

export { RUNS_AT_ONCE } from "@takewon/automation-core";

// The most runs of one automation looked at to count those under way.
const LOOKED_AT = 200;

async function underWay(ctx: MutationCtx, automationId: Id<"automations">) {
  const found: Doc<"runs">[] = [];
  for (const status of ["running", "waiting"] as const) {
    found.push(
      ...(await ctx.db
        .query("runs")
        .withIndex("by_automation_and_status", (q) =>
          q.eq("automationId", automationId).eq("status", status),
        )
        .take(LOOKED_AT)),
    );
  }
  return found;
}

/** Whether a new run of this automation has to wait for one under way to end. */
export async function mustWaitForSlot(
  ctx: MutationCtx,
  automation: Doc<"automations">,
  runId: Id<"runs">,
  test: boolean,
): Promise<boolean> {
  const limit = automation.runsAtOnce;
  if (!limit || test) return false;
  const going = (await underWay(ctx, automation._id)).filter(
    (run) => run._id !== runId && !run.heldForSlot && !run.test,
  );
  return going.length >= limit;
}

/**
 * Starts the runs of an automation that were waiting for a slot, oldest first, while
 * fewer than its limit are under way. Called when one of its runs ends, and when the
 * limit is raised or taken away.
 */
export async function startWaitingRuns(
  ctx: MutationCtx,
  automationId: Id<"automations">,
): Promise<void> {
  const automation = await ctx.db.get(automationId);
  const runs = await underWay(ctx, automationId);
  const held = runs
    .filter((run) => run.heldForSlot)
    .sort((a, b) => a._creationTime - b._creationTime);
  if (held.length === 0) return;
  let going = runs.filter((run) => !run.heldForSlot && !run.test).length;
  const limit = automation?.runsAtOnce ?? Infinity;
  for (const run of held) {
    if (going >= limit) break;
    await ctx.db.patch(run._id, { status: "running", heldForSlot: undefined });
    going += 1;
    await advance(ctx, run._id);
  }
}
