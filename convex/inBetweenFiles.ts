import { keyOfUrl } from "@takewon/automation-core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { bucketOf, DELETE_AT_ONCE, deleteJobOutputs, storageConnection } from "./lib/bucket";
import { finishedFiles } from "./lib/exports";

/**
 * The daily clean-up of in-between files. Each step of a run has the toolkit write its
 * result at the top of the bucket, named after the toolkit's own job; the next step reads
 * it, and only the run's last files are kept, copied into the team's folder (files.ts,
 * keepFinished). The rest stay behind, and over time they are most of the bucket.
 *
 * Once a day, one team at a time, this takes away the files the team's own jobs wrote in
 * the middle of runs that finished well a week or more ago, when nothing of the team's
 * still points to them. It works from the team's job records, never from a folder: the
 * top of the bucket is shared by every team on the toolkit, so a file is only ever taken
 * away for the team whose job made it. Never taken away:
 *
 * - a run's last files (its results), even where the copy into the team's folder failed;
 * - anything a library file, a review clip, a project deliverable or a saved look uses;
 * - files of runs still going, waiting, failed or stopped (a failed run can be picked up
 *   again from the step that failed, which needs the files before it);
 * - files of jobs not sent by a run, such as the agent's, a step test's or an import's;
 * - anything inside a team's folder (teams/<id>/).
 */

/** How long after a run finishes its in-between files are kept, in days. */
export const KEEP_IN_BETWEEN_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;
/** After this long a failed or stopped run's files are left for good and not looked at again. */
const GIVE_UP_DAYS = 30;
/** Jobs read per page. */
const JOB_PAGE = 100;
/** Pages read per team in one go, before the work queues itself again. */
const PAGES_PER_PASS = 10;
/** Time between one team's turn and the next. */
const TEAM_GAP_MS = 30_000;

/** Every team with a toolkit connection, each given its turn a little after the last. */
export const daily = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const teams = new Set<string>();
    for await (const connection of ctx.db.query("toolkitConnections")) {
      if (connection.storage) teams.add(connection.organizationId);
    }
    let at = 0;
    for (const organizationId of teams) {
      await ctx.scheduler.runAfter(at, internal.inBetweenFiles.clearTeam, {
        organizationId,
        cursor: null,
      });
      at += TEAM_GAP_MS;
    }
    return teams.size;
  },
});

/** What one page of a team's jobs comes to. */
interface PageFindings {
  /** Bucket keys to take away, each with the job whose file it is. */
  files: { key: string; jobId: Id<"jobs"> }[];
  /** Jobs looked at for good: their files are gone or are kept for good. */
  settled: Id<"jobs">[];
  isDone: boolean;
  continueCursor: string;
}

/** The files the team uses outside runs: library files, review clips, deliverables, looks. */
async function usedLinks(ctx: QueryCtx, organizationId: string): Promise<Set<string>> {
  const used = new Set<string>();
  const add = (link: string | undefined) => {
    if (link) used.add(link);
  };
  for await (const clip of ctx.db
    .query("reviewClips")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))) {
    for (const version of clip.versions) add(version.url);
  }
  for await (const deliverable of ctx.db
    .query("deliverables")
    .withIndex("by_organization_and_dueAt", (q) => q.eq("organizationId", organizationId))) {
    for (const version of deliverable.versions) add(version.url);
  }
  for await (const study of ctx.db
    .query("lookStudies")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))) {
    add(study.sheetUrl);
  }
  for await (const look of ctx.db
    .query("teamLooks")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))) {
    add(look.sheetUrl);
  }
  return used;
}

