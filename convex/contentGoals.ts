import {
  appsForPlacements,
  CONTENT_KINDS,
  contentGoalsProblem,
  NO_AGENT_SETTINGS,
  nodesForPlatform,
  placementsFor,
  type Starter,
  STARTERS,
} from "@ncat-dash/automation-core";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { automationProblem, randomToken, storageProblem } from "./automations";
import { MANAGER_ROLES, requireMember } from "./lib/authz";
import { librarySettingsOf } from "./lib/library";
import { brandOf, DEFAULT_PARALLEL_JOBS } from "./lib/queue";
import { recordVersion } from "./lib/versions";

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

async function settingsOf(ctx: Parameters<typeof requireMember>[0], organizationId: string) {
  return await ctx.db
    .query("teamSettings")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .first();
}

/**
 * What the team makes and where it posts. Until someone answers, the apps are read from
 * the agent's default platforms, so a team that set those already sees them ticked.
 */
export const get = query({
  args: { organizationId: v.string() },
  returns: v.object({
    kinds: v.array(v.string()),
    apps: v.array(v.string()),
    answered: v.boolean(),
    canEdit: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { role } = await requireMember(ctx, args.organizationId);
    const settings = await settingsOf(ctx, args.organizationId);
    const goals = settings?.contentGoals;
    return {
      kinds: goals?.kinds ?? [],
      apps: goals?.apps ?? appsForPlacements(settings?.agent?.platforms ?? []),
      answered: goals !== undefined,
      canEdit: MANAGER_ROLES.includes(role),
    };
  },
});

/**
 * Saves what the team makes and where it posts. The apps become the agent's default
 * platforms, so it makes clips for them without asking. The first time, new videos and
 * sounds are also made searchable, since the first upload is meant to be. Owners and admins.
 */
export const save = mutation({
  args: { organizationId: v.string(), kinds: v.array(v.string()), apps: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    // Kept in the order they are listed, each once.
    const kinds = CONTENT_KINDS.map((kind) => kind.id).filter((id) => args.kinds.includes(id));
    const apps = appsForPlacements(placementsFor(args.apps));
    const problem = contentGoalsProblem({ kinds: args.kinds, apps: args.apps });
    if (problem) fail("invalid_input", problem);

    const settings = await settingsOf(ctx, args.organizationId);
    const first = settings?.contentGoals === undefined;
    const contentGoals = { kinds, apps, answeredAt: Date.now() };
    // With no app picked, the agent's own defaults are left as they are.
    const agent =
      apps.length > 0
        ? { ...(settings?.agent ?? NO_AGENT_SETTINGS), platforms: placementsFor(apps) }
        : settings?.agent;
    if (settings) await ctx.db.patch(settings._id, { contentGoals, agent });
    else {
      await ctx.db.insert("teamSettings", {
        organizationId: args.organizationId,
        maxParallelJobs: DEFAULT_PARALLEL_JOBS,
        contentGoals,
        ...(agent ? { agent } : {}),
      });
    }

    if (first) {
      const library = await librarySettingsOf(ctx, args.organizationId);
      if (library.row) await ctx.db.patch(library.row._id, { searchNewFiles: true });
      else {
        await ctx.db.insert("librarySettings", {
          organizationId: args.organizationId,
          searchNewFiles: true,
        });
      }
    }
  },
});

const turnedOnValidator = v.object({
  starterId: v.string(),
  name: v.string(),
  automationId: v.union(v.id("automations"), v.null()),
  // On and waiting for files, or why it was left off.
  on: v.boolean(),
  problem: v.union(v.string(), v.null()),
});

/**
 * Makes the picked ready-made automations, for the first platform the team posts on, and
 * switches each one on. One that still needs something, such as a logo, is made but left
 * off, with the reason. One the team already has under the same name is not made again.
 */
export const turnOn = mutation({
  args: { organizationId: v.string(), starterIds: v.array(v.string()) },
  returns: v.array(turnedOnValidator),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    // None of the ready-made automations runs on a timetable, so nothing needs a next run.
    const ids = [...new Set(args.starterIds)];
    if (ids.length > STARTERS.length) fail("invalid_input", "Too many automations at once.");
    const starters: Starter[] = ids.map(
      (id) =>
        STARTERS.find((starter) => starter.id === id) ?? fail("not_found", "Unknown starter."),
    );
    if (starters.some((starter) => starter.trigger.kind === "schedule")) {
      fail("invalid_input", "Ready-made automations on a timetable are set up on the canvas.");
    }

    const settings = await settingsOf(ctx, args.organizationId);
    const platform = placementsFor(settings?.contentGoals?.apps ?? [])[0];
    const brand = await brandOf(ctx, args.organizationId, undefined);
    const existing = await ctx.db
      .query("automations")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(500);

    const made = [];
    for (const starter of starters) {
      const already = existing.find((automation) => automation.name === starter.name);
      if (already) {
        made.push({
          starterId: starter.id,
          name: starter.name,
          automationId: already._id,
          on: already.enabled,
          problem: null,
        });
        continue;
      }
      const content = {
        name: starter.name,
        trigger: starter.trigger,
        nodes: nodesForPlatform(starter.nodes, platform),
        edges: starter.edges,
      };
      const problem =
        automationProblem(content.trigger, content.nodes, content.edges, brand) ??
        (await storageProblem(ctx, args.organizationId, content.trigger));
      const automationId = await ctx.db.insert("automations", {
        organizationId: args.organizationId,
        ...content,
        enabled: problem === null,
        // A watched folder counts files from the moment it is switched on.
        ...(problem === null && content.trigger.kind === "folder" ? { watchFrom: Date.now() } : {}),
        hookToken: randomToken(),
        nextRunAt: null,
        createdBy: userId,
        updatedAt: Date.now(),
      });
      await recordVersion(
        ctx,
        { _id: automationId, organizationId: args.organizationId },
        content,
        {
          userId,
          source: "created",
        },
      );
      made.push({
        starterId: starter.id,
        name: starter.name,
        automationId,
        on: problem === null,
        problem,
      });
    }
    return made;
  },
});

/**
 * The runs a team's first upload started, newest first, so setting up can show them as
 * they begin. Runs start a moment after the upload is in, once its details are read.
 */
export const runsForUpload = query({
  args: { organizationId: v.string(), uploadId: v.id("uploads") },
  returns: v.array(
    v.object({
      runId: v.id("runs"),
      automationId: v.id("automations"),
      automationName: v.string(),
      status: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const upload = await ctx.db.get(args.uploadId);
    if (!upload || upload.organizationId !== args.organizationId) return [];
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(50);
    return runs
      .filter((run) => run.trigger?.upload_id === args.uploadId)
      .map((run) => ({
        runId: run._id,
        automationId: run.automationId,
        automationName: run.automationName,
        status: run.status,
      }));
  },
});
