import {
  applyOperations,
  type AutomationDraft,
  type AutomationEdge,
  type AutomationNode,
  type Brand,
  BRAND_WORDS,
  draftProblems,
  getPlatform,
  graphProblem,
  missingBrandOf,
  missingSettings,
  nextRunAt,
  nodeTypeOf,
  OperationError,
  outline,
  scheduleProblem,
  STARTERS,
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
  type MutationCtx,
  query,
} from "./_generated/server";
import { isMember, requireMember } from "./lib/authz";
import { brandOf } from "./lib/queue";
import { startRun } from "./lib/runner";
import { presign } from "./lib/s3";
import { decryptSecret } from "./lib/crypto";
import { edgeValidator, nodeValidator, operationValidator, triggerValidator } from "./schema";

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

/** A watched folder starts counting from the moment it is switched on. */
function watchStart(
  automation: Doc<"automations">,
  trigger: Doc<"automations">["trigger"],
  enabled: boolean,
): number | undefined {
  if (!enabled || trigger.kind !== "folder") return undefined;
  const same =
    automation.enabled &&
    automation.trigger.kind === "folder" &&
    automation.trigger.prefix === trigger.prefix;
  return same ? (automation.watchFrom ?? Date.now()) : Date.now();
}

async function storageProblem(
  ctx: Parameters<typeof requireMember>[0],
  organizationId: string,
  trigger: Doc<"automations">["trigger"],
): Promise<string | null> {
  if (trigger.kind !== "folder" && trigger.kind !== "upload") return null;
  const storage = await ctx.db
    .query("storageConnections")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .first();
  return storage ? null : "Connect your storage on the Uploads page first.";
}

function scheduledNext(trigger: Doc<"automations">["trigger"], enabled: boolean): number | null {
  return enabled && trigger.kind === "schedule" ? nextRunAt(trigger.schedule, Date.now()) : null;
}

/** Problems that stop an automation being switched on or run. Null when there are none. */
function automationProblem(
  trigger: Doc<"automations">["trigger"],
  nodes: AutomationNode[],
  edges: AutomationEdge[],
  brand: Brand,
): string | null {
  const graph = graphProblem(nodes, edges);
  if (graph) return graph;
  for (const node of nodes) {
    if (node.kind === "step" && !getStep(node.stepId ?? "")) {
      return "One of the steps is no longer in the catalog.";
    }
    if (node.kind === "clips" && !getPlatform(node.input.platform)) {
      return "Pick a platform for the clips.";
    }
    const nodeType = nodeTypeOf(node);
    const title = node.label ?? nodeType?.title ?? "A step";
    const fromBrand = nodeType ? missingBrandOf(nodeType, node.input, brand) : [];
    if (fromBrand.length > 0) {
      return `${title} needs your team's ${fromBrand.map((key) => BRAND_WORDS[key]).join(" and ")}. Add it in Settings, under Brand.`;
    }
    if (missingSettings(node, brand).length > 0) {
      return `${title} still needs its settings. Select it on the canvas.`;
    }
  }
  if (trigger.kind === "schedule") return scheduleProblem(trigger.schedule);
  if (trigger.kind === "folder" && trigger.prefix.length > 500)
    return "That folder name is too long.";
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
          nodes: automation.nodes,
          edges: automation.edges,
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
  args: { organizationId: v.string(), name: v.string(), starterId: v.optional(v.string()) },
  returns: v.id("automations"),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const starter = args.starterId ? STARTERS.find((s) => s.id === args.starterId) : undefined;
    if (args.starterId && !starter) fail("not_found", "Unknown starter.");
    const name = (args.name.trim() || starter?.name || "").slice(0, 80);
    if (!name) fail("invalid_input", "Give the automation a name.");
    return await ctx.db.insert("automations", {
      organizationId: args.organizationId,
      name,
      enabled: false,
      trigger: starter?.trigger ?? { kind: "manual" },
      nodes: starter?.nodes ?? [],
      edges: starter?.edges ?? [],
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
    return await storeDraft(ctx, automation, args);
  },
});

