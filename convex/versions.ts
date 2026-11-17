import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { isMember, requireMember } from "./lib/authz";
import { changesBetween, runsTheSame, VERSIONS_KEPT } from "./lib/versions";
import { edgeValidator, nodeValidator, triggerValidator } from "./schema";

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

const sourceValidator = v.union(
  v.literal("created"),
  v.literal("saved"),
  v.literal("published"),
  v.literal("imported"),
);

/**
 * An automation's versions, newest first: who made each one live and when, what changed
 * from the one before, and which one is running now. Their steps come from `get`.
 */
export const list = query({
  args: { automationId: v.id("automations") },
  returns: v.union(
    v.null(),
    v.object({
      hasDraft: v.boolean(),
      versions: v.array(
        v.object({
          _id: v.id("automationVersions"),
          number: v.number(),
          at: v.number(),
          source: sourceValidator,
          restoredFrom: v.union(v.null(), v.number()),
          byName: v.string(),
          // What changed from the version before it. Empty for the first.
          changes: v.array(v.string()),
          // The version triggers run now.
          live: v.boolean(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const automation = await ctx.db.get(args.automationId);
    if (!automation || !(await isMember(ctx, automation.organizationId))) return null;
    const versions = await ctx.db
      .query("automationVersions")
      .withIndex("by_automation_and_number", (q) => q.eq("automationId", automation._id))
      .order("desc")
      .take(VERSIONS_KEPT);
    // The newest version that runs the same as the live one is the live one.
    const liveIndex = versions.findIndex((version) => runsTheSame(version, automation));
    return {
      hasDraft: automation.draft !== undefined,
      versions: versions.map((version, index) => {
        const before: Doc<"automationVersions"> | undefined = versions[index + 1];
        return {
          _id: version._id,
          number: version.number,
          at: version._creationTime,
          source: version.source,
          restoredFrom: version.restoredFrom ?? null,
          byName: version.byName,
          changes: before ? changesBetween(before, version) : [],
          live: index === liveIndex,
        };
      }),
    };
  },
});

/** One version's steps, to look at before bringing it back. */
export const get = query({
  args: { versionId: v.id("automationVersions") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("automationVersions"),
      number: v.number(),
      name: v.string(),
      trigger: triggerValidator,
      nodes: v.array(nodeValidator),
      edges: v.array(edgeValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version || !(await isMember(ctx, version.organizationId))) return null;
    return {
      _id: version._id,
      number: version.number,
      name: version.name,
      trigger: version.trigger,
      nodes: version.nodes,
      edges: version.edges,
    };
  },
});

/**
 * Brings an earlier version back as the draft. Nothing that runs changes until someone
 * publishes it, and an unpublished draft is replaced. Bringing back the version that is
 * already live just throws the draft away.
 */
export const restore = mutation({
  args: { versionId: v.id("automationVersions") },
  returns: v.object({ draft: v.boolean() }),
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) fail("not_found", "This version is no longer kept.");
    const { userId } = await requireMember(ctx, version.organizationId);
    const automation = await ctx.db.get(version.automationId);
    if (!automation) fail("not_found", "This automation no longer exists.");
    if (runsTheSame(version, automation)) {
      if (!automation.draft) fail("invalid_input", "This is already the live version.");
      await ctx.db.patch(automation._id, { draft: undefined });
      return { draft: false };
    }
    await ctx.db.patch(automation._id, {
      draft: {
        name: version.name,
        trigger: version.trigger,
        nodes: version.nodes,
        edges: version.edges,
        updatedBy: userId,
        updatedAt: Date.now(),
        restoredFrom: version.number,
      },
    });
    return { draft: true };
  },
});
