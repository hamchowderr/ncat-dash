import { keyOfUrl } from "@takewon/automation-core";
import { vOnCompleteArgs } from "@convex-dev/workpool";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { support } from "./lib/support";
import {
  bucketOf,
  DELETE_AT_ONCE,
  deleteJobOutputs,
  deleteObjects,
  listObjects,
  storageConnection,
} from "./lib/bucket";
import { backgroundPool } from "./lib/pools";
import { PURGE_TABLES, purgeBatch } from "./lib/teamPurge";

/**
 * Deleting a team takes away everything it made. Better Auth deletes the team itself, its
 * members and its invitations at once (a team deleted in Settings goes through its own
 * route; an account deleted with its teams goes through accountDeletion.ts). Then this
 * runs in the background, on the background Workpool:
 *
 * 1. Files. Everything in the team's folder in storage (teams/<id>/), and the results the
 *    toolkit wrote at the top of the bucket for the team's jobs. Tried again with backoff
 *    if the toolkit can't be reached; when every try fails the rows go anyway, and the
 *    record says what was left (a team's own toolkit that is switched off for good).
 * 2. Rows. Every table in lib/teamPurge.ts, a batch at a time, each batch its own
 *    transaction that queues the next. The toolkit connection goes last.
 *
 * The teamDeletions row is the record that it happened, and of how far it got.
 */

/** How many times the files are tried, the first and then the retries. */
export const FILE_TRIES = 5;
// About 1, 2, 4 and 8 minutes apart.
const FILE_RETRY = { maxAttempts: FILE_TRIES, initialBackoffMs: 60_000, base: 2 };
// Folder pages read per pass, before the work queues itself again.
const LIST_PAGES = 5;
const OUTPUT_PAGE = 200;

/** Starts deleting what a team made. Safe to call twice: the second does nothing. */
export const begin = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    by: v.string(),
    reason: v.union(v.literal("team"), v.literal("account")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const already = await ctx.db
      .query("teamDeletions")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    if (already) return null;
    // AI agents connected to the team stop at once, before anything else goes.
    await ctx.runMutation(components.betterAuth.deletion.endTeamAgents, {
      organizationId: args.organizationId,
    });
    // Help requests asked from the team, with the team's runs and page in them.
    await support.removeForScope(ctx, args.organizationId);
    const deletionId = await ctx.db.insert("teamDeletions", {
      ...args,
      startedAt: Date.now(),
      phase: "files",
      table: 0,
      filesDeleted: 0,
      rowsDeleted: 0,
    });
    await queueFiles(ctx, deletionId);
    return null;
  },
});

async function queueFiles(
  ctx: Parameters<typeof backgroundPool.enqueueAction>[0],
  deletionId: Id<"teamDeletions">,
) {
  await backgroundPool.enqueueAction(
    ctx,
    internal.teamDeletion.deleteFiles,
    { deletionId },
    { retry: FILE_RETRY, onComplete: internal.teamDeletion.filesEnded, context: { deletionId } },
  );
}

/** The deletion, and the storage its team's files are in. */
export const target = internalQuery({
  args: { deletionId: v.id("teamDeletions") },
  handler: async (ctx, args) => {
    const deletion = await ctx.db.get(args.deletionId);
    if (!deletion) return null;
    const connection = await storageConnection(ctx, deletion.organizationId);
    return { deletion, connection };
  },
});

