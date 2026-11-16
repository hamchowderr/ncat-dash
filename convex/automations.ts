import {
  type AutomationEdge,
  type AutomationNode,
  graphProblem,
  nextRunAt,
  scheduleProblem,
} from "@ncat-dash/automation-core";
import { getStep } from "@ncat-dash/step-catalog";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { isMember, requireMember } from "./lib/authz";
import { startRun } from "./lib/runner";
import { presign } from "./lib/s3";
import { decryptSecret } from "./lib/crypto";
import { edgeValidator, nodeValidator, triggerValidator } from "./schema";

const READ_LINK_SECONDS = 7 * 24 * 60 * 60;

function randomToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

async function loadForMember(
  ctx: Parameters<typeof requireMember>[0],
  automationId: Doc<"automations">["_id"],
) {
  const automation = await ctx.db.get(automationId);
  if (!automation) fail("not_found", "This automation no longer exists.");
  const member = await requireMember(ctx, automation.organizationId);
  return { automation, ...member };
}

function scheduledNext(trigger: Doc<"automations">["trigger"], enabled: boolean): number | null {
  return enabled && trigger.kind === "schedule" ? nextRunAt(trigger.schedule, Date.now()) : null;
}

/** Problems that stop an automation being switched on or run. Null when there are none. */
function automationProblem(
  trigger: Doc<"automations">["trigger"],
  nodes: AutomationNode[],
  edges: AutomationEdge[],
): string | null {
  const graph = graphProblem(nodes, edges);
  if (graph) return graph;
  for (const node of nodes) {
    if (node.kind === "step" && !getStep(node.stepId ?? "")) {
      return "One of the steps is no longer in the catalog.";
    }
  }
  if (trigger.kind === "schedule") return scheduleProblem(trigger.schedule);
  return null;
}

/** A team's automations with the state of each one's latest run. */
export const list = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const automations = await ctx.db
      .query("automations")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(100);
    return await Promise.all(
      automations.map(async (automation) => {
        const lastRun = await ctx.db
          .query("runs")
          .withIndex("by_automation", (q) => q.eq("automationId", automation._id))
          .order("desc")
          .first();
        return {
          _id: automation._id,
          name: automation.name,
          enabled: automation.enabled,
          trigger: automation.trigger,
          stepCount: automation.nodes.length,
          nextRunAt: automation.nextRunAt,
          updatedAt: automation.updatedAt,
          lastRun: lastRun
            ? { _id: lastRun._id, status: lastRun.status, startedAt: lastRun._creationTime }
            : null,
        };
      }),
    );
  },
});

export const get = query({
  args: { automationId: v.id("automations") },
  handler: async (ctx, args) => {
    const automation = await ctx.db.get(args.automationId);
    if (!automation) return null;
    // Someone who is not on the team sees the same as for a deleted automation.
    if (!(await isMember(ctx, automation.organizationId))) return null;
    return {
      _id: automation._id,
      name: automation.name,
      enabled: automation.enabled,
      trigger: automation.trigger,
      nodes: automation.nodes,
      edges: automation.edges,
      // Team members need the full address to give to whatever calls it.
      hookToken: automation.hookToken,
      nextRunAt: automation.nextRunAt,
      updatedAt: automation.updatedAt,
    };
  },
});

