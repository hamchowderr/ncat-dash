import { BRAND_KEYS, brandProblem, readUploadRef } from "@ncat-dash/automation-core";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { MANAGER_ROLES, requireMember } from "./lib/authz";
import {
  brandAndMusicOf,
  DEFAULT_PARALLEL_JOBS,
  MAX_PARALLEL_JOBS,
  parallelLimit,
  pump,
} from "./lib/queue";
import { brandValidator, musicValidator } from "./schema";

const MAX_TRACKS = 100;

export const get = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { role } = await requireMember(ctx, args.organizationId);
    return {
      maxParallelJobs: await parallelLimit(ctx, args.organizationId),
      ...(await brandAndMusicOf(ctx, args.organizationId)),
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
 * Sets the team's brand: the logo, colour and font every automation uses, and its music
 * library. An empty value clears that item. Owners and admins only.
 */
export const setBrand = mutation({
  args: { organizationId: v.string(), brand: brandValidator, music: v.optional(musicValidator) },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const invalid = (message: string) => new ConvexError({ code: "invalid_input", message });
    const checkFile = async (key: "logo" | "music", value: string) => {
      const problem = brandProblem(key, value);
      if (problem) throw invalid(problem);
      const uploadId = readUploadRef(value);
      if (!uploadId) return;
      const id = ctx.db.normalizeId("uploads", uploadId);
      const upload = id ? await ctx.db.get(id) : null;
      if (!upload || upload.organizationId !== args.organizationId || upload.status !== "ready") {
        throw new ConvexError({ code: "not_found", message: "That upload is no longer there." });
      }
    };
    const brand: Record<string, string> = {};
    for (const key of BRAND_KEYS) {
      // Music is the library below, not one value.
      if (key === "music") continue;
      const value = args.brand[key]?.trim();
      if (!value) continue;
      if (key === "logo") await checkFile(key, value);
      else {
        const problem = brandProblem(key, value);
        if (problem) throw invalid(problem);
      }
      brand[key] = value;
    }
    const existing = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    let music = existing?.music;
    if (args.music) {
      if (args.music.length > MAX_TRACKS) throw invalid(`Keep up to ${MAX_TRACKS} tracks.`);
      music = [];
      for (const track of args.music) {
        const name = track.name.trim();
        if (!name || name.length > 60) throw invalid("Give each track a name of up to 60 letters.");
        if (music.some((other) => other.name.toLowerCase() === name.toLowerCase())) {
          throw invalid(`Two tracks are called "${name}". Give each its own name.`);
        }
        await checkFile("music", track.file.trim());
        music.push({ name, file: track.file.trim() });
      }
    }
    if (existing) await ctx.db.patch(existing._id, { brand, ...(music ? { music } : {}) });
    else {
      await ctx.db.insert("teamSettings", {
        organizationId: args.organizationId,
        maxParallelJobs: DEFAULT_PARALLEL_JOBS,
        brand,
        ...(music ? { music } : {}),
      });
    }
  },
});
