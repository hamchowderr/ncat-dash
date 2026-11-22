import { type Brand, unusableShareLink, withDownloadLinks } from "@ncat-dash/automation-core";
import { getStep, isTeamStepId, SAVED_LOOK_STEP, userInputSchema } from "@ncat-dash/step-catalog";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { onOperatorToolkit } from "./edition";
import { lookSettingFor, teamLooksOf } from "./looks";
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
 * For an automation that is for a client, what the client set comes first: its logo,
 * colour and font each fill in before the team's, and its music, when it has any,
 * replaces the team's library.
 */
export async function brandAndMusicOf(
  ctx: QueryCtx,
  organizationId: string,
  clientId?: Id<"clients"> | null,
): Promise<{ brand: Brand; music: MusicTrack[] }> {
  const settings = await ctx.db
    .query("teamSettings")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .first();
  const { music: single, ...team } = settings?.brand ?? {};
  // Before the library there was one track, kept on the brand itself.
  let music = settings?.music ?? (single ? [{ name: "Background music", file: single }] : []);
  let rest: Brand = team;
  const client = clientId ? await ctx.db.get(clientId) : null;
  if (client && client.organizationId === organizationId) {
    const own = Object.entries(client.brand ?? {}).filter(
      ([key, value]) => key !== "music" && value,
    );
    rest = { ...team, ...Object.fromEntries(own) };
    if (client.music && client.music.length > 0) music = client.music;
  }
  return { brand: music[0] ? { ...rest, music: music[0].file } : rest, music };
}