/** One page of the team's jobs not looked at yet, and which of their files can go. */
export const findPage = internalQuery({
  args: { organizationId: v.string(), cursor: v.union(v.null(), v.string()), now: v.number() },
  handler: async (ctx, args): Promise<PageFindings> => {
    const page = await ctx.db
      .query("jobs")
      .withIndex("by_organization_and_outputsClearedAt", (q) =>
        q.eq("organizationId", args.organizationId).eq("outputsClearedAt", undefined),
      )
      .paginate({ numItems: JOB_PAGE, cursor: args.cursor });
    const connection = await storageConnection(ctx, args.organizationId);
    const storage = connection?.storage;
    const found: PageFindings = {
      files: [],
      settled: [],
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
    if (!storage?.endpoint) return found;
    const address = {
      endpoint: storage.endpoint,
      bucket: storage.bucket,
      ...(storage.publicUrl ? { publicUrl: storage.publicUrl } : {}),
    };
    const used = await usedLinks(ctx, args.organizationId);
    // Each run's last files, read once for all its jobs.
    const runs = new Map<Id<"runs">, { run: Doc<"runs">; finished: Set<string> } | null>();
    const runOf = async (runId: Id<"runs">) => {
      if (!runs.has(runId)) {
        const run = await ctx.db.get(runId);
        if (!run) runs.set(runId, null);
        else {
          const steps = await ctx.db
            .query("runSteps")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .take(500);
          runs.set(runId, { run, finished: new Set(finishedFiles(run, steps)) });
        }
      }
      return runs.get(runId) ?? null;
    };

    for (const job of page.page) {
      // Still going: looked at again tomorrow.
      if (job.status !== "done" && job.status !== "failed") continue;
      // Not sent by a run: its files are what someone asked for. Kept for good.
      if (!job.runStepId) {
        found.settled.push(job._id);
        continue;
      }
      const step = await ctx.db.get(job.runStepId);
      const owner = step ? await runOf(step.runId) : null;
      if (!owner) {
        found.settled.push(job._id);
        continue;
      }
      const { run, finished } = owner;
      const age = run.finishedAt === null ? 0 : args.now - run.finishedAt;
      if (run.status !== "done") {
        // A failed or stopped run may be picked up again; after a month it is left for good.
        if (run.status !== "running" && run.status !== "waiting" && age >= GIVE_UP_DAYS * DAY) {
          found.settled.push(job._id);
        }
        continue;
      }
      // Too new: looked at again tomorrow.
      if (age < KEEP_IN_BETWEEN_DAYS * DAY) continue;
      for (const link of job.outputs) {
        if (finished.has(link) || used.has(link)) continue;
        const inLibrary = await ctx.db
          .query("libraryItems")
          .withIndex("by_organization_and_url", (q) =>
            q.eq("organizationId", args.organizationId).eq("url", link),
          )
          .first();
        if (inLibrary) continue;
        const key = keyOfUrl(address, link);
        // Only the top of the bucket: never inside any team's folder.
        if (!key || key.startsWith("teams/")) continue;
        found.files.push({ key, jobId: job._id });
      }
      found.settled.push(job._id);
    }
    return found;
  },
});

/** Marks jobs as looked at, so the clean-up does not read them again. */
export const settle = internalMutation({
  args: { jobIds: v.array(v.id("jobs")), at: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const jobId of args.jobIds) {
      const job = await ctx.db.get(jobId);
      if (job && job.outputsClearedAt === undefined) {
        await ctx.db.patch(jobId, { outputsClearedAt: args.at });
      }
    }
    return null;
  },
});

/**
 * One team's turn: reads its jobs a page at a time, takes away the in-between files that
 * can go, and marks those jobs done with. A team with more jobs than one pass reads queues
 * another pass. Returns how many files were taken away in this pass.
 */
export const clearTeam = internalAction({
  args: { organizationId: v.string(), cursor: v.union(v.null(), v.string()) },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    const connection = await ctx.runQuery(internal.inBetweenFiles.connectionOf, {
      organizationId: args.organizationId,
    });
    if (!connection) return 0;
    const bucket = await bucketOf(connection);
    const now = Date.now();
    let cursor = args.cursor;
    let removed = 0;
    for (let pass = 0; pass < PAGES_PER_PASS; pass++) {
      const page: PageFindings = await ctx.runQuery(internal.inBetweenFiles.findPage, {
        organizationId: args.organizationId,
        cursor,
        now,
      });
      // A job whose file the bucket would not take away is looked at again tomorrow.
      const kept = new Set<Id<"jobs">>();
      for (let at = 0; at < page.files.length; at += DELETE_AT_ONCE) {
        const some = page.files.slice(at, at + DELETE_AT_ONCE);
        let failed: string[];
        try {
          failed = await deleteJobOutputs(
            bucket,
            some.map((file) => file.key),
          );
        } catch {
          // Storage did not answer: nothing of this page is marked; tomorrow tries again.
          return removed;
        }
        const left = new Set(failed);
        for (const file of some) {
          if (left.has(file.key)) kept.add(file.jobId);
          else removed++;
        }
      }
      const settled = page.settled.filter((jobId) => !kept.has(jobId));
      if (settled.length > 0) {
        await ctx.runMutation(internal.inBetweenFiles.settle, { jobIds: settled, at: now });
      }
      if (page.isDone) return removed;
      cursor = page.continueCursor;
    }
    await ctx.scheduler.runAfter(0, internal.inBetweenFiles.clearTeam, {
      organizationId: args.organizationId,
      cursor,
    });
    return removed;
  },
});

/** The team's connection storage goes through, for `clearTeam`. */
export const connectionOf = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const connection = await storageConnection(ctx, args.organizationId);
    return connection?.storage?.endpoint ? connection : null;
  },
});
