import {
  AGENT_MODELS,
  agentSettingsProblem,
  agentSettingsText,
  BUILT_IN_BY_SHAPE,
  BUILT_IN_STYLES,
  type CaptionSetup,
  captionSetupText,
  tidyCaptionSetup,
  MAX_HOUSE_RULES_CHARS,
  NO_AGENT_SETTINGS,
  MAX_STEP_RETRIES,
  MOTION_PRESETS,
  type MotionSetup,
  motionSetupText,
  retryLimit,
  tidyMotionSetup,
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
import { motionSetupOf } from "./lib/motion";
import { checkedBrand, checkedMusic } from "./lib/brand";
import { editorsOf } from "./lib/exports";
import {
  agentSettingsValidator,
  brandValidator,
  captionSetupValidator,
  editorValidator,
  motionSetupValidator,
  musicValidator,
} from "./schema";

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
      // The team's own Anthropic key, by its last characters only (anthropicKey.ts).
      anthropicKey: settings?.anthropicKey
        ? { hint: settings.anthropicKey.hint, setAt: settings.anthropicKey.setAt }
        : null,
      captions: await captionSetupOf(ctx, args.organizationId),
      builtInCaptionStyles: BUILT_IN_STYLES,
      builtInByShape: BUILT_IN_BY_SHAPE,
      motion: await motionSetupOf(ctx, args.organizationId),
      motionPresets: MOTION_PRESETS,
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
    const brand = await checkedBrand(ctx, args.organizationId, args.brand);
    const existing = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    const music = args.music
      ? await checkedMusic(ctx, args.organizationId, args.music)
      : existing?.music;
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
 * Sets the team's Motion settings: the preset its motion graphics start from, how that
 * style is changed, and the names and handle the pieces show. Owners and admins only.
 */
export const setMotion = mutation({
  args: { organizationId: v.string(), motion: motionSetupValidator },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const tidied = tidyMotionSetup(args.motion as Partial<MotionSetup>);
    if (!tidied.ok) throw new ConvexError({ code: "invalid_input", message: tidied.message });
    const motion = tidied.setup;
    const existing = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    if (existing) await ctx.db.patch(existing._id, { motion });
    else {
      await ctx.db.insert("teamSettings", {
        organizationId: args.organizationId,
        maxParallelJobs: DEFAULT_PARALLEL_JOBS,
        motion,
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
    // The team's motion style, once it has picked one, so the agent can talk about it.
    const motion = settings?.motion
      ? motionSetupText(await motionSetupOf(ctx, args.organizationId))
      : null;
    const text = [agentSettingsText(agent), captions, motion].filter(Boolean).join("\n\n");
    return { model: agent.model, text: text || null };
  },
});
