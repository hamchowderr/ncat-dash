import { type Brand, unusableShareLink, withDownloadLinks } from "@ncat-dash/automation-core";
import { getStep, isTeamStepId, userInputSchema } from "@ncat-dash/step-catalog";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { withTeamSteps } from "./teamSteps";

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

export type MusicTrack = { name: string; file: string };

/**
 * The team's logo, colour and font from its settings, and its music library. The first
 * track is the one a step uses when it does not pick another, so it is also `brand.music`.
 */
export async function brandAndMusicOf(
  ctx: QueryCtx,
  organizationId: string,
): Promise<{ brand: Brand; music: MusicTrack[] }> {
  const settings = await ctx.db
    .query("teamSettings")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .first();
  const { music: single, ...rest } = settings?.brand ?? {};
  // Before the library there was one track, kept on the brand itself.
  const music = settings?.music ?? (single ? [{ name: "Background music", file: single }] : []);
  return { brand: music[0] ? { ...rest, music: music[0].file } : rest, music };
}

/** The team's logo, colour, font and first music track. Empty when none are set. */
export async function brandOf(ctx: QueryCtx, organizationId: string): Promise<Brand> {
  return (await brandAndMusicOf(ctx, organizationId)).brand;
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
  await withTeamSteps(ctx, args.organizationId);
  const found = getStep(args.stepId);
  if (!found) return { ok: false, code: "not_found", message: "Unknown step." };
  // A team step is sent as the FFmpeg compose request it fills in, so the job needs
  // nothing of the team step once queued, even if the step is changed or removed later.
  // A Drive or Dropbox share link opens a preview page, so the toolkit is handed the
  // address that downloads the file instead; a folder link cannot work at all.
  const unusable = unusableShareLink(args.input);
  if (unusable) return { ok: false, code: "invalid_input", message: unusable.problem };
  const step = isTeamStepId(found.id) ? null : found;
  if (!step) {
    const parsedBlanks = userInputSchema(found).safeParse(withDownloadLinks(args.input));
    if (!parsedBlanks.success) {
      const issue = parsedBlanks.error.issues[0];
      return {
        ok: false,
        code: "invalid_input",
        message: `${issue.path.join(".") || "Input"}: ${issue.message}`,
      };
    }
    return await enqueueJob(ctx, {
      ...args,
      stepId: "ffmpeg-compose",
      input: found.toRequest!(parsedBlanks.data),
    });
  }

  const parsed = userInputSchema(step).safeParse(withDownloadLinks(args.input));
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
