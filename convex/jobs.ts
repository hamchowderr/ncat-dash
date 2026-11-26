import { onStoryboardVideoJob } from "./lib/storyboardVideos";
import { onTipPreviewJob } from "./trialTips";
import {
  failsTheSameEveryTime,
  getNodeType,
  isTransientStatus,
  withBrand,
  wrongKindOfFile,
} from "@takewon/automation-core";
import { callStep, getStep, jobStatus, StepSetupError, ToolkitError } from "@takewon/step-catalog";
import { vOnCompleteArgs } from "@convex-dev/workpool";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireMember } from "./lib/authz";
import { decryptSecret } from "./lib/crypto";
import { keepMaskFrom } from "./lib/masks";
import { collectUrls, handOutputNames, outputNamesOf } from "./lib/outputs";
import { brandOf, enqueueJob, pump, waitReason } from "./lib/queue";
import { toolkitPool } from "./lib/pools";
import { onJobFinished } from "./lib/runner";
import { onLinkJobFinished } from "./links";
import { onLookJobFinished } from "./looks";
import { wordsForJob } from "./lib/disclosure";
import { keepEnds, toolkitMessageText } from "./lib/toolkitMessage";
import { UploadLinkError, withUploadLinks } from "./storage";
import {
  GoogleSignInError,
  googleMeetDownloadHeaders,
  onGoogleMeetJobFinished,
} from "./googleMeet";
import { downloadUrlFor, MicrosoftSignInError, onMicrosoftJobFinished } from "./microsoft";
import {
  downloadUrlFor as dropboxDownloadUrlFor,
  DropboxSignInError,
  onDropboxJobFinished,
} from "./dropbox";
import { downloadHeadersFor, onZoomJobFinished, ZoomSignInError } from "./zoom";

// A Convex document holds at most 1 MB, so a larger result is kept as its links only.
const MAX_RESULT_CHARS = 700_000;

/** What the browser may see: everything except the webhook token. */
type Wait = Awaited<ReturnType<typeof waitReason>>;

function toPublic(job: Doc<"jobs">, wait: Wait = null) {
  return {
    // Why a job not yet sent is still waiting, when it is.
    waiting: job.status === "queued" && job.dispatchedAt === undefined ? wait : null,
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
    // Settings the team's brand fills in (music, logo...) are left empty to use it, as
    // in an automation.
    const nodeType = getNodeType(`step:${args.stepId}`);
    const input =
      nodeType?.brand && args.input && typeof args.input === "object"
        ? withBrand(nodeType, args.input, await brandOf(ctx, args.organizationId))
        : args.input;
    const queued = await enqueueJob(ctx, {
      organizationId: args.organizationId,
      stepId: args.stepId,
      input,
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
    const wait = jobs.some((job) => job.status === "queued" && job.dispatchedAt === undefined)
      ? await waitReason(ctx, args.organizationId)
      : null;
    // Meeting recordings being brought in show in Settings and Uploads, not with step jobs.
    return jobs
      .filter(
        (job) =>
          !job.zoomImportId &&
          !job.googleMeetImportId &&
          !job.microsoftImportId &&
          !job.dropboxImportId &&
          !job.linkImportId,
      )
      .map((job) => toPublic(job, wait));
  },
});

export const get = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    await requireMember(ctx, job.organizationId);
    const waiting = job.status === "queued" && job.dispatchedAt === undefined;
    return toPublic(job, waiting ? await waitReason(ctx, job.organizationId) : null);
  },
});

