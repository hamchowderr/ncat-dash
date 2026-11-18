import { isTransientStatus } from "@ncat-dash/automation-core";
import { callStep, getStep, jobStatus, ToolkitError } from "@ncat-dash/step-catalog";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireMember } from "./lib/authz";
import { decryptSecret } from "./lib/crypto";
import { collectUrls, handOutputNames, outputNamesOf } from "./lib/outputs";
import { enqueueJob, pump } from "./lib/queue";
import { onJobFinished } from "./lib/runner";
import { keepEnds, toolkitMessageText } from "./lib/toolkitMessage";
import { UploadLinkError, withUploadLinks } from "./storage";

// A Convex document holds at most 1 MB, so a larger result is kept as its links only.
const MAX_RESULT_CHARS = 700_000;

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

/**
 * Runs one catalog step on the team's toolkit. The input is checked against the step's
 * schema before anything is sent. Returns the job id; the job then updates live.
 */
export const run = mutation({
  args: { organizationId: v.string(), stepId: v.string(), input: v.any() },
  returns: v.id("jobs"),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const queued = await enqueueJob(ctx, {
      organizationId: args.organizationId,
      stepId: args.stepId,
      input: args.input,
      createdBy: userId,
    });
    if (!queued.ok) throw new ConvexError({ code: queued.code, message: queued.message });
    await pump(ctx, args.organizationId);
    return queued.jobId;
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
/** Readable names for a job's files: as its run names them, or else as a step run by hand. */
async function namesOfJob(ctx: QueryCtx, job: Doc<"jobs">): Promise<Record<string, string>> {
  const step = job.runStepId ? await ctx.db.get(job.runStepId) : null;
  const run = step ? await ctx.db.get(step.runId) : null;
  if (!step || !run) return handOutputNames(job);
  const names = outputNamesOf(run, [step]);
  return { ...handOutputNames(job), ...names };
}

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
    return await Promise.all(
      done
        .filter((job) => job.outputs.length > 0)
        .map(async (job) => ({
          jobId: job._id,
          stepId: job.stepId,
          finishedAt: job.finishedAt,
          urls: job.outputs,
          // Readable names, by link: from the run the job was part of, if it was.
          names: await namesOfJob(ctx, job),
        })),
    );
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
        permanent: true,
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
        await withUploadLinks(ctx, job.organizationId, job.input),
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
          ? `The toolkit ${isTransientStatus(error.status) ? "was not ready for" : "refused"} the job (HTTP ${error.status}). ${error.body.slice(0, 300)}`
          : error instanceof UploadLinkError
            ? error.message
            : "The toolkit could not be reached.";
      // A request the toolkit refuses, or a file that is gone, fails the same way every
      // time. A toolkit that is busy, restarting or out of reach may be back shortly.
      const permanent =
        error instanceof ToolkitError
          ? !isTransientStatus(error.status)
          : error instanceof UploadLinkError;
      await ctx.runMutation(internal.jobs.finish, {
        jobId: job._id,
        ok: false,
        error: message,
        permanent,
      });
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
    // True when trying the same job again could not end differently.
    permanent: v.optional(v.boolean()),
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
      ...(!args.ok && args.permanent ? { permanent: true } : {}),
    });
    if (job.runStepId) await onJobFinished(ctx, job.runStepId);
    await pump(ctx, job.organizationId);
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
    if (job.runStepId) await onJobFinished(ctx, job.runStepId);
    await pump(ctx, job.organizationId);
  },
});

// Late results. The toolkit posts each result to our webhook, but a post can be lost: the
// toolkit restarts in the middle of a job, or this backend cannot be reached at that
// moment. Rather than leave the run "Running" until the job gives up hours later, the
// dashboard asks the toolkit about any job whose result is late.

/** A job running this long without a result is asked about. */
export const ASK_AFTER_MS = 2 * 60 * 1000;
/** Then it is asked about again this often. */
export const ASK_EVERY_MS = 2 * 60 * 1000;
/** A job the toolkit has no record of, this long after it started, is lost. */
export const LOST_AFTER_MS = 5 * 60 * 1000;

export const LOST_JOB_ERROR =
  "The toolkit lost this job before it finished, most likely because it restarted.";

/** Every minute: books a question to the toolkit for each running job that is late. */
export const checkLate = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const running = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .take(500);
    for (const job of running) {
      if (!job.toolkitJobId) continue;
      if ((job.startedAt ?? now) > now - ASK_AFTER_MS) continue;
      if ((job.lastAskedAt ?? 0) > now - ASK_EVERY_MS) continue;
      await ctx.db.patch(job._id, { lastAskedAt: now });
      await ctx.scheduler.runAfter(0, internal.jobs.askToolkit, { jobId: job._id });
    }
  },
});

export const loadForAsking = internalQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "running" || !job.toolkitJobId) return null;
    const connection = await ctx.db.get(job.connectionId);
    if (!connection) return null;
    return { job, connection };
  },
});

/** Asks the toolkit about one late job and records what it says. */
export const askToolkit = internalAction({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(internal.jobs.loadForAsking, { jobId: args.jobId });
    if (!loaded) return;
    const { job, connection } = loaded;
    let answer;
    try {
      answer = await jobStatus(
        { baseUrl: connection.baseUrl, apiKey: await decryptSecret(connection.apiKeyCipher) },
        job.toolkitJobId!,
        { signal: AbortSignal.timeout(30_000) },
      );
    } catch {
      // The toolkit is busy or out of reach: ask again on the next round.
      return;
    }
    if (answer.state === "finished") {
      const ok = answer.envelope.code === 200;
      await ctx.runMutation(internal.jobs.finish, {
        jobId: job._id,
        ok,
        result: ok ? answer.envelope.response : undefined,
        error: ok ? undefined : keepEnds(toolkitMessageText(answer.envelope.message)),
      });
    } else if (
      answer.state === "unknown" &&
      (job.startedAt ?? Date.now()) <= Date.now() - LOST_AFTER_MS
    ) {
      // Not permanent: the same job sent again may well work.
      await ctx.runMutation(internal.jobs.finish, {
        jobId: job._id,
        ok: false,
        error: LOST_JOB_ERROR,
      });
    }
  },
});