/** The logo, colour, font and first music track steps use. Empty when none are set. */
export async function brandOf(
  ctx: QueryCtx,
  organizationId: string,
  clientId?: Id<"clients"> | null,
): Promise<Brand> {
  return (await brandAndMusicOf(ctx, organizationId, clientId)).brand;
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
  if (args.stepId === SAVED_LOOK_STEP) {
    // The saved look's name is swapped for the look itself, so a look changed in Settings
    // is the one used from the next job on, from a run, the Steps page or the agent.
    const input = (args.input ?? {}) as Record<string, unknown>;
    const looks = await teamLooksOf(ctx, args.organizationId);
    args = { ...args, input: { ...input, look: lookSettingFor(looks, input.look) } };
  }
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
      input: found.toRequest!(parsedBlanks.data, {}),
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
 * The most jobs all teams on the operator's toolkit may have there at once
 * (HOSTED_TOOLKIT_JOBS_AT_ONCE), or null when there is no such total. Each team's own
 * limit on jobs at once still applies under it.
 */
export function sharedLimit(): number | null {
  const raw = Number(process.env.HOSTED_TOOLKIT_JOBS_AT_ONCE?.trim());
  return Number.isInteger(raw) && raw > 0 ? raw : null;
}

/** Whether the team sends its jobs to the operator's toolkit, shared with other teams. */
async function onSharedToolkit(ctx: QueryCtx, organizationId: string): Promise<boolean> {
  const connection = await ctx.db
    .query("toolkitConnections")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .first();
  return connection !== null && onOperatorToolkit(connection.baseUrl);
}

/** How many more jobs a team may send under its own limit, and its waiting jobs in order. */
async function teamQueue(
  ctx: MutationCtx,
  organizationId: string,
): Promise<{ room: number; waiting: Doc<"jobs">[] }> {
  const limit = await parallelLimit(ctx, organizationId);
  const running = await ctx.db
    .query("jobs")
    .withIndex("by_organization_and_status", (q) =>
      q.eq("organizationId", organizationId).eq("status", "running"),
    )
    .take(limit);
  if (running.length >= limit) return { room: 0, waiting: [] };

  const queued = await ctx.db
    .query("jobs")
    .withIndex("by_organization_and_status", (q) =>
      q.eq("organizationId", organizationId).eq("status", "queued"),
    )
    .take(500);
  const inFlight = running.length + queued.filter((job) => job.dispatchedAt !== undefined).length;
  return {
    room: Math.max(0, limit - inFlight),
    waiting: queued.filter((job) => job.dispatchedAt === undefined),
  };
}

/** Hands a job over to be sent to the toolkit, with the give-up check that backs it. */
async function send(ctx: MutationCtx, job: Doc<"jobs">, shared: boolean): Promise<void> {
  await ctx.db.patch(job._id, {
    dispatchedAt: Date.now(),
    ...(shared ? { sharedToolkit: true } : {}),
  });
  await ctx.scheduler.runAfter(0, internal.jobs.dispatch, { jobId: job._id });
  await ctx.scheduler.runAfter(GIVE_UP_AFTER_MS, internal.jobs.giveUp, { jobId: job._id });
}

/** How many jobs of every team are at the operator's toolkit now, counted up to `cap`. */
async function sharedInFlight(ctx: MutationCtx, cap: number): Promise<number> {
  const running = await ctx.db
    .query("jobs")
    .withIndex("by_sharedToolkit_and_status", (q) =>
      q.eq("sharedToolkit", true).eq("status", "running"),
    )
    .take(cap);
  const sent = await ctx.db
    .query("jobs")
    .withIndex("by_sharedToolkit_and_status", (q) =>
      q.eq("sharedToolkit", true).eq("status", "queued"),
    )
    .take(cap);
  return running.length + sent.filter((job) => job.dispatchedAt !== undefined).length;
}

// The most teams looked at for a turn each time the shared toolkit has room.
const TURNS_LOOKED_AT = 100;

/**
 * Fills free room at the operator's toolkit one job at a time, giving each waiting team a
 * turn in order: the team served longest ago goes first, and a team just served goes to
 * the back. So one team's big batch cannot hold up everyone else's work.
 */
async function takeTurns(ctx: MutationCtx, cap: number): Promise<void> {
  let room = cap - (await sharedInFlight(ctx, cap));
  if (room <= 0) return;
  const turns = await ctx.db.query("toolkitTurns").withIndex("by_lastSentAt").take(TURNS_LOOKED_AT);
  const queues = new Map<string, { room: number; waiting: Doc<"jobs">[] }>();
  // Always later than any turn already given, so a team just served is truly at the back.
  let clock = Math.max(Date.now(), ...turns.map((turn) => turn.lastSentAt));
  let order = [...turns];
  while (room > 0 && order.length > 0) {
    let sentOne = false;
    for (const turn of order) {
      let queue = queues.get(turn.organizationId);
      if (!queue) {
        queue = await teamQueue(ctx, turn.organizationId);
        queues.set(turn.organizationId, queue);
      }
      if (queue.room <= 0 || queue.waiting.length === 0) continue;
      const job = queue.waiting.shift()!;
      queue.room -= 1;
      await send(ctx, job, true);
      clock += 1;
      turn.lastSentAt = clock;
      await ctx.db.patch(turn._id, { lastSentAt: clock });
      room -= 1;
      sentOne = true;
      // The team just served goes to the back of the line.
      order = [...order.filter((one) => one._id !== turn._id), turn];
      break;
    }
    if (!sentOne) break;
  }
  // A team with nothing left waiting gives up its place.
  for (const turn of turns) {
    const queue = queues.get(turn.organizationId);
    if (queue && queue.waiting.length === 0) await ctx.db.delete(turn._id);
  }
}

/**
 * Sends waiting jobs to the toolkit, oldest first, until the team has as many in flight
 * as its limit allows. On the operator's toolkit with a total set, the team waits for its
 * turn among every team using it. Called whenever a job is added or finishes.
 */
export async function pump(ctx: MutationCtx, organizationId: string): Promise<void> {
  const cap = sharedLimit();
  if (cap !== null && (await onSharedToolkit(ctx, organizationId))) {
    const { waiting } = await teamQueue(ctx, organizationId);
    if (waiting.length > 0) {
      const turn = await ctx.db
        .query("toolkitTurns")
        .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
        .first();
      // A team that starts waiting goes ahead of teams that were just served.
      if (!turn) await ctx.db.insert("toolkitTurns", { organizationId, lastSentAt: 0 });
    }
    await takeTurns(ctx, cap);
    return;
  }

  const { room, waiting } = await teamQueue(ctx, organizationId);
  for (const job of waiting.slice(0, room)) await send(ctx, job, false);
}
