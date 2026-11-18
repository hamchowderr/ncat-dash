// The Files page: everything in the team's folder of the bucket, read as folders and files.
// Keys here are written from inside the team's folder (see lib/bucket.ts), so "" is the
// top of the team's storage and no team can name another team's files.
//
// A bucket has no folders and no rename. A folder is every key that starts with its
// prefix, an empty folder is a zero-byte object whose key ends in a slash, and a rename or
// move is a copy to the new key followed by deleting the old one. Whatever pointed at the
// old key (an upload record, a step's outputs, a watched folder) is moved along between
// the copy and the delete, so a pointer never names a file that is not there.

import {
  baseName,
  fileFamily,
  followFolder,
  followMoves,
  fileNameOfLink,
  freeName,
  isFolderKey,
  keyOfUrl,
  keyInsideMovedFolder,
  movedKey,
  moveProblem,
  nameProblem,
  parentOf,
  readFileDetails,
  type BrandFileKey,
  readUploadRef,
  renamedKey,
  teamFolder,
} from "@ncat-dash/automation-core";
import { callStep, getStep } from "@ncat-dash/step-catalog";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireMember } from "./lib/authz";
import {
  type Bucket,
  bucketOf as bucketFor,
  copyObject,
  deleteObject,
  keyExists,
  listFolder,
  listObjects,
  presign,
  putFolder,
  storageConnection,
} from "./lib/bucket";
import { finishedFiles } from "./lib/exports";
import { outputNamesOf } from "./lib/outputs";
import { fileDetailsValidator } from "./schema";

const UPLOAD_LINK_SECONDS = 60 * 60;
const VIEW_LINK_SECONDS = 60 * 60;
const SHARE_LINK_SECONDS = 7 * 24 * 60 * 60;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
// The most objects one rename, move or delete touches. A bigger folder is done in parts.
const MAX_OBJECTS = 2000;
const AT_ONCE = 6;
const CHUNK = 200;

const fail = (code: string, message: string) => new ConvexError({ code, message });

async function bucketOf(ctx: ActionCtx, organizationId: string): Promise<Bucket> {
  await ctx.runQuery(internal.storage.authorize, { organizationId, managersOnly: false });
  const storage = await ctx.runQuery(internal.storage.load, { organizationId });
  if (!storage) throw fail("no_storage", "Connect your toolkit first.");
  return await bucketFor(storage);
}

/** Runs `work` over every item, a few at a time, and returns the items that failed. */
async function eachOf<T>(items: T[], work: (item: T) => Promise<void>): Promise<T[]> {
  const failed: T[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        try {
          await work(item);
        } catch {
          failed.push(item);
        }
      }
    }),
  );
  return failed;
}

function chunks<T>(items: T[]): T[][] {
  const parts: T[][] = [];
  for (let at = 0; at < items.length; at += CHUNK) parts.push(items.slice(at, at + CHUNK));
  return parts;
}

/**
 * A folder that only exists because of the files in it vanishes when the last one leaves.
 * This leaves an empty-folder marker behind instead, so emptying a folder keeps the folder.
 */
async function keepFolders(config: Bucket, keys: string[]): Promise<void> {
  const parents = [...new Set(keys.map(parentOf))].filter((parent) => parent !== "");
  await eachOf(parents, async (parent) => {
    if (!(await keyExists(config, parent))) await putFolder(config, parent);
  });
}

/** Every object a file or folder key stands for. */
async function objectsOf(config: Bucket, key: string): Promise<string[]> {
  if (!isFolderKey(key)) return [key];
  const objects = await listObjects(config, key, Math.ceil(MAX_OBJECTS / 1000) + 1);
  return objects.map((object) => object.key);
}

const fileValidator = v.object({
  key: v.string(),
  name: v.string(),
  size: v.number(),
  lastModified: v.number(),
  kind: v.union(v.literal("video"), v.literal("audio"), v.literal("image"), v.literal("other")),
  // Set when the file came in through this app, which is when its details were read.
  uploadId: v.union(v.null(), v.id("uploads")),
  details: v.union(v.null(), fileDetailsValidator),
  // Set when the team's brand uses this file, so it is not deleted by mistake.
  usedAs: v.union(
    v.null(),
    v.literal("logo"),
    v.literal("music"),
    v.literal("card"),
    v.literal("intro"),
    v.literal("outro"),
  ),
});

