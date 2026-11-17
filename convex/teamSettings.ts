import { BRAND_KEYS, brandProblem, readUploadRef } from "@ncat-dash/automation-core";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { MANAGER_ROLES, requireMember } from "./lib/authz";
import {
  brandOf,
  DEFAULT_PARALLEL_JOBS,
  MAX_PARALLEL_JOBS,
  parallelLimit,
  pump,
} from "./lib/queue";
import { brandValidator } from "./schema";

export const get = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { role } = await requireMember(ctx, args.organizationId);
    return {
      maxParallelJobs: await parallelLimit(ctx, args.organizationId),
      brand: await brandOf(ctx, args.organizationId),
      mostAllowed: MAX_PARALLEL_JOBS,
      canEdit: MANAGER_ROLES.includes(role),
    };
  },
});

/** Sets how many jobs the team may have on its toolkit at once. Owners and admins only. */
export const setMaxParallelJobs = mutation({
  args: { organizationId: v.string(), maxParallelJobs: v.number() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const limit = args.maxParallelJobs;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PARALLEL_JOBS) {
      throw new ConvexError({
        code: "invalid_input",
        message: `Choose a whole number from 1 to ${MAX_PARALLEL_JOBS}.`,
      });
    }
    const existing = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    if (existing) await ctx.db.patch(existing._id, { maxParallelJobs: limit });
    else {
      await ctx.db.insert("teamSettings", {
        organizationId: args.organizationId,
        maxParallelJobs: limit,
      });
    }
    // A higher limit lets waiting jobs start straight away.
    await pump(ctx, args.organizationId);
  },
});

/**
 * Sets the team's brand: the logo, colour, font and music every automation uses. An empty
 * value clears that item. Owners and admins only.
 */
export const setBrand = mutation({
  args: { organizationId: v.string(), brand: brandValidator },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const brand: Record<string, string> = {};
    for (const key of BRAND_KEYS) {
      const value = args.brand[key]?.trim();
      if (!value) continue;
      const problem = brandProblem(key, value);
      if (problem) throw new ConvexError({ code: "invalid_input", message: problem });
      const uploadId = readUploadRef(value);
      if (uploadId) {
        const id = ctx.db.normalizeId("uploads", uploadId);
        const upload = id ? await ctx.db.get(id) : null;
        if (!upload || upload.organizationId !== args.organizationId || upload.status !== "ready") {
          throw new ConvexError({ code: "not_found", message: "That upload is no longer there." });
        }
      }
      brand[key] = value;
    }
    const existing = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    if (existing) await ctx.db.patch(existing._id, { brand });
    else {
      await ctx.db.insert("teamSettings", {
        organizationId: args.organizationId,
        maxParallelJobs: DEFAULT_PARALLEL_JOBS,
        brand,
      });
    }
  },
});