export const create = mutation({
  args: { organizationId: v.string(), name: v.string() },
  returns: v.id("automations"),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const name = args.name.trim().slice(0, 80);
    if (!name) fail("invalid_input", "Give the automation a name.");
    return await ctx.db.insert("automations", {
      organizationId: args.organizationId,
      name,
      enabled: false,
      trigger: { kind: "manual" },
      nodes: [],
      edges: [],
      hookToken: randomToken(),
      nextRunAt: null,
      createdBy: userId,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Saves the canvas. A half-built automation can be saved; it only has to be complete
 * to be switched on or run. Saving one that is on but no longer complete switches it off.
 */
export const save = mutation({
  args: {
    automationId: v.id("automations"),
    name: v.string(),
    trigger: triggerValidator,
    nodes: v.array(nodeValidator),
    edges: v.array(edgeValidator),
  },
  returns: v.object({ enabled: v.boolean(), problem: v.union(v.null(), v.string()) }),
  handler: async (ctx, args) => {
    const { automation } = await loadForMember(ctx, args.automationId);
    const name = args.name.trim().slice(0, 80);
    if (!name) fail("invalid_input", "Give the automation a name.");
    if (JSON.stringify(args.nodes).length > 400_000) {
      fail("invalid_input", "This automation's settings are too large to save.");
    }
    const problem = automationProblem(args.trigger, args.nodes, args.edges);
    const enabled = automation.enabled && problem === null;
    await ctx.db.patch(args.automationId, {
      name,
      trigger: args.trigger,
      nodes: args.nodes,
      edges: args.edges,
      enabled,
      nextRunAt: scheduledNext(args.trigger, enabled),
      updatedAt: Date.now(),
    });
    return { enabled, problem };
  },
});

export const setEnabled = mutation({
  args: { automationId: v.id("automations"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const { automation } = await loadForMember(ctx, args.automationId);
    if (args.enabled) {
      const problem = automationProblem(automation.trigger, automation.nodes, automation.edges);
      if (problem) fail("invalid_input", problem);
    }
    await ctx.db.patch(args.automationId, {
      enabled: args.enabled,
      nextRunAt: scheduledNext(automation.trigger, args.enabled),
    });
  },
});

/** Deletes the automation. Its past runs stay in the run history. */
export const remove = mutation({
  args: { automationId: v.id("automations") },
  handler: async (ctx, args) => {
    await loadForMember(ctx, args.automationId);
    await ctx.db.delete(args.automationId);
  },
});

/** Starts a run by hand, optionally on a file. Works whether or not the automation is on. */
export const runNow = mutation({
  args: { automationId: v.id("automations"), fileUrl: v.optional(v.string()) },
  returns: v.id("runs"),
  handler: async (ctx, args) => {
    const { automation, userId } = await loadForMember(ctx, args.automationId);
    const fileUrl = args.fileUrl?.trim();
    if (fileUrl && !/^https?:\/\//.test(fileUrl)) {
      fail("invalid_input", "The file address must start with http:// or https://.");
    }
    const started = await startRun(
      ctx,
      automation,
      "manual",
      fileUrl ? { file_url: fileUrl } : {},
      userId,
    );
    if (!started.ok) fail("invalid_input", started.message);
    return started.runId;
  },
});

// Internal: the triggers that start runs with nobody logged in.

/** Called from the webhook address. Says why when it cannot start a run. */
export const startFromHook = internalMutation({
  args: { automationId: v.string(), token: v.string(), body: v.any() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("automations", args.automationId);
    const automation = id ? await ctx.db.get(id) : null;
    if (!automation) return { outcome: "not_found" as const };
    if (automation.hookToken !== args.token) return { outcome: "forbidden" as const };
    if (!automation.enabled || automation.trigger.kind !== "webhook") {
      return { outcome: "off" as const };
    }
    const body = args.body as Record<string, unknown> | null;
    const fileUrl = [body?.file_url, body?.url].find(
      (value): value is string => typeof value === "string" && /^https?:\/\//.test(value),
    );
    const started = await startRun(
      ctx,
      automation,
      "webhook",
      { ...(fileUrl ? { file_url: fileUrl } : {}), body: body ?? {} },
      null,
    );
    if (!started.ok) return { outcome: "invalid" as const, message: started.message };
    return { outcome: "started" as const, runId: started.runId };
  },
});

/** Runs every minute: starts each schedule that has come due. */
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("automations")
      .withIndex("by_enabled_and_nextRunAt", (q) =>
        q.eq("enabled", true).gt("nextRunAt", 0).lte("nextRunAt", now),
      )
      .take(50);
    for (const automation of due) {
      if (automation.trigger.kind !== "schedule") {
        await ctx.db.patch(automation._id, { nextRunAt: null });
        continue;
      }
      await ctx.db.patch(automation._id, {
        nextRunAt: nextRunAt(automation.trigger.schedule, now),
      });
      // If the last run is still going, skip this turn so runs never pile up.
      const lastRun = await ctx.db
        .query("runs")
        .withIndex("by_automation", (q) => q.eq("automationId", automation._id))
        .order("desc")
        .first();
      if (lastRun && (lastRun.status === "running" || lastRun.status === "waiting")) continue;
      await startRun(ctx, automation, "schedule", { scheduled_for: automation.nextRunAt }, null);
    }
  },
});

export const loadUploadForTrigger = internalQuery({
  args: { uploadId: v.id("uploads") },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload || upload.status !== "ready") return null;
    const automations = await ctx.db
      .query("automations")
      .withIndex("by_organization", (q) => q.eq("organizationId", upload.organizationId))
      .take(200);
    const family = upload.contentType.split("/")[0];
    const matching = automations.filter(
      (automation) =>
        automation.enabled &&
        automation.trigger.kind === "upload" &&
        (automation.trigger.fileType === "any" || automation.trigger.fileType === family),
    );
    if (matching.length === 0) return null;
    const storage = await ctx.db
      .query("storageConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", upload.organizationId))
      .first();
    if (!storage) return null;
    return { upload, storage, automationIds: matching.map((automation) => automation._id) };
  },
});

/** After an upload finishes: makes a link to the file and starts the automations that want it. */
export const uploadFinished = internalAction({
  args: { uploadId: v.id("uploads") },
  handler: async (ctx, args) => {
    const found = await ctx.runQuery(internal.automations.loadUploadForTrigger, args);
    if (!found) return;
    const { upload, storage } = found;
    const fileUrl = await presign(
      {
        endpoint: storage.endpoint,
        region: storage.region,
        bucket: storage.bucket,
        accessKeyId: storage.accessKeyId,
        secretAccessKey: await decryptSecret(storage.secretCipher),
      },
      "GET",
      upload.key,
      READ_LINK_SECONDS,
    );
    await ctx.runMutation(internal.automations.startFromUpload, {
      automationIds: found.automationIds,
      trigger: {
        file_url: fileUrl,
        file_name: upload.fileName,
        content_type: upload.contentType,
        size: upload.size,
      },
    });
  },
});

export const startFromUpload = internalMutation({
  args: { automationIds: v.array(v.id("automations")), trigger: v.any() },
  handler: async (ctx, args) => {
    for (const automationId of args.automationIds) {
      const automation = await ctx.db.get(automationId);
      if (!automation || !automation.enabled || automation.trigger.kind !== "upload") continue;
      await startRun(ctx, automation, "upload", args.trigger, null);
    }
  },
});
