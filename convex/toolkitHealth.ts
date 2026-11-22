import { type AutomationNode, nodeTypeOf } from "@ncat-dash/automation-core";
import { getStep, toolkitHealth } from "@ncat-dash/step-catalog";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { requireMember } from "./lib/authz";
import { decryptSecret } from "./lib/crypto";
import { onOperatorToolkit } from "./lib/edition";
import {
  parallelLimit,
  recordSharedWorkers,
  sharedToolkitTrouble,
  sharedToolkitWentFine,
} from "./lib/queue";

const DAY = 24 * 60 * 60 * 1000;
// More than this many jobs in flight at once is shown as "and N more".
const SHOWN = 50;

const healthResult = v.union(
  v.object({
    ok: v.literal(true),
    checkedAt: v.number(),
    health: v.object({
      buildNumber: v.union(v.null(), v.string()),
      cpus: v.number(),
      cpuPercent: v.number(),
      memory: v.object({ used: v.number(), limit: v.number() }),
      disk: v.union(v.null(), v.object({ free: v.number(), total: v.number() })),
      uptimeSeconds: v.number(),
      queue: v.object({
        shared: v.boolean(),
        waiting: v.union(v.null(), v.number()),
        workers: v.union(v.null(), v.number()),
        busy: v.union(v.null(), v.number()),
      }),
      jobs: v.object({ queued: v.number(), running: v.number(), done: v.number() }),
    }),
  }),
  v.object({
    ok: v.literal(false),
    checkedAt: v.number(),
    reason: v.union(
      v.literal("no_toolkit"),
      v.literal("hosted"),
      v.literal("unreachable"),
      v.literal("unauthorized"),
      v.literal("no_health"),
      v.literal("error"),
    ),
    detail: v.string(),
  }),
);

/**
 * How busy the team's toolkit is right now: CPU, memory, disk, its queue and workers, and
 * its build. Read from the toolkit each time the Toolkit page asks, never stored.
 */
export const read = action({
  args: { organizationId: v.string() },
  returns: healthResult,
  handler: async (ctx, args) => {
    const connection = await ctx.runQuery(internal.toolkitHealth.connectionFor, {
      organizationId: args.organizationId,
    });
    const checkedAt = Date.now();
    if (!connection) {
      return { ok: false as const, checkedAt, reason: "no_toolkit" as const, detail: "" };
    }
    // A toolkit run for many teams: its load is everyone's, and not this team's to manage.
    if (onOperatorToolkit(connection.baseUrl)) {
      return { ok: false as const, checkedAt, reason: "hosted" as const, detail: "" };
    }
    const result = await toolkitHealth(
      { baseUrl: connection.baseUrl, apiKey: await decryptSecret(connection.apiKeyCipher) },
      { signal: AbortSignal.timeout(15_000) },
    );
    return { ...result, checkedAt };
  },
});

/**
 * Reads how many workers the operator's toolkit (HOSTED_TOOLKIT_URL and
 * HOSTED_TOOLKIT_API_KEY) has, so every team on it shares that many jobs at once.
 * Runs every few minutes. Does nothing when no such toolkit is set.
 */
export const checkShared = internalAction({
  args: {},
  handler: async (ctx) => {
    const baseUrl = process.env.HOSTED_TOOLKIT_URL?.trim();
    const apiKey = process.env.HOSTED_TOOLKIT_API_KEY?.trim();
    if (!baseUrl || !apiKey) return;
    const result = await toolkitHealth(
      { baseUrl, apiKey },
      { signal: AbortSignal.timeout(15_000) },
    );
    // An unreachable toolkit keeps the last count it gave (it stops counting once stale),
    // and the total is cut for now.
    if (!result.ok) {
      await ctx.runMutation(internal.toolkitHealth.sharedTrouble, {});
      return;
    }
    await ctx.runMutation(internal.toolkitHealth.recordShared, {
      workers: result.health.queue.workers,
    });
  },
});

