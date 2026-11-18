import { type SavedTeamStep, setTeamSteps } from "@ncat-dash/step-catalog";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** A team can keep this many steps of its own. */
export const MAX_TEAM_STEPS = 100;

export function savedTeamStep(doc: Doc<"teamSteps">): SavedTeamStep {
  return {
    id: doc._id,
    title: doc.title,
    description: doc.description,
    blanks: doc.blanks,
    primary: doc.primary,
    request: doc.request as Record<string, unknown>,
  };
}

export async function teamStepsOf(
  ctx: Pick<QueryCtx, "db">,
  organizationId: string,
): Promise<Doc<"teamSteps">[]> {
  return await ctx.db
    .query("teamSteps")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(MAX_TEAM_STEPS);
}

/**
 * Makes the team's own steps the ones the step catalog knows for the rest of this
 * function, so its automations' team steps can be checked, drawn and run. Only this
 * team's are known: any other team's are dropped.
 */
export async function withTeamSteps(ctx: Pick<QueryCtx, "db">, organizationId: string) {
  const docs = await teamStepsOf(ctx, organizationId);
  setTeamSteps(docs.map(savedTeamStep));
  return docs;
}