/** Bucket keys of files the toolkit wrote for the team's jobs, a page of jobs at a time. */
export const jobOutputKeys = internalQuery({
  args: { organizationId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const connection = await storageConnection(ctx, args.organizationId);
    const page = await ctx.db
      .query("jobs")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .paginate(args.paginationOpts);
    const storage = connection?.storage;
    const keys = new Set<string>();
    if (storage?.endpoint) {
      const address = {
        endpoint: storage.endpoint,
        bucket: storage.bucket,
        ...(storage.publicUrl ? { publicUrl: storage.publicUrl } : {}),
      };
      for (const job of page.page) {
        for (const link of job.outputs) {
          const key = keyOfUrl(address, link);
          if (key) keys.add(key);
        }
      }
    }
    return { keys: [...keys], isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/**
 * Deletes the team's files: its whole folder, then its jobs' results. A folder too big
 * for one pass queues another (returns "more").
 */
export const deleteFiles = internalAction({
  args: { deletionId: v.id("teamDeletions") },
  returns: v.union(v.literal("done"), v.literal("more")),
  handler: async (ctx, args): Promise<"done" | "more"> => {
    const found = await ctx.runQuery(internal.teamDeletion.target, args);
    if (!found || found.deletion.phase !== "files") return "done";
    const { deletion, connection } = found;
    if (!connection) return "done";
    const bucket = await bucketOf(connection);

    let deleted = 0;
    const left: string[] = [];
    const files = await listObjects(bucket, "", LIST_PAGES);
    for (let at = 0; at < files.length; at += DELETE_AT_ONCE) {
      const keys = files.slice(at, at + DELETE_AT_ONCE).map((file) => file.key);
      const failed = await deleteObjects(bucket, keys);
      deleted += keys.length - failed.length;
      left.push(...failed);
    }
    if (left.length > 0) {
      await ctx.runMutation(internal.teamDeletion.countFiles, { ...args, deleted });
      throw new Error(`Storage would not delete ${left.length} of the team's files.`);
    }
    // A full set of pages: there may be more in the folder.
    const more = files.length >= LIST_PAGES * DELETE_AT_ONCE;
    if (!more) {
      let cursor: string | null = null;
      for (;;) {
        const page: { keys: string[]; isDone: boolean; continueCursor: string } =
          await ctx.runQuery(internal.teamDeletion.jobOutputKeys, {
            organizationId: deletion.organizationId,
            paginationOpts: { numItems: OUTPUT_PAGE, cursor },
          });
        const failed = await deleteJobOutputs(bucket, page.keys);
        deleted += page.keys.filter((key) => !key.startsWith("teams/")).length - failed.length;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    await ctx.runMutation(internal.teamDeletion.countFiles, { ...args, deleted });
    return more ? "more" : "done";
  },
});

export const countFiles = internalMutation({
  args: { deletionId: v.id("teamDeletions"), deleted: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const deletion = await ctx.db.get(args.deletionId);
    if (deletion && args.deleted > 0) {
      await ctx.db.patch(deletion._id, { filesDeleted: deletion.filesDeleted + args.deleted });
    }
    return null;
  },
});

/** After the files: another pass, or on to the rows. Every try failing still moves on. */
export const filesEnded = internalMutation({
  args: vOnCompleteArgs(v.object({ deletionId: v.id("teamDeletions") })),
  returns: v.null(),
  handler: async (ctx, { context, result }) => {
    const deletion = await ctx.db.get(context.deletionId);
    if (!deletion || deletion.phase !== "files") return null;
    if (result.kind === "success" && result.returnValue === "more") {
      await queueFiles(ctx, deletion._id);
      return null;
    }
    await ctx.db.patch(deletion._id, {
      phase: "rows",
      ...(result.kind === "failed"
        ? { filesProblem: result.error.slice(0, 500) }
        : result.kind === "canceled"
          ? { filesProblem: "Stopped before the files were deleted." }
          : {}),
    });
    await backgroundPool.enqueueMutation(ctx, internal.teamDeletion.deleteRows, {
      deletionId: deletion._id,
    });
    return null;
  },
});

/** Deletes one batch of the team's rows, then queues the next until every table is empty. */
export const deleteRows = internalMutation({
  args: { deletionId: v.id("teamDeletions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const deletion = await ctx.db.get(args.deletionId);
    if (!deletion || deletion.phase !== "rows") return null;
    let table = deletion.table;
    let deleted = 0;
    // Empty tables cost little, so a pass moves through them until it deletes something.
    while (table < PURGE_TABLES.length) {
      const batch = await purgeBatch(ctx, PURGE_TABLES[table], deletion.organizationId);
      deleted += batch.deleted;
      if (batch.state === "more") break;
      table++;
      if (deleted > 0) break;
    }
    const finished = table >= PURGE_TABLES.length;
    await ctx.db.patch(deletion._id, {
      table,
      rowsDeleted: deletion.rowsDeleted + deleted,
      ...(finished ? { phase: "done" as const, finishedAt: Date.now() } : {}),
    });
    if (!finished) {
      await backgroundPool.enqueueMutation(ctx, internal.teamDeletion.deleteRows, args);
    }
    return null;
  },
});

/** How a team's deletion went, for the operator. */
export const status = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("teamDeletions")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first(),
});

/**
 * Takes away the data of a team that was deleted before deleting a team did (it was left
 * behind). For the operator: `npx convex run teamDeletion:cleanUpLeftovers`, with the
 * team's id. Refuses a team that still exists.
 */
export const cleanUpLeftovers = internalMutation({
  args: { organizationId: v.string(), name: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const name = await ctx.runQuery(components.betterAuth.deletion.teamName, {
      organizationId: args.organizationId,
    });
    if (name !== null) return "That team still exists. Delete it from Settings instead.";
    await ctx.runMutation(internal.teamDeletion.begin, {
      organizationId: args.organizationId,
      name: args.name ?? "",
      by: "operator",
      reason: "team",
    });
    return "Started.";
  },
});

/**
 * Teams that are gone from Better Auth but still have data here, found through the rows
 * almost every team has. For the operator, before cleanUpLeftovers.
 */
export const findLeftovers = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const ids = new Set<string>();
    for (const row of await ctx.db.query("teamSettings").take(2000)) ids.add(row.organizationId);
    for (const row of await ctx.db.query("toolkitConnections").take(2000)) {
      ids.add(row.organizationId);
    }
    for (const row of await ctx.db.query("uploads").order("desc").take(2000)) {
      ids.add(row.organizationId);
    }
    const gone = [];
    for (const organizationId of ids) {
      const name = await ctx.runQuery(components.betterAuth.deletion.teamName, { organizationId });
      if (name !== null) continue;
      const deletion = await ctx.db
        .query("teamDeletions")
        .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
        .first();
      if (!deletion) gone.push(organizationId);
    }
    return gone;
  },
});
