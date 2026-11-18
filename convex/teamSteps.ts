import {
  type AutomationNode,
} from "@ncat-dash/automation-core";
import {
  isTeamStepId,
  TEAM_STEP_PREFIX,
  teamStepDefinition,
  teamStepProblem,
  type TeamStepTemplate,
  userInputSchema,
} from "@ncat-dash/step-catalog";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireMember } from "./lib/authz";
import { enqueueJob, pump } from "./lib/queue";
import { MAX_TEAM_STEPS, teamStepsOf } from "./lib/teamSteps";

/**
 * A team's own FFmpeg steps. The agent writes one when no ready-made step fits, tries it
 * on one of the team's files, and saves it; it then sits in the step list under "Your
 * team's steps" and runs like any recipe. Anyone on the team can make, change and
 * remove them, as anyone on the team can change automations.
 */

const blankValidator = v.object({
  name: v.string(),
  label: v.string(),
  kind: v.union(
    v.literal("file"),
    v.literal("text"),
    v.literal("number"),
    v.literal("color"),
    v.literal("choice"),
  ),
  default: v.optional(v.union(v.string(), v.number())),
  min: v.optional(v.number()),
  max: v.optional(v.number()),
  options: v.optional(v.array(v.string())),
  whole: v.optional(v.boolean()),
});

const templateValidator = v.object({
  title: v.string(),
  description: v.string(),
  blanks: v.array(blankValidator),
  primary: v.union(v.string(), v.null()),
  request: v.any(),
});

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

function tidy(template: TeamStepTemplate): TeamStepTemplate {
  return {
    ...template,
    title: template.title.trim(),
    description: template.description.trim(),
    blanks: template.blanks.map((blank) => ({ ...blank, label: blank.label.trim() })),
  };
}

function checkedTemplate(template: TeamStepTemplate): TeamStepTemplate {
  const tidied = tidy(template);
  const problem = teamStepProblem(tidied);
  if (problem) fail("invalid_step", problem);
  if (JSON.stringify(tidied.request).length > 20_000) {
    fail("invalid_step", "The request is too long for one step.");
  }
  return tidied;
}

function toPublic(doc: Doc<"teamSteps">) {
  return {
    stepId: `${TEAM_STEP_PREFIX}${doc._id}`,
    title: doc.title,
    description: doc.description,
    blanks: doc.blanks,
    primary: doc.primary,
    request: doc.request as Record<string, unknown>,
    updatedAt: doc.updatedAt,
  };
}

/** The saved step behind a "team-<id>" step id, if it is this team's. */
async function ownStep(ctx: QueryCtx, organizationId: string, stepId: string) {
  if (!isTeamStepId(stepId)) return null;
  const id = ctx.db.normalizeId("teamSteps", stepId.slice(TEAM_STEP_PREFIX.length));
  const doc = id ? await ctx.db.get(id) : null;
  return doc && doc.organizationId === organizationId ? doc : null;
}

/** The automations whose steps use this team step, by name. */
async function usedBy(ctx: QueryCtx, organizationId: string, stepId: string): Promise<string[]> {
  const automations = await ctx.db
    .query("automations")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(500);
  const uses = (nodes: unknown) =>
    Array.isArray(nodes) && (nodes as AutomationNode[]).some((node) => node.stepId === stepId);
  return automations
    .filter((automation) => uses(automation.nodes) || uses(automation.draft?.nodes))
    .map((automation) => automation.name);
}

export const list = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const docs = await teamStepsOf(ctx, args.organizationId);
    return docs.sort((a, b) => a.title.localeCompare(b.title)).map(toPublic);
  },
});

/**
 * Saves a team step, new or changed. Its settings and request are checked first; a
 * changed step keeps its id, so automations that use it pick up the change.
 */
export const save = mutation({
  args: {
    organizationId: v.string(),
    stepId: v.optional(v.string()),
    template: templateValidator,
  },
  returns: v.object({ stepId: v.string(), title: v.string() }),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const template = checkedTemplate(args.template as TeamStepTemplate);
    const fields = { ...template, createdBy: userId, updatedAt: Date.now() };
    let id: Id<"teamSteps">;
    if (args.stepId) {
      const existing = await ownStep(ctx, args.organizationId, args.stepId);
      if (!existing) fail("not_found", "That step is not one of your team's steps.");
      await ctx.db.patch(existing._id, { ...fields, createdBy: existing.createdBy });
      id = existing._id;
    } else {
      const count = (await teamStepsOf(ctx, args.organizationId)).length;
      if (count >= MAX_TEAM_STEPS) {
        fail("too_many", `A team can keep ${MAX_TEAM_STEPS} steps of its own. Remove one first.`);
      }
      id = await ctx.db.insert("teamSteps", { organizationId: args.organizationId, ...fields });
    }
    return { stepId: `${TEAM_STEP_PREFIX}${id}`, title: template.title };
  },
});

/** Removes a team step that no automation uses any more. */
export const remove = mutation({
  args: { organizationId: v.string(), stepId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const doc = await ownStep(ctx, args.organizationId, args.stepId);
    if (!doc) return;
    const names = await usedBy(ctx, args.organizationId, args.stepId);
    if (names.length > 0) {
      fail(
        "in_use",
        `${names.slice(0, 3).join(", ")}${names.length > 3 ? " and others" : ""} still ${
          names.length === 1 ? "uses" : "use"
        } this step. Take it out of ${names.length === 1 ? "that automation" : "them"} first.`,
      );
    }
    await ctx.db.delete(doc._id);
  },
});

/**
 * Tries a step before it is saved (or a saved one with other settings): runs it once on
 * the team's toolkit, as a job by hand, and returns the job to watch. File settings take
 * "upload:<id>" for one of the team's uploads, or a link.
 */
export const tryOut = mutation({
  args: {
    organizationId: v.string(),
    template: templateValidator,
    values: v.record(v.string(), v.union(v.string(), v.number())),
  },
  returns: v.object({ jobId: v.id("jobs") }),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const template = checkedTemplate(args.template as TeamStepTemplate);
    const definition = teamStepDefinition({ ...template, id: "draft" });
    const parsed = userInputSchema(definition).safeParse(args.values);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      fail("invalid_input", `${issue.path.join(".") || "Settings"}: ${issue.message}`);
    }
    const queued = await enqueueJob(ctx, {
      organizationId: args.organizationId,
      stepId: "ffmpeg-compose",
      input: definition.toRequest!(parsed.data, {}),
      createdBy: userId,
    });
    if (!queued.ok) fail(queued.code, queued.message);
    await pump(ctx, args.organizationId);
    return { jobId: queued.jobId };
  },
});

