import {
  AGENT_MODELS,
  agentSettingsProblem,
  agentSettingsText,
  BRAND_KEYS,
  BUILT_IN_BY_SHAPE,
  BUILT_IN_STYLES,
  type CaptionSetup,
  captionSetupText,
  tidyCaptionSetup,
  MAX_HOUSE_RULES_CHARS,
  NO_AGENT_SETTINGS,
  brandProblem,
  MAX_STEP_RETRIES,
  readUploadRef,
  retryLimit,
} from "@ncat-dash/automation-core";
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
import { captionSetupOf } from "./lib/captions";
import { editorsOf } from "./lib/exports";
import {
  agentSettingsValidator,
  brandValidator,
  captionSetupValidator,
  editorValidator,
  musicValidator,
} from "./schema";

const MAX_TRACKS = 100;

export const get = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { role } = await requireMember(ctx, args.organizationId);
    const settings = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    return {
      stepRetries: retryLimit(settings?.stepRetries),
      mostRetries: MAX_STEP_RETRIES,
      maxParallelJobs: await parallelLimit(ctx, args.organizationId),
      ...(await brandAndMusicOf(ctx, args.organizationId)),
      editors: await editorsOf(ctx, args.organizationId),
      agent: settings?.agent ?? NO_AGENT_SETTINGS,
      captions: await captionSetupOf(ctx, args.organizationId),
      builtInCaptionStyles: BUILT_IN_STYLES,
      builtInByShape: BUILT_IN_BY_SHAPE,
      agentModels: AGENT_MODELS.map(({ id, name, note }) => ({ id, name, note })),
      mostHouseRules: MAX_HOUSE_RULES_CHARS,
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
 * Sets the video editors the team uses, which decides the files an export makes. Set
 * once here so no automation step has to ask. Owners and admins only.
 */
export const setEditors = mutation({
  args: { organizationId: v.string(), editors: v.array(editorValidator) },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const editors = [...new Set(args.editors)];
    const existing = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    if (existing) await ctx.db.patch(existing._id, { editors });
    else {
      await ctx.db.insert("teamSettings", {
        organizationId: args.organizationId,
        maxParallelJobs: DEFAULT_PARALLEL_JOBS,
        editors,
      });
    }
  },
});

/**
 * Sets how many times a failed step in a run tries again before the run fails and the
 * team is alerted. Zero switches trying again off. Owners and admins only.
 */
export const setStepRetries = mutation({
  args: { organizationId: v.string(), stepRetries: v.number() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const retries = args.stepRetries;
    if (!Number.isInteger(retries) || retries < 0 || retries > MAX_STEP_RETRIES) {
      throw new ConvexError({
        code: "invalid_input",
        message: `Choose a whole number from 0 to ${MAX_STEP_RETRIES}.`,
      });
    }
    const existing = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    if (existing) await ctx.db.patch(existing._id, { stepRetries: retries });
    else {
      await ctx.db.insert("teamSettings", {
        organizationId: args.organizationId,
        maxParallelJobs: DEFAULT_PARALLEL_JOBS,
        stepRetries: retries,
      });
    }
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

/**
 * Sets the team's captions: words the transcript gets wrong and how to write them, saved
 * caption styles, and the style each video shape gets. Owners and admins only.
 */
export const setCaptions = mutation({
  args: { organizationId: v.string(), captions: captionSetupValidator },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const tidied = tidyCaptionSetup(args.captions as CaptionSetup);
    if (!tidied.ok) throw new ConvexError({ code: "invalid_input", message: tidied.message });
    const captions = tidied.setup;
    const existing = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    if (existing) await ctx.db.patch(existing._id, { captions });
    else {
      await ctx.db.insert("teamSettings", {
        organizationId: args.organizationId,
        maxParallelJobs: DEFAULT_PARALLEL_JOBS,
        captions,
      });
    }
  },
});

/**
 * Sets how the agent works for the team: the model it runs on, house rules it always
 * follows, and the platforms it makes clips for when nobody names any. Owners and admins
 * only.
 */
export const setAgent = mutation({
  args: { organizationId: v.string(), agent: agentSettingsValidator },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const agent = {
      model: args.agent.model,
      houseRules: args.agent.houseRules.trim(),
      platforms: [...new Set(args.agent.platforms)],
    };
    const problem = agentSettingsProblem(agent);
    if (problem) throw new ConvexError({ code: "invalid_input", message: problem });
    const existing = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    if (existing) await ctx.db.patch(existing._id, { agent });
    else {
      await ctx.db.insert("teamSettings", {
        organizationId: args.organizationId,
        maxParallelJobs: DEFAULT_PARALLEL_JOBS,
        agent,
      });
    }
  },
});

/**
 * What the agent needs from the team's settings on each turn: the model to run on (null
 * for its own default) and what to be told. Any member: the agent calls it as the person.
 */
export const agentBrief = query({
  args: { organizationId: v.string() },
  returns: v.object({ model: v.union(v.string(), v.null()), text: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const settings = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    const agent = settings?.agent ?? NO_AGENT_SETTINGS;
    // What caption steps do by themselves, so the agent leaves their look blank.
    const setup = await captionSetupOf(ctx, args.organizationId);
    const custom = setup.fixes.length + setup.styles.length + Object.keys(setup.byShape).length;
    const captions = custom > 0 ? captionSetupText(setup) : null;
    const text = [agentSettingsText(agent), captions].filter(Boolean).join("\n\n");
    return { model: agent.model, text: text || null };
  },
});
