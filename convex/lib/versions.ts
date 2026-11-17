import { type AutomationDraft, draftChanges } from "@ncat-dash/automation-core";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { authComponent } from "../auth";

/** How many versions of one automation are kept. The oldest go first. */
export const VERSIONS_KEPT = 100;

export type Content = Pick<Doc<"automations">, "name" | "trigger" | "nodes" | "edges">;
export type VersionSource = Doc<"automationVersions">["source"];

/**
 * What changed from one version to the next, in plain words. Moving steps around on the
 * canvas is not a change: it runs the same.
 */
export function changesBetween(before: Content, after: Content): string[] {
  return draftChanges(before as AutomationDraft, after as AutomationDraft);
}

export function runsTheSame(a: Content, b: Content): boolean {
  return changesBetween(a, b).length === 0;
}

export async function latestVersion(
  ctx: QueryCtx | MutationCtx,
  automationId: Id<"automations">,
): Promise<Doc<"automationVersions"> | null> {
  return await ctx.db
    .query("automationVersions")
    .withIndex("by_automation_and_number", (q) => q.eq("automationId", automationId))
    .order("desc")
    .first();
}

/**
 * Keeps what just became the live version as a new numbered version. Nothing is kept
 * when it runs the same as the newest one, so moving steps around does not add one.
 * Returns the new number, or null when nothing was kept.
 */
export async function recordVersion(
  ctx: MutationCtx,
  automation: { _id: Id<"automations">; organizationId: string },
  content: Content,
  by: { userId: string; source: VersionSource; restoredFrom?: number },
): Promise<number | null> {
  const latest = await latestVersion(ctx, automation._id);
  if (latest && runsTheSame(latest, content)) return null;
  const user = await authComponent.safeGetAuthUser(ctx);
  const number = (latest?.number ?? 0) + 1;
  await ctx.db.insert("automationVersions", {
    automationId: automation._id,
    organizationId: automation.organizationId,
    number,
    name: content.name,
    trigger: content.trigger,
    nodes: content.nodes,
    edges: content.edges,
    source: by.source,
    ...(by.restoredFrom !== undefined ? { restoredFrom: by.restoredFrom } : {}),
    byId: by.userId,
    byName: user?.name?.trim() || "Someone",
  });
  const old = await ctx.db
    .query("automationVersions")
    .withIndex("by_automation_and_number", (q) =>
      q.eq("automationId", automation._id).lte("number", number - VERSIONS_KEPT),
    )
    .take(50);
  for (const version of old) await ctx.db.delete(version._id);
  return number;
}

/** Removes every kept version of an automation that is being deleted. */
export async function deleteVersions(ctx: MutationCtx, automationId: Id<"automations">) {
  const versions = await ctx.db
    .query("automationVersions")
    .withIndex("by_automation_and_number", (q) => q.eq("automationId", automationId))
    .take(VERSIONS_KEPT + 50);
  for (const version of versions) await ctx.db.delete(version._id);
}