/** The shared toolkit was busy or out of reach: back off. */
export const sharedTrouble = internalMutation({
  args: {},
  handler: async (ctx) => {
    await sharedToolkitTrouble(ctx);
  },
});

/** The shared toolkit took a job: let the total grow back. */
export const sharedWentFine = internalMutation({
  args: {},
  handler: async (ctx) => {
    await sharedToolkitWentFine(ctx);
  },
});

export const recordShared = internalMutation({
  args: { workers: v.union(v.null(), v.number()) },
  handler: async (ctx, args) => {
    await recordSharedWorkers(ctx, args.workers);
  },
});

/**
 * Whether the team looks after its own toolkit, so the Toolkit page is for it. False for a
 * team on a toolkit the operator runs for customers.
 */
export const shown = query({
  args: { organizationId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const connections = await ctx.db
      .query("toolkitConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(50);
    const connection =
      connections.find((candidate) => candidate.status === "ok") ?? connections[0] ?? null;
    return !onOperatorToolkit(connection?.baseUrl);
  },
});

export const connectionFor = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const connections = await ctx.db
      .query("toolkitConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(50);
    return connections.find((candidate) => candidate.status === "ok") ?? connections[0] ?? null;
  },
});

type Job = Doc<"jobs">;

/**
 * What the toolkit is doing for this team: its jobs being worked on, those sent and
 * waiting their turn in the toolkit, and those held back by the team's limit on jobs at
 * once, each with the automation run it belongs to. Also how the last day went.
 */
export const activity = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const byStatus = (status: Job["status"], limit: number) =>
      ctx.db
        .query("jobs")
        .withIndex("by_organization_and_status", (q) =>
          q.eq("organizationId", args.organizationId).eq("status", status),
        )
        .order("asc")
        .take(limit);
    const running = await byStatus("running", 200);
    const queued = await byStatus("queued", 500);
    const since = Date.now() - DAY;
    const recent = await ctx.db
      .query("jobs")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(500);
    const lastDay = recent.filter((job) => job._creationTime >= since);

    const view = async (job: Job) => {
      const step = job.runStepId ? await ctx.db.get(job.runStepId) : null;
      const run = step ? await ctx.db.get(step.runId) : null;
      const node = run
        ? (run.nodes as AutomationNode[]).find((candidate) => candidate.id === step!.nodeId)
        : undefined;
      return {
        _id: job._id,
        // The step as named on the canvas, or its title in the catalog.
        step:
          (node && (node.label ?? nodeTypeOf(node)?.title)) ??
          getStep(job.stepId)?.title ??
          job.stepId,
        // "toolkit": the toolkit took it and is working on it, or has it in its own queue.
        // "sending": being handed over now. "held": waiting here for a free slot under the
        // team's limit on jobs at once.
        state:
          job.status === "running"
            ? ("toolkit" as const)
            : job.dispatchedAt !== undefined
              ? ("sending" as const)
              : ("held" as const),
        since: job.startedAt ?? job.dispatchedAt ?? job._creationTime,
        run: run
          ? { runId: run._id, automationId: run.automationId, automationName: run.automationName }
          : null,
      };
    };

    const inFlight = [...running, ...queued];
    return {
      limit: await parallelLimit(ctx, args.organizationId),
      jobs: await Promise.all(inFlight.slice(0, SHOWN).map(view)),
      more: Math.max(0, inFlight.length - SHOWN),
      counts: {
        toolkit: running.length,
        sending: queued.filter((job) => job.dispatchedAt !== undefined).length,
        held: queued.filter((job) => job.dispatchedAt === undefined).length,
      },
      lastDay: {
        done: lastDay.filter((job) => job.status === "done").length,
        failed: lastDay.filter((job) => job.status === "failed").length,
        // Typical time from the toolkit starting a job to its result, in milliseconds.
        typicalMs: median(
          lastDay
            .filter((job) => job.status === "done" && job.startedAt && job.finishedAt)
            .map((job) => job.finishedAt! - job.startedAt!),
        ),
      },
    };
  },
});

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