/** Finished jobs that produced files, newest first: the outputs library. */
/** Readable names for a job's files: as its run names them, or else as a step run by hand. */
async function namesOfJob(
  ctx: QueryCtx,
  job: Doc<"jobs">,
): Promise<{ names: Record<string, string>; stepName: string | null }> {
  const step = job.runStepId ? await ctx.db.get(job.runStepId) : null;
  const run = step ? await ctx.db.get(step.runId) : null;
  if (!step || !run) return { names: handOutputNames(job), stepName: null };
  const names = outputNamesOf(run, [step]);
  // The step as it is named in the automation ("Caption TikTok clips"), not the toolkit
  // request it was sent as.
  const node = (run.nodes as { id: string; stepId?: string; label?: string }[]).find(
    (candidate) => candidate.id === step.nodeId,
  );
  const stepName =
    node?.label?.trim() || (node?.stepId ? (getStep(node.stepId)?.title ?? null) : null);
  return { names: { ...handOutputNames(job), ...names }, stepName };
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
        .filter(
          (job) =>
            job.outputs.length > 0 &&
            !job.libraryItemId &&
            !job.zoomImportId &&
            !job.googleMeetImportId &&
            !job.microsoftImportId &&
            !job.dropboxImportId &&
            !job.linkImportId,
        )
        .map(async (job) => {
          // Readable names, by link, and the step's own name: from the run the job was
          // part of, if it was.
          const { names, stepName } = await namesOfJob(ctx, job);
          return {
            jobId: job._id,
            stepId: job.stepId,
            stepName,
            finishedAt: job.finishedAt,
            urls: job.outputs,
            names,
          };
        }),
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
    // A step keeping a paid creator's disclosure gets the words heard in its videos.
    const step = getStep(job.stepId);
    const words = step?.readsWords
      ? await wordsForJob(ctx, job.organizationId, step, job.input)
      : undefined;
    return { job, connection, words };
  },
});

/**
 * A job bringing in a Zoom recording gets the sign-in the toolkit sends to Zoom only now,
 * as it is sent, so the token is never stored with the job.
 */
async function withZoomSignIn(ctx: ActionCtx, job: Doc<"jobs">, input: unknown): Promise<unknown> {
  if (!input || typeof input !== "object") return input;
  if (job.zoomImportId) {
    return { ...input, download_headers: await downloadHeadersFor(ctx, job.zoomImportId) };
  }
  // Likewise a Google Meet recording, fetched from the organizer's Drive.
  if (job.googleMeetImportId) {
    return {
      ...input,
      download_headers: await googleMeetDownloadHeaders(ctx, job.googleMeetImportId),
    };
  }
  return input;
}

/**
 * A job bringing in a Teams recording gets a fresh OneDrive download link only now, as
 * it is sent: the link works without a sign-in for a short while, so it is never kept.
 */
async function withMicrosoftLink(
  ctx: ActionCtx,
  job: Doc<"jobs">,
  input: unknown,
): Promise<unknown> {
  if (!input || typeof input !== "object") return input;
  if (job.microsoftImportId) {
    return { ...input, file_url: await downloadUrlFor(ctx, job.microsoftImportId) };
  }
  // Likewise a file from a watched Dropbox folder: a four-hour link, never kept.
  if (job.dropboxImportId) {
    return { ...input, file_url: await dropboxDownloadUrlFor(ctx, job.dropboxImportId) };
  }
  return input;
}

/**
 * A download from a video site gets the team's cookies for video sites (Settings → Video
 * Links) only now, as it is sent, unless the step was given cookies of its own.
 */
async function withVideoCookies(
  ctx: ActionCtx,
  job: Doc<"jobs">,
  input: unknown,
): Promise<unknown> {
  if (job.stepId !== "media-download" || !input || typeof input !== "object") return input;
  if ((input as { cookie?: unknown }).cookie) return input;
  const cipher: string | null = await ctx.runQuery(internal.videoCookies.forJob, {
    organizationId: job.organizationId,
  });
  return cipher ? { ...input, cookie: await decryptSecret(cipher) } : input;
}