/** One folder of the bucket: the folders and files straight inside it. */
export const list = action({
  args: { organizationId: v.string(), prefix: v.string(), token: v.optional(v.string()) },
  returns: v.object({
    bucket: v.string(),
    folders: v.array(v.object({ key: v.string(), name: v.string() })),
    files: v.array(fileValidator),
    next: v.union(v.null(), v.string()),
  }),
  handler: async (ctx, args) => {
    const config = await bucketOf(ctx, args.organizationId);
    let page;
    try {
      page = await listFolder(config, args.prefix, args.token);
    } catch {
      throw fail(
        "storage",
        "Your files could not be read. Check the toolkit connection in Settings.",
      );
    }
    // The empty object that marks a folder is the folder itself, not a file inside it.
    const objects = page.objects.filter((object) => object.key !== args.prefix);
    const known: Record<
      string,
      {
        uploadId: Id<"uploads">;
        details: Doc<"uploads">["details"] | null;
        usedAs: BrandFileKey | null;
      }
    > = await ctx.runQuery(internal.files.uploadsAt, {
      organizationId: args.organizationId,
      keys: objects.map((object) => object.key),
    });
    // A file that did not come through this app has not been read yet. Hand back what an
    // earlier visit read, and have the toolkit read the rest; they show up as they finish.
    const outside: {
      details: Record<string, Doc<"uploads">["details"]>;
      fresh: { key: string; etag: string }[];
    } = await ctx.runMutation(internal.files.claimOutside, {
      organizationId: args.organizationId,
      files: objects
        .filter(
          (object) => !known[object.key] && object.size > 0 && fileFamily(object.key) !== "other",
        )
        .map(({ key, etag }) => ({ key, etag })),
    });
    for (const [index, file] of outside.fresh.entries()) {
      await ctx.scheduler.runAfter(index * 250, internal.files.readOutside, {
        organizationId: args.organizationId,
        ...file,
      });
    }
    return {
      bucket: config.bucket,
      folders: page.folders.map((key) => ({ key, name: baseName(key) })),
      files: objects.map((object) => ({
        key: object.key,
        name: baseName(object.key),
        size: object.size,
        lastModified: object.lastModified,
        kind: fileFamily(object.key),
        uploadId: known[object.key]?.uploadId ?? null,
        details: known[object.key]?.details ?? outside.details[object.key] ?? null,
        usedAs: known[object.key]?.usedAs ?? null,
      })),
      next: page.next,
    };
  },
});

/** Only the folders inside a folder, for choosing where to move something. */
export const folders = action({
  args: { organizationId: v.string(), prefix: v.string() },
  returns: v.array(v.object({ key: v.string(), name: v.string() })),
  handler: async (ctx, args) => {
    const config = await bucketOf(ctx, args.organizationId);
    const found: string[] = [];
    let token: string | undefined;
    for (let page = 0; page < 5; page++) {
      const listing = await listFolder(config, args.prefix, token);
      found.push(...listing.folders);
      if (!listing.next) break;
      token = listing.next;
    }
    return found.map((key) => ({ key, name: baseName(key) }));
  },
});

/** Makes an empty folder inside `prefix`. */
export const createFolder = action({
  args: { organizationId: v.string(), prefix: v.string(), name: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const config = await bucketOf(ctx, args.organizationId);
    const problem = nameProblem(args.name);
    if (problem) throw fail("invalid_input", problem);
    const key = `${args.prefix}${args.name.trim()}/`;
    if (await keyExists(config, key)) {
      throw fail("exists", `There is already a folder called "${args.name.trim()}" here.`);
    }
    await putFolder(config, key);
    return key;
  },
});