/** Writes a changed automation, switching it off when it can no longer run. */
async function storeDraft(
  ctx: MutationCtx,
  automation: Doc<"automations">,
  draft: Pick<Doc<"automations">, "name" | "trigger" | "nodes" | "edges">,
): Promise<{ enabled: boolean; problem: string | null }> {
  const name = draft.name.trim().slice(0, 80);
  if (!name) fail("invalid_input", "Give the automation a name.");
  if (JSON.stringify(draft.nodes).length > 400_000) {
    fail("invalid_input", "This automation's settings are too large to save.");
  }
  const problem =
    automationProblem(
      draft.trigger,
      draft.nodes,
      draft.edges,
      await brandOf(ctx, automation.organizationId),
    ) ?? (await storageProblem(ctx, automation.organizationId, draft.trigger));
  const enabled = automation.enabled && problem === null;
  await ctx.db.patch(automation._id, {
    name,
    trigger: draft.trigger,
    nodes: draft.nodes,
    edges: draft.edges,
    enabled,
    nextRunAt: scheduledNext(draft.trigger, enabled),
    watchFrom: watchStart(automation, draft.trigger, enabled),
    updatedAt: Date.now(),
  });
  return { enabled, problem };
}

const describedValidator = v.object({
  // The automation as short text: what starts it, then each step in running order.
  outline: v.string(),
  // What still stops it running. Empty when it can be switched on.
  problems: v.array(v.object({ nodeId: v.union(v.null(), v.string()), message: v.string() })),
  enabled: v.boolean(),
});

/**
 * An automation as text, with what is still missing. This is what the agent reads before
 * it changes anything; the node types it can use are NODE_TYPES in automation-core.
 */
export const describe = query({
  args: { automationId: v.id("automations") },
  returns: describedValidator,
  handler: async (ctx, args) => {
    const { automation } = await loadForMember(ctx, args.automationId);
    const draft = automation as AutomationDraft;
    const brand = await brandOf(ctx, automation.organizationId);
    return {
      outline: outline(draft, brand),
      problems: draftProblems(draft, brand),
      enabled: automation.enabled,
    };
  },
});

/**
 * Makes changes to an automation, in order, and saves the result. All of them are made or
 * none: the first change that cannot be made is reported and nothing is saved. The canvas
 * makes the same changes locally before it saves, so both build the same way.
 */
export const change = mutation({
  args: { automationId: v.id("automations"), operations: v.array(operationValidator) },
  returns: describedValidator,
  handler: async (ctx, args) => {
    const { automation } = await loadForMember(ctx, args.automationId);
    if (args.operations.length === 0 || args.operations.length > 100) {
      fail("invalid_input", "Send between 1 and 100 changes at a time.");
    }
    let next: AutomationDraft;
    try {
      next = applyOperations(automation as AutomationDraft, args.operations);
    } catch (caught) {
      if (caught instanceof OperationError) fail("invalid_input", caught.message);
      throw caught;
    }
    const { enabled } = await storeDraft(ctx, automation, next);
    const brand = await brandOf(ctx, automation.organizationId);
    return { outline: outline(next, brand), problems: draftProblems(next, brand), enabled };
  },
});

export const setEnabled = mutation({
  args: { automationId: v.id("automations"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const { automation } = await loadForMember(ctx, args.automationId);
    if (args.enabled) {
      const problem =
        automationProblem(
          automation.trigger,
          automation.nodes,
          automation.edges,
          await brandOf(ctx, automation.organizationId),
        ) ?? (await storageProblem(ctx, automation.organizationId, automation.trigger));
      if (problem) fail("invalid_input", problem);
    }
    await ctx.db.patch(args.automationId, {
      enabled: args.enabled,
      nextRunAt: scheduledNext(automation.trigger, args.enabled),
      watchFrom: watchStart(automation, automation.trigger, args.enabled),
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