/** Sends the job to the toolkit and asks it to post the result back to our webhook. */
export const dispatch = internalAction({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(internal.jobs.loadForDispatch, { jobId: args.jobId });
    if (!loaded) return;
    const { job, connection, words } = loaded;
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
        await withVideoCookies(
          ctx,
          job,
          await withMicrosoftLink(
            ctx,
            job,
            await withZoomSignIn(
              ctx,
              job,
              await withUploadLinks(ctx, job.organizationId, job.input),
            ),
          ),
        ),
        {
          webhookUrl: webhookUrl.toString(),
          id: job._id,
          signal: AbortSignal.timeout(120_000),
          words,
        },
      )) as { code?: number; job_id?: string; response?: unknown; message?: string } | null;

      if (job.sharedToolkit) await ctx.runMutation(internal.toolkitHealth.sharedWentFine, {});
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
          : error instanceof UploadLinkError ||
              error instanceof StepSetupError ||
              error instanceof ZoomSignInError ||
              error instanceof GoogleSignInError ||
              error instanceof MicrosoftSignInError ||
              error instanceof DropboxSignInError
            ? error.message
            : "The toolkit could not be reached.";
      // A request the toolkit refuses, or a file that is gone, fails the same way every
      // time. A toolkit that is busy, restarting or out of reach may be back shortly.
      const permanent =
        error instanceof ToolkitError
          ? !isTransientStatus(error.status)
          : error instanceof UploadLinkError ||
            error instanceof StepSetupError ||
            error instanceof ZoomSignInError ||
            error instanceof GoogleSignInError ||
            error instanceof MicrosoftSignInError ||
            error instanceof DropboxSignInError;
      // A shared toolkit that is busy or out of reach gets less sent to it for a while.
      const toolkitTrouble =
        error instanceof ToolkitError ? isTransientStatus(error.status) : !permanent;
      if (job.sharedToolkit && toolkitTrouble) {
        await ctx.runMutation(internal.toolkitHealth.sharedTrouble, {});
      }
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
    // A picture given to Caption video and the like: the file can never work, so it is
    // said plainly (the toolkit's own words kept below, for "Show details") and not retried.
    const wrongFile = args.ok ? null : wrongKindOfFile(job.stepId, args.error);
    const error = wrongFile ? `${wrongFile}\n\n${args.error}` : args.error;
    // A request the toolkit turned down for what it asks, such as motion with nothing to
    // draw, fails the same way when sent again.
    const permanent = args.permanent || (!args.ok && failsTheSameEveryTime(job.stepId, args.error));
    // A Convex document holds at most 1 MB. A very long transcript is kept as its file
    // links only; the full data is still at the toolkit's own output URLs.
    // A new speaker cut-out is kept for its video and is not one of the job's files.
    const result = args.ok
      ? await keepMaskFrom(ctx, job.organizationId, job.input, args.result)
      : args.result;
    const tooLarge = args.ok && JSON.stringify(result ?? null).length > MAX_RESULT_CHARS;
    await ctx.db.patch(args.jobId, {
      status: args.ok ? "done" : "failed",
      result: !args.ok
        ? undefined
        : tooLarge
          ? { note: "This result is too large to show here.", urls: collectUrls(result) }
          : result,
      outputs: args.ok ? collectUrls(result) : [],
      error: args.ok ? null : (error ?? "The step failed."),
      startedAt: job.startedAt ?? now,
      finishedAt: now,
      ...(!args.ok && permanent ? { permanent: true } : {}),
    });
    if (job.runStepId) await onJobFinished(ctx, job.runStepId);
    // A Zoom recording on its way in: it becomes an upload, or the import says why not.
    await onZoomJobFinished(ctx, job, args.ok, args.ok ? null : (args.error ?? "The step failed."));
    await onGoogleMeetJobFinished(
      ctx,
      job,
      args.ok,
      args.ok ? null : (args.error ?? "The step failed."),
    );
    await onMicrosoftJobFinished(
      ctx,
      job,
      args.ok,
      args.ok ? null : (args.error ?? "The step failed."),
    );
    await onDropboxJobFinished(
      ctx,
      job,
      args.ok,
      args.ok ? null : (args.error ?? "The step failed."),
    );
    // A video on its way in from a pasted link.
    await onLinkJobFinished(
      ctx,
      job,
      args.ok ? args.result : null,
      args.ok ? null : (args.error ?? "The step failed."),
    );
    // A sample being studied for its look.
    await onLookJobFinished(ctx, job);
    // A take of a storyboard's video, or the join of its takes.
    await onStoryboardVideoJob(ctx, (await ctx.db.get(job._id))!);
    // A moving preview of a clip for the "clips ready" trial tip.
    await onTipPreviewJob(ctx, (await ctx.db.get(job._id))!);
    // A library file being made searchable: keep what was said in it.
    if (job.libraryItemId) {
      await ctx.scheduler.runAfter(0, internal.library.readTranscript, { jobId: job._id });
    }
    // The next waiting jobs are sent on separately. Reading the team's whole queue here
    // made this mutation clash with every job being added or finished at the same moment
    // (several recordings coming in, each then sent to be transcribed), and a result lost
    // that way left an upload "on its way" until the late check.
    await ctx.scheduler.runAfter(0, internal.jobs.pumpTeam, {
      organizationId: job.organizationId,
    });
    return "recorded";
  },
});