/** A link to one file: to play it here (an hour), to download it, or to share (seven days). */
export const linkFor = action({
  args: {
    organizationId: v.string(),
    key: v.string(),
    use: v.union(v.literal("view"), v.literal("download"), v.literal("share")),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const config = await bucketOf(ctx, args.organizationId);
    if (args.use === "download") {
      const name = baseName(args.key).replace(/["\\\r\n]/g, "_");
      return await presign(config, "GET", args.key, VIEW_LINK_SECONDS, { downloadName: name });
    }
    return await presign(
      config,
      "GET",
      args.key,
      args.use === "share" ? SHARE_LINK_SECONDS : VIEW_LINK_SECONDS,
    );
  },
});

/**
 * Starts an upload into a folder, keeping the file's own name. A name already taken there
 * gets a number added, so nothing is overwritten. Finish it with `storage.finishUpload`.
 */
export const startUpload = action({
  args: {
    organizationId: v.string(),
    prefix: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  returns: v.object({ uploadId: v.id("uploads"), uploadUrl: v.string(), key: v.string() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ uploadId: Id<"uploads">; uploadUrl: string; key: string }> => {
    const config = await bucketOf(ctx, args.organizationId);
    const { userId } = await ctx.runQuery(internal.storage.authorize, {
      organizationId: args.organizationId,
      managersOnly: false,
    });
    if (args.size <= 0 || args.size > MAX_UPLOAD_BYTES) {
      throw fail("too_large", "Files can be up to 5 GB.");
    }
    const problem = nameProblem(args.fileName);
    if (problem) throw fail("invalid_input", problem);
    const wanted = args.fileName.trim();
    const dot = wanted.lastIndexOf(".");
    const stem = dot > 0 ? wanted.slice(0, dot) : wanted;
    const taken = new Set(
      (await listObjects(config, `${args.prefix}${stem}`, 1)).map((object) => object.key),
    );
    const name = freeName(wanted, (candidate) => taken.has(`${args.prefix}${candidate}`));
    const key = `${args.prefix}${name}`;
    const uploadUrl = await presign(config, "PUT", key, UPLOAD_LINK_SECONDS);
    const uploadId: Id<"uploads"> = await ctx.runMutation(internal.storage.recordUpload, {
      organizationId: args.organizationId,
      key,
      fileName: name,
      contentType: args.contentType || "application/octet-stream",
      size: args.size,
      createdBy: userId,
    });
    return { uploadId, uploadUrl, key };
  },
});

/**
 * Copies every pair to its new key, moves the pointers along, then deletes the originals.
 * A pair is a file or a whole folder. Nothing is overwritten: a name already taken stops
 * the whole change before anything is copied.
 */
async function relocate(
  ctx: ActionCtx,
  organizationId: string,
  config: Bucket,
  pairs: { from: string; to: string }[],
): Promise<{ moved: number; leftBehind: number }> {
  const copies: { from: string; to: string }[] = [];
  for (const { from, to } of pairs) {
    const problem = moveProblem(from, to);
    if (problem) throw fail("invalid_input", problem);
    if (await keyExists(config, to)) {
      throw fail("exists", `There is already something called "${baseName(to)}" there.`);
    }
    const objects = await objectsOf(config, from);
    if (objects.length === 0 || (!isFolderKey(from) && !(await keyExists(config, from)))) {
      throw fail("not_found", `"${baseName(from)}" is no longer there. Refresh the page.`);
    }
    for (const key of objects) {
      copies.push({
        from: key,
        to: isFolderKey(from) ? keyInsideMovedFolder(key, from, to) : to,
      });
    }
    if (copies.length > MAX_OBJECTS) {
      throw fail(
        "too_many",
        `That is more than ${MAX_OBJECTS} files at once. Move the folders inside it one at a time.`,
      );
    }
  }

  const etags = new Map<string, string>();
  const notCopied = await eachOf(copies, async (copy) => {
    etags.set(copy.to, await copyObject(config, copy.from, copy.to));
  });
  if (notCopied.length > 0) {
    // Put things back as they were: the originals are untouched, so only copies go.
    await eachOf([...etags.keys()], (key) => deleteObject(config, key));
    throw fail(
      "storage",
      "Your storage would not copy every file, so nothing was changed. Files over 5 GB cannot be moved from here.",
    );
  }

  const moves = copies.map((copy) => ({ ...copy, etag: etags.get(copy.to) ?? "" }));
  for (const part of chunks(moves)) {
    await ctx.runMutation(internal.files.followRecords, { organizationId, moves: part });
  }
  await ctx.runMutation(internal.files.followLinks, {
    organizationId,
    moves: moves.map(({ from, to }) => ({ from, to })),
    folders: pairs.filter(({ from }) => isFolderKey(from)),
  });

  const leftBehind = await eachOf(copies, (copy) => deleteObject(config, copy.from));
  await keepFolders(
    config,
    pairs.map(({ from }) => from),
  );
  return { moved: copies.length, leftBehind: leftBehind.length };
}

const relocated = v.object({ moved: v.number(), leftBehind: v.number() });

/** Gives a file or folder a new name where it is. */
export const rename = action({
  args: { organizationId: v.string(), key: v.string(), name: v.string() },
  returns: relocated,
  handler: async (ctx, args): Promise<{ moved: number; leftBehind: number }> => {
    const config = await bucketOf(ctx, args.organizationId);
    const problem = nameProblem(args.name);
    if (problem) throw fail("invalid_input", problem);
    return await relocate(ctx, args.organizationId, config, [
      { from: args.key, to: renamedKey(args.key, args.name) },
    ]);
  },
});

/** Moves files and folders into another folder ("" is the top of the bucket). */
export const move = action({
  args: { organizationId: v.string(), keys: v.array(v.string()), toFolder: v.string() },
  returns: relocated,
  handler: async (ctx, args): Promise<{ moved: number; leftBehind: number }> => {
    const config = await bucketOf(ctx, args.organizationId);
    if (args.keys.length === 0 || args.keys.length > MAX_OBJECTS) {
      throw fail("invalid_input", "Choose what to move.");
    }
    return await relocate(
      ctx,
      args.organizationId,
      config,
      args.keys.map((key) => ({ from: key, to: movedKey(key, args.toFolder) })),
    );
  },
});

/** Deletes files and folders, with everything inside them, from the bucket for good. */
export const remove = action({
  args: { organizationId: v.string(), keys: v.array(v.string()) },
  returns: v.object({ removed: v.number(), leftBehind: v.number() }),
  handler: async (ctx, args): Promise<{ removed: number; leftBehind: number }> => {
    const config = await bucketOf(ctx, args.organizationId);
    const objects: string[] = [];
    for (const key of args.keys) {
      objects.push(...(await objectsOf(config, key)));
      if (objects.length > MAX_OBJECTS) {
        throw fail(
          "too_many",
          `That is more than ${MAX_OBJECTS} files at once. Delete the folders inside it one at a time.`,
        );
      }
    }
    const inUse: string[] = [];
    for (const part of chunks(objects)) {
      inUse.push(
        ...(await ctx.runQuery(internal.files.brandFilesAmong, {
          organizationId: args.organizationId,
          keys: part,
        })),
      );
    }
    if (inUse.length > 0) {
      throw fail(
        "in_use",
        `"${baseName(inUse[0])}" is your team's logo or music. Take it out of Settings first.`,
      );
    }

    const notDeleted = new Set(await eachOf(objects, (key) => deleteObject(config, key)));
    const gone = objects.filter((key) => !notDeleted.has(key));
    await keepFolders(config, args.keys);
    for (const part of chunks(gone)) {
      await ctx.runMutation(internal.files.followRecords, {
        organizationId: args.organizationId,
        moves: part.map((from) => ({ from, to: null, etag: "" })),
      });
    }
    await ctx.runMutation(internal.files.followLinks, {
      organizationId: args.organizationId,
      moves: gone.map((from) => ({ from, to: null })),
      folders: [],
    });
    return { removed: gone.length, leftBehind: notDeleted.size };
  },
});

/**
 * The details read so far for files straight inside a folder that did not come through
 * this app. Live, so each one appears on the page as the toolkit finishes reading it.
 */
export const detailsIn = query({
  args: { organizationId: v.string(), prefix: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const rows = await ctx.db
      .query("bucketFiles")
      .withIndex("by_organization_and_key", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .gte("key", args.prefix)
          .lt("key", `${args.prefix}\uffff`),
      )
      .take(2000);
    return rows
      .filter((row) => row.details && !row.key.slice(args.prefix.length).includes("/"))
      .map((row) => ({ key: row.key, details: row.details! }));
  },
});

// Internal: only reachable from the actions above.

// The most files one visit to a folder sends to the toolkit; the rest go on the next visit.
const READ_PER_VISIT = 25;
// A file the toolkit could not read is tried again after this long.
const READ_AGAIN_AFTER_MS = 60 * 60 * 1000;

/**
 * For files that did not come through this app: returns the details already read, and
 * marks the ones still to read as taken so two visits never read the same file twice.
 */
export const claimOutside = internalMutation({
  args: {
    organizationId: v.string(),
    files: v.array(v.object({ key: v.string(), etag: v.string() })),
  },
  handler: async (ctx, args) => {
    const details: Record<string, Doc<"uploads">["details"]> = {};
    const fresh: { key: string; etag: string }[] = [];
    const toolkit = await ctx.db
      .query("toolkitConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    const now = Date.now();
    for (const file of args.files) {
      const row = await ctx.db
        .query("bucketFiles")
        .withIndex("by_organization_and_key", (q) =>
          q.eq("organizationId", args.organizationId).eq("key", file.key),
        )
        .first();
      if (row && row.etag === file.etag && row.details) {
        details[file.key] = row.details;
        continue;
      }
      if (!toolkit || fresh.length >= READ_PER_VISIT) continue;
      if (row && row.etag === file.etag && now - row.askedAt < READ_AGAIN_AFTER_MS) continue;
      if (row) await ctx.db.patch(row._id, { etag: file.etag, details: undefined, askedAt: now });
      else {
        await ctx.db.insert("bucketFiles", {
          organizationId: args.organizationId,
          ...file,
          askedAt: now,
        });
      }
      fresh.push(file);
    }
    return { details, fresh };
  },
});

/** Has the toolkit read one file (it runs FFprobe) and keeps what it finds. */
export const readOutside = internalAction({
  args: { organizationId: v.string(), key: v.string(), etag: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.runQuery(internal.storage.load, {
      organizationId: args.organizationId,
    });
    const step = getStep("media-metadata");
    if (!connection || !step) return;
    try {
      const config = await bucketFor(connection);
      const answer = (await callStep(
        config,
        step,
        { media_url: await presign(config, "GET", args.key, VIEW_LINK_SECONDS) },
        { signal: AbortSignal.timeout(60_000) },
      )) as { response?: unknown } | null;
      const details = readFileDetails(answer?.response);
      if (details) await ctx.runMutation(internal.files.saveOutside, { ...args, details });
    } catch {
      // Left without details; the next visit after an hour tries again.
    }
  },
});

export const saveOutside = internalMutation({
  args: {
    organizationId: v.string(),
    key: v.string(),
    etag: v.string(),
    details: fileDetailsValidator,
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("bucketFiles")
      .withIndex("by_organization_and_key", (q) =>
        q.eq("organizationId", args.organizationId).eq("key", args.key),
      )
      .first();
    // A file moved or replaced while it was being read keeps nothing from the old read.
    if (row && row.etag === args.etag) await ctx.db.patch(row._id, { details: args.details });
  },
});

/** The upload ids the team's brand points at: its logo and its music tracks. */
async function brandUploads(
  ctx: QueryCtx,
  organizationId: string,
): Promise<Map<string, BrandFileKey>> {
  const settings = await ctx.db
    .query("teamSettings")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .first();
  const used = new Map<string, BrandFileKey>();
  const add = (value: string | undefined, as: BrandFileKey) => {
    const id = readUploadRef(value);
    if (id) used.set(id, as);
  };
  add(settings?.brand?.logo, "logo");
  add(settings?.brand?.music, "music");
  add(settings?.brand?.card, "card");
  add(settings?.brand?.intro, "intro");
  add(settings?.brand?.outro, "outro");
  for (const track of settings?.music ?? []) add(track.file, "music");
  return used;
}

/** What this app knows about the files at these keys: the upload behind each, if any. */
export const uploadsAt = internalQuery({
  args: { organizationId: v.string(), keys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const used = await brandUploads(ctx, args.organizationId);
    const known: Record<
      string,
      {
        uploadId: Id<"uploads">;
        details: Doc<"uploads">["details"] | null;
        usedAs: BrandFileKey | null;
      }
    > = {};
    for (const key of args.keys) {
      const upload = await ctx.db
        .query("uploads")
        .withIndex("by_organization_and_key", (q) =>
          q.eq("organizationId", args.organizationId).eq("key", key),
        )
        .first();
      if (!upload) continue;
      known[key] = {
        uploadId: upload._id,
        details: upload.details ?? null,
        usedAs: used.get(upload._id) ?? null,
      };
    }
    return known;
  },
});

/** The keys among these that are the team's logo or one of its music tracks. */
export const brandFilesAmong = internalQuery({
  args: { organizationId: v.string(), keys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const used = await brandUploads(ctx, args.organizationId);
    if (used.size === 0) return [];
    const wanted = new Set(args.keys);
    const found: string[] = [];
    for (const uploadId of used.keys()) {
      const id = ctx.db.normalizeId("uploads", uploadId);
      const upload = id ? await ctx.db.get(id) : null;
      if (upload && upload.organizationId === args.organizationId && wanted.has(upload.key)) {
        found.push(upload.key);
      }
    }
    return found;
  },
});

/**
 * Moves the records that name a file by its key: the upload (so "upload:<id>" pointers in
 * the brand, the music library and step settings keep working without being touched) and
 * what each watched folder has already seen (so a renamed file does not start a second
 * run). `to` is null for a deleted file, which drops its records.
 */
export const followRecords = internalMutation({
  args: {
    organizationId: v.string(),
    moves: v.array(
      v.object({ from: v.string(), to: v.union(v.null(), v.string()), etag: v.string() }),
    ),
  },
  handler: async (ctx, args) => {
    const automations = await ctx.db
      .query("automations")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(500);
    const watchers = automations.filter((automation) => automation.trigger.kind === "folder");

    for (const { from, to, etag } of args.moves) {
      const uploads = await ctx.db
        .query("uploads")
        .withIndex("by_organization_and_key", (q) =>
          q.eq("organizationId", args.organizationId).eq("key", from),
        )
        .take(10);
      for (const upload of uploads) {
        if (to === null) await ctx.db.delete(upload._id);
        else {
          const renamed = baseName(to) !== baseName(from);
          await ctx.db.patch(upload._id, {
            key: to,
            ...(renamed ? { fileName: baseName(to) } : {}),
          });
        }
      }

      // Details read for a file that did not come through this app go with it.
      const read = await ctx.db
        .query("bucketFiles")
        .withIndex("by_organization_and_key", (q) =>
          q.eq("organizationId", args.organizationId).eq("key", from),
        )
        .take(10);
      for (const row of read) {
        if (to === null) await ctx.db.delete(row._id);
        else await ctx.db.patch(row._id, { key: to, etag: etag || row.etag });
      }

      for (const watcher of watchers) {
        const seen = await ctx.db
          .query("watchedFiles")
          .withIndex("by_automation_and_key", (q) =>
            q.eq("automationId", watcher._id).eq("key", from),
          )
          .first();
        if (!seen) continue;
        await ctx.db.delete(seen._id);
        if (to === null) continue;
        const already = await ctx.db
          .query("watchedFiles")
          .withIndex("by_automation_and_key", (q) =>
            q.eq("automationId", watcher._id).eq("key", to),
          )
          .first();
        if (!already) {
          await ctx.db.insert("watchedFiles", { automationId: watcher._id, key: to, etag });
        }
      }
    }
  },
});

// How far back links are followed. Older jobs keep the link they finished with.
const RECENT_JOBS = 300;
const RECENT_RUNS = 200;
const RECENT_STEPS = 2000;
const RECENT_REVIEWS = 100;

/**
 * Moves the plain links that name a file by its address: the outputs of recent jobs and
 * run steps (what the Outputs page and a run show), the clips in recent review rooms, a
 * brand file kept as an address, and
 * the folder a watched-folder automation looks in. A link to a deleted file leaves the
 * outputs. Only links to this bucket at its own address are followed; a signed link, or
 * one through an address the storage settings do not name, cannot be told apart from any
 * other address. A public address (the toolkit's S3_PUBLIC_URL) is followed once it is set.
 */
export const followLinks = internalMutation({
  args: {
    organizationId: v.string(),
    moves: v.array(v.object({ from: v.string(), to: v.union(v.null(), v.string()) })),
    folders: v.array(v.object({ from: v.string(), to: v.string() })),
  },
  handler: async (ctx, args) => {
    const connection = await storageConnection(ctx, args.organizationId);
    if (!connection?.storage?.endpoint) return;
    const storage = {
      endpoint: connection.storage.endpoint,
      bucket: connection.storage.bucket,
      ...(connection.storage.publicUrl ? { publicUrl: connection.storage.publicUrl } : {}),
      root: teamFolder(args.organizationId),
    };
    const moved = new Map(args.moves.map(({ from, to }) => [from, to]));

    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(RECENT_JOBS);
    for (const job of jobs) {
      const outputs = followMoves(storage, job.outputs, moved);
      const result = followMoves(storage, job.result, moved);
      if (outputs !== job.outputs || result !== job.result) {
        await ctx.db.patch(job._id, { outputs, ...(result !== job.result ? { result } : {}) });
      }
    }

    // By run, newest first: run steps listed by status would put the finished ones, which
    // hold the files, behind every step still waiting or skipped.
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(RECENT_RUNS);
    let stepsSeen = 0;
    for (const run of runs) {
      if (stepsSeen >= RECENT_STEPS) break;
      // The file that started the run, so running it again finds the file.
      const trigger = followMoves(storage, run.trigger, moved);
      if (trigger !== run.trigger) await ctx.db.patch(run._id, { trigger });
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .take(200);
      stepsSeen += steps.length;
      for (const step of steps) {
        const outputs = followMoves(storage, step.outputs, moved);
        const branches = step.branches && followMoves(storage, step.branches, moved);
        if (outputs !== step.outputs || branches !== step.branches) {
          await ctx.db.patch(step._id, { outputs, ...(branches ? { branches } : {}) });
        }
      }
    }

    // Review rooms play each version of a clip from its link. A deleted file's version
    // stays, so the comments made on it keep their place.
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(RECENT_REVIEWS);
    for (const review of reviews) {
      const clips = await ctx.db
        .query("reviewClips")
        .withIndex("by_review", (q) => q.eq("reviewId", review._id))
        .take(100);
      for (const clip of clips) {
        let changed = false;
        const versions = clip.versions.map((version) => {
          const url = followMoves(storage, version.url, moved);
          if (url === version.url) return version;
          changed = true;
          return { ...version, url };
        });
        if (changed) await ctx.db.patch(clip._id, { versions });
      }
    }

    const settings = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    if (settings) {
      // Never a list here, so a deleted file's address is left for Settings to show.
      const brand = settings.brand && followMoves(storage, { ...settings.brand }, moved);
      const music = settings.music?.map((track) => followMoves(storage, track, moved));
      await ctx.db.patch(settings._id, {
        ...(brand ? { brand } : {}),
        ...(music ? { music } : {}),
      });
    }

    if (args.folders.length > 0) {
      const automations = await ctx.db
        .query("automations")
        .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
        .take(500);
      for (const automation of automations) {
        if (automation.trigger.kind !== "folder") continue;
        const prefix = followFolder(automation.trigger.prefix, args.folders);
        if (prefix !== automation.trigger.prefix) {
          await ctx.db.patch(automation._id, { trigger: { ...automation.trigger, prefix } });
        }
      }
    }
  },
});

// ---------------------------------------------------------------------------------------
// The team's folder. Many teams can share one toolkit, and so one bucket, so each team
// works inside "teams/<id>/" (see lib/bucket.ts).

/**
 * Makes the team's folder, so Files shows it right away, and brings in what this app put
 * in the bucket before teams had folders: every upload the team made, which used to sit
 * at its key from the top of the bucket. Their records keep the same key, which now reads
 * from inside the team's folder. Runs when a toolkit is connected; safe to run again.
 */
export const settleTeamFolder = internalAction({
  args: { organizationId: v.string() },
  returns: v.object({ moved: v.number(), leftBehind: v.number() }),
  handler: async (ctx, args): Promise<{ moved: number; leftBehind: number }> => {
    const connection = await ctx.runQuery(internal.storage.load, {
      organizationId: args.organizationId,
    });
    if (!connection) return { moved: 0, leftBehind: 0 };
    const config = await bucketFor(connection);
    if (!(await keyExists(config, ""))) await putFolder(config, "");

    // The whole bucket, for reaching the old places outside the team's folder.
    const whole: Bucket = { ...config, root: "" };
    const keys: string[] = await ctx.runQuery(internal.files.uploadKeys, {
      organizationId: args.organizationId,
    });
    let moved = 0;
    const leftBehind = await eachOf(keys, async (key) => {
      if (await keyExists(config, key)) return;
      if (!(await keyExists(whole, key))) return;
      await copyObject(whole, key, `${config.root}${key}`);
      await deleteObject(whole, key);
      moved++;
    });
    return { moved, leftBehind: leftBehind.length };
  },
});

/** Every file key the team's uploads point at (what `settleTeamFolder` brings in). */
export const uploadKeys = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const uploads = await ctx.db
      .query("uploads")
      .withIndex("by_organization_and_key", (q) => q.eq("organizationId", args.organizationId))
      .take(MAX_OBJECTS);
    return [...new Set(uploads.map((upload) => upload.key))].filter(
      (key) => key && !isFolderKey(key),
    );
  },
});

/** Where a finished run's files are kept in the team's folder. */
export const FINISHED_FOLDER = "Finished/";

/** "clip.mp4" gives ".mp4"; a name without one gives "". */
function endingOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * The toolkit saves what it makes at the top of its bucket, outside every team's folder.
 * When a run finishes, its finished files are copied into the team's folder, under
 * Finished/<automation>/, with readable names, so they show in Files. The run keeps its
 * own links, so nothing that already points at a file changes.
 */
export const keepFinished = internalAction({
  args: { runId: v.id("runs") },
  returns: v.array(v.string()),
  handler: async (ctx, args): Promise<string[]> => {
    const found: {
      organizationId: string;
      automationName: string;
      files: { link: string; name: string }[];
    } | null = await ctx.runQuery(internal.files.finishedOfRun, { runId: args.runId });
    if (!found || found.files.length === 0) return [];
    const connection = await ctx.runQuery(internal.storage.load, {
      organizationId: found.organizationId,
    });
    if (!connection?.storage?.endpoint) return [];
    const config = await bucketFor(connection);
    const whole: Bucket = { ...config, root: "" };
    const address = {
      endpoint: connection.storage.endpoint,
      bucket: connection.storage.bucket,
      ...(connection.storage.publicUrl ? { publicUrl: connection.storage.publicUrl } : {}),
    };
    const folderName = (found.automationName.trim() || "Automation").replace(/[/\\]/g, "-");
    const folder = `${FINISHED_FOLDER}${nameProblem(folderName) ? "Automation" : folderName}/`;
    const taken = new Set(
      (await listObjects(config, folder, 1)).map((object) => object.key.slice(folder.length)),
    );
    const kept: string[] = [];
    for (const file of found.files) {
      const from = keyOfUrl(address, file.link);
      // Already in a team's folder (or not in this bucket at all): nothing to copy.
      if (from === null || from.startsWith("teams/")) continue;
      const ending = endingOf(from);
      const wanted = file.name.toLowerCase().endsWith(ending) ? file.name : `${file.name}${ending}`;
      const name = freeName(wanted.replace(/[/\\]/g, "-"), (candidate) => taken.has(candidate));
      taken.add(name);
      try {
        await copyObject(whole, from, `${config.root}${folder}${name}`);
        kept.push(`${folder}${name}`);
      } catch {
        // Left where the toolkit put it; the run still links to it there.
      }
    }
    return kept;
  },
});

/** A finished run's last files with their readable names, for `keepFinished`. */
export const finishedOfRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "done") return null;
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .take(200);
    const names = outputNamesOf(run, steps);
    return {
      organizationId: run.organizationId,
      automationName: run.automationName,
      files: finishedFiles(run, steps).map((link) => ({
        link,
        name: names[link] ?? fileNameOfLink(link),
      })),
    };
  },
});
