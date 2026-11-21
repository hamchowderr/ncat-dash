import { checkSpend } from "@ncat-dash/automation-core";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";

/**
 * What a run's AI steps spend, against the team's limit (Settings → Runs). The picture
 * is in automation-core ai-spend.ts: before a step asks the AI, it holds a generous guess
 * against the run (`hold`); once answered, the guess makes way for what was really spent
 * (`settle`). Holding is one mutation, so two AI steps of the same run asking at the same
 * moment cannot both slip under the limit.
 */

/** The team's limit for one run, in micros, or null for none. */
export async function aiLimitOf(
  ctx: Pick<QueryCtx, "db">,
  organizationId: string,
): Promise<number | null> {
  const settings = await ctx.db
    .query("teamSettings")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .first();
  return settings?.aiLimit ?? null;
}

/**
 * Holds `micros` against the step's run, in place of anything the step held before.
 * Refuses, holding nothing new, when that would take the run past its limit.
 */
export async function holdSpend(
  ctx: MutationCtx,
  runStepId: Id<"runSteps">,
  micros: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const step = await ctx.db.get(runStepId);
  if (!step) return { ok: true };
  const run = await ctx.db.get(step.runId);
  if (!run) return { ok: true };
  const before = step.aiHeld ?? 0;
  const heldByOthers = Math.max(0, (run.aiHeld ?? 0) - before);
  const check = checkSpend(
    await aiLimitOf(ctx, run.organizationId),
    run.aiSpent ?? 0,
    heldByOthers,
    micros,
  );
  if (!check.ok) {
    if (before > 0) {
      await ctx.db.patch(step._id, { aiHeld: 0 });
      await ctx.db.patch(run._id, { aiHeld: heldByOthers });
    }
    return check;
  }
  await ctx.db.patch(step._id, { aiHeld: micros });
  await ctx.db.patch(run._id, { aiHeld: heldByOthers + micros });
  return { ok: true };
}

/** Lets go of what the step held and adds what it really spent, to the step and its run. */
export async function settleSpend(
  ctx: MutationCtx,
  runStepId: Id<"runSteps">,
  micros: number,
): Promise<void> {
  const step = await ctx.db.get(runStepId);
  if (!step) return;
  const run = await ctx.db.get(step.runId);
  const spent = Math.max(0, Math.ceil(micros));
  await ctx.db.patch(step._id, { aiHeld: 0, aiSpent: (step.aiSpent ?? 0) + spent });
  if (run) {
    await ctx.db.patch(run._id, {
      aiHeld: Math.max(0, (run.aiHeld ?? 0) - (step.aiHeld ?? 0)),
      aiSpent: (run.aiSpent ?? 0) + spent,
    });
  }
}

export const hold = internalMutation({
  args: { runStepId: v.id("runSteps"), micros: v.number() },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({ ok: v.literal(false), message: v.string() }),
  ),
  handler: async (ctx, args) => await holdSpend(ctx, args.runStepId, args.micros),
});

export const settle = internalMutation({
  args: { runStepId: v.id("runSteps"), micros: v.number() },
  handler: async (ctx, args) => {
    await settleSpend(ctx, args.runStepId, args.micros);
  },
});