// A job that has waited this long without being sent is stopped, so old work cannot block
// the line after an outage. A step that tries again joins the back of the line.
const WAIT_AT_MOST_MS = 6 * 60 * 60 * 1000;

/** Stops jobs that waited too long to be sent. Runs every few minutes. */
export const ageOut = internalMutation({
  args: {},
  handler: async (ctx) => {
    const oldest = await ctx.db
      .query("jobs")
      .withIndex("by_status_and_dispatchedAt", (q) =>
        q.eq("status", "queued").eq("dispatchedAt", undefined),
      )
      .take(50);
    const cutoff = Date.now() - WAIT_AT_MOST_MS;
    for (const job of oldest) {
      if (job._creationTime > cutoff) break;
      await ctx.scheduler.runAfter(0, internal.jobs.finish, {
        jobId: job._id,
        ok: false,
        error:
          "This job waited more than 6 hours without starting, so it was stopped to keep newer work moving. If the step tries again, it goes to the back of the line.",
      });
    }
  },
});

/** Sends a team's waiting jobs to its toolkit, as many as its limit allows. */
export const pumpTeam = internalMutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await pump(ctx, args.organizationId);
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
    await onZoomJobFinished(ctx, job, false, "The toolkit never reported a result for this job.");
    await onGoogleMeetJobFinished(
      ctx,
      job,
      false,
      "The toolkit never reported a result for this job.",
    );
    await onMicrosoftJobFinished(
      ctx,
      job,
      false,
      "The toolkit never reported a result for this job.",
    );
    await onDropboxJobFinished(
      ctx,
      job,
      false,
      "The toolkit never reported a result for this job.",
    );
    await onLinkJobFinished(ctx, job, null, "The toolkit never reported a result for this job.");
    await onLookJobFinished(ctx, job);
    await onStoryboardVideoJob(ctx, (await ctx.db.get(job._id))!);
    if (job.libraryItemId) {
      await ctx.scheduler.runAfter(0, internal.library.readTranscript, { jobId: job._id });
    }
    await ctx.scheduler.runAfter(0, internal.jobs.pumpTeam, {
      organizationId: job.organizationId,
    });
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

export const NOT_SENT_ERROR = "The job could not be sent to the toolkit.";

/**
 * Called by the toolkit pool when sending a job ended. A send that crashed or ran out of
 * time leaves the job waiting, holding one of the team's places: it is failed, not
 * permanently, so its step can send it again.
 */
export const sent = internalMutation({
  args: vOnCompleteArgs(v.object({ jobId: v.id("jobs") })),
  handler: async (ctx, { context, result }) => {
    if (result.kind === "success") return;
    const job = await ctx.db.get(context.jobId);
    if (!job || job.status !== "queued") return;
    await ctx.scheduler.runAfter(0, internal.jobs.finish, {
      jobId: job._id,
      ok: false,
      error: NOT_SENT_ERROR,
    });
  },
});

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
      await toolkitPool.enqueueAction(ctx, internal.jobs.askToolkit, { jobId: job._id });
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
    // A step keeping a paid creator's disclosure gets the words heard in its videos.
    const step = getStep(job.stepId);
    const words = step?.readsWords
      ? await wordsForJob(ctx, job.organizationId, step, job.input)
      : undefined;
    return { job, connection, words };
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
