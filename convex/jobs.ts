import { callStep, getStep, ToolkitError, userInputSchema } from "@ncat-dash/step-catalog";
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
import { requireMember } from "./lib/authz";
import { decryptSecret } from "./lib/crypto";
import { collectUrls } from "./lib/outputs";

// A job with no answer after this long is marked failed, so nothing waits forever.
const MAX_RESULT_CHARS = 700_000;
const GIVE_UP_AFTER_MS = 6 * 60 * 60 * 1000;

/** What the browser may see: everything except the webhook token. */
function toPublic(job: Doc<"jobs">) {
  return {
    _id: job._id,
    _creationTime: job._creationTime,
    stepId: job.stepId,
    input: job.input,
    status: job.status,
    result: job.result,
    outputs: job.outputs,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

function randomToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

/**
 * Runs one catalog step on the team's toolkit. The input is checked against the step's
 * schema before anything is sent. Returns the job id; the job then updates live.
 */
export const run = mutation({
  args: { organizationId: v.string(), stepId: v.string(), input: v.any() },
  returns: v.id("jobs"),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);

    const step = getStep(args.stepId);
    if (!step) throw new ConvexError({ code: "not_found", message: "Unknown step." });

    const parsed = userInputSchema(step).safeParse(args.input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ConvexError({
        code: "invalid_input",
        message: `${issue.path.join(".") || "Input"}: ${issue.message}`,
      });
    }

    const connections = await ctx.db
      .query("toolkitConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(50);
    const connection = connections.find((candidate) => candidate.status === "ok") ?? connections[0];
    if (!connection) {
      throw new ConvexError({ code: "no_toolkit", message: "Connect a toolkit first." });
    }

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
      createdBy: userId,
      startedAt: null,
      finishedAt: null,
    });
    await ctx.scheduler.runAfter(0, internal.jobs.dispatch, { jobId });
    await ctx.scheduler.runAfter(GIVE_UP_AFTER_MS, internal.jobs.giveUp, { jobId });
    return jobId;
  },
});

/** A team's most recent jobs, newest first. */
export const list = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(100);
    return jobs.map(toPublic);
  },
});

export const get = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    await requireMember(ctx, job.organizationId);
    return toPublic(job);
  },
});

/** Finished jobs that produced files, newest first: the outputs library. */
export const outputs = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const done = await ctx.db
      .query("jobs")
      .withIndex("by_organization_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "done"),
      )
      .order("desc")
      .take(100);
    return done
      .filter((job) => job.outputs.length > 0)
      .map((job) => ({
        jobId: job._id,
        stepId: job.stepId,
        finishedAt: job.finishedAt,
        urls: job.outputs,
      }));
  },
});

// Internal: the path from "queued" to a final state.

export const loadForDispatch = internalQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "queued") return null;
    const connection = await ctx.db.get(job.connectionId);
    if (!connection) return null;
    return { job, connection };
  },
});

/** Sends the job to the toolkit and asks it to post the result back to our webhook. */
export const dispatch = internalAction({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(internal.jobs.loadForDispatch, { jobId: args.jobId });
    if (!loaded) return;
    const { job, connection } = loaded;
    const step = getStep(job.stepId);
    if (!step) {
      await ctx.runMutation(internal.jobs.finish, {
        jobId: job._id,
        ok: false,
        error: "This step is no longer in the catalog.",
      });
      return;
    }

    const webhookUrl = new URL("/toolkit/webhook", process.env.CONVEX_SITE_URL);
    webhookUrl.searchParams.set("job", job._id);
    webhookUrl.searchParams.set("token", job.webhookToken);

    try {
      const answer = (await callStep(
        { baseUrl: connection.baseUrl, apiKey: await decryptSecret(connection.apiKeyCipher) },
        step,
        job.input,
        { webhookUrl: webhookUrl.toString(), id: job._id, signal: AbortSignal.timeout(120_000) },
      )) as { code?: number; job_id?: string; response?: unknown; message?: string } | null;

      if (answer?.code === 200 && answer.response !== undefined) {
        // Some endpoints answer straight away instead of queueing.
        await ctx.runMutation(internal.jobs.finish, {
          jobId: job._id,
          ok: true,
          result: answer.response,
        });
      } else {
        await ctx.runMutation(internal.jobs.markRunning, {
          jobId: job._id,
          toolkitJobId: answer?.job_id ?? null,
        });
      }
    } catch (error) {
      const message =
        error instanceof ToolkitError
          ? `The toolkit refused the job (HTTP ${error.status}). ${error.body.slice(0, 300)}`
          : "The toolkit could not be reached.";
      await ctx.runMutation(internal.jobs.finish, { jobId: job._id, ok: false, error: message });
    }
  },
});

export const markRunning = internalMutation({
  args: { jobId: v.id("jobs"), toolkitJobId: v.union(v.null(), v.string()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    // The webhook can arrive before the toolkit's 202 does. Never move a finished job back.
    if (!job || job.status !== "queued") return;
    await ctx.db.patch(args.jobId, {
      status: "running",
      toolkitJobId: args.toolkitJobId,
      startedAt: Date.now(),
    });
  },
});

export const finish = internalMutation({
  args: {
    jobId: v.id("jobs"),
    ok: v.boolean(),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    // Present when the call comes from the webhook, which must prove it knows the token.
    token: v.optional(v.string()),
  },
  returns: v.union(v.literal("recorded"), v.literal("ignored"), v.literal("forbidden")),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return "ignored";
    if (args.token !== undefined && args.token !== job.webhookToken) return "forbidden";
    if (job.status === "done" || job.status === "failed") return "ignored";
    const now = Date.now();
    // A Convex document holds at most 1 MB. A very long transcript is kept as its file
    // links only; the full data is still at the toolkit's own output URLs.
    const tooLarge = args.ok && JSON.stringify(args.result ?? null).length > MAX_RESULT_CHARS;
    await ctx.db.patch(args.jobId, {
      status: args.ok ? "done" : "failed",
      result: !args.ok
        ? undefined
        : tooLarge
          ? { note: "This result is too large to show here.", urls: collectUrls(args.result) }
          : args.result,
      outputs: args.ok ? collectUrls(args.result) : [],
      error: args.ok ? null : (args.error ?? "The step failed."),
      startedAt: job.startedAt ?? now,
      finishedAt: now,
    });
    return "recorded";
  },
});

export const giveUp = internalMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status === "done" || job.status === "failed") return;
    await ctx.db.patch(args.jobId, {
      status: "failed",
      error: "The toolkit never reported a result for this job.",
      finishedAt: Date.now(),
    });
  },
});
