import { getStep, userInputSchema } from "@ncat-dash/step-catalog";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const DEFAULT_PARALLEL_JOBS = 3;
export const MAX_PARALLEL_JOBS = 20;
// A job with no answer this long after it was sent is marked failed, so nothing waits forever.
const GIVE_UP_AFTER_MS = 6 * 60 * 60 * 1000;

function randomToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

export async function parallelLimit(ctx: QueryCtx, organizationId: string): Promise<number> {
  const settings = await ctx.db
    .query("teamSettings")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .first();
  return settings?.maxParallelJobs ?? DEFAULT_PARALLEL_JOBS;
}

type Enqueued =
  | { ok: true; jobId: Id<"jobs"> }
  | { ok: false; code: "not_found" | "invalid_input" | "no_toolkit"; message: string };

/**
 * Checks a step's input and adds the job to the team's queue. It is not sent to the
 * toolkit here: call pump() afterwards, which sends as many as the team's limit allows.
 */
export async function enqueueJob(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    stepId: string;
    input: unknown;
    createdBy: string;
    runStepId?: Id<"runSteps">;
  },
): Promise<Enqueued> {
  const step = getStep(args.stepId);
  if (!step) return { ok: false, code: "not_found", message: "Unknown step." };

  const parsed = userInputSchema(step).safeParse(args.input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      code: "invalid_input",
      message: `${issue.path.join(".") || "Input"}: ${issue.message}`,
    };
  }

  const connections = await ctx.db
    .query("toolkitConnections")
    .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
    .take(50);
  const connection = connections.find((candidate) => candidate.status === "ok") ?? connections[0];
  if (!connection) return { ok: false, code: "no_toolkit", message: "Connect a toolkit first." };

  const jobId = await ctx.db.insert("jobs", {
    organizationId: args.organizationId,
    connectionId: connection._id,
    stepId: step.id,
    input: parsed.data,
    status: "queued",
    webhookToken: randomToken(),
    toolkitJobId: null,
    outputs: [],
    error: null,
    createdBy: args.createdBy,
    startedAt: null,
    finishedAt: null,
    runStepId: args.runStepId,
  });
  return { ok: true, jobId };
}

/**
 * Sends waiting jobs to the toolkit, oldest first, until the team has as many in flight
 * as its limit allows. Called whenever a job is added or finishes.
 */
export async function pump(ctx: MutationCtx, organizationId: string): Promise<void> {
  const limit = await parallelLimit(ctx, organizationId);
  const running = await ctx.db
    .query("jobs")
    .withIndex("by_organization_and_status", (q) =>
      q.eq("organizationId", organizationId).eq("status", "running"),
    )
    .take(limit);
  if (running.length >= limit) return;

  const queued = await ctx.db
    .query("jobs")
    .withIndex("by_organization_and_status", (q) =>
      q.eq("organizationId", organizationId).eq("status", "queued"),
    )
    .take(500);
  const inFlight = running.length + queued.filter((job) => job.dispatchedAt !== undefined).length;
  const waiting = queued.filter((job) => job.dispatchedAt === undefined);

  for (const job of waiting.slice(0, Math.max(0, limit - inFlight))) {
    await ctx.db.patch(job._id, { dispatchedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.jobs.dispatch, { jobId: job._id });
    await ctx.scheduler.runAfter(GIVE_UP_AFTER_MS, internal.jobs.giveUp, { jobId: job._id });
  }
}
