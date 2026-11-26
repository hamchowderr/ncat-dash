import {
  MAX_FILE_BYTES,
  MAX_FILE_TEXT,
  MAX_PARTS,
  planParts,
  readFileDetails,
  readUploadRef,
  uploadKind,
  type PartsPlan,
} from "@takewon/automation-core";
import { callStep, getStep } from "@takewon/step-catalog";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  internalAction,
  type ActionCtx,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { MANAGER_ROLES, requireMember } from "./lib/authz";
import {
  abortParts,
  BucketError,
  bucketOf,
  completeParts,
  presign,
  safeName,
  signParts,
  startPartsUpload,
  storageConnection,
  type Bucket,
} from "./lib/bucket";
import { addUploadToLibrary, deleteLibraryItem } from "./lib/library";
import { fileDetailsValidator } from "./schema";

const UPLOAD_LINK_SECONDS = 60 * 60;
// The longest a signed link may live (SigV4 limit). Long enough for a job to fetch it.
const READ_LINK_SECONDS = 7 * 24 * 60 * 60;
// Parts are signed in batches as the browser goes, so links never sit unused for long.
const MAX_PARTS_PER_SIGN = 100;
// Previews on the Uploads page: long enough for a working session, then asked for again.
const PREVIEW_LINK_SECONDS = 6 * 60 * 60;
const MAX_PREVIEW_LINKS = 25;

const NO_STORAGE = "Connect your toolkit first, so there is somewhere for your files to go.";

/** What the browser needs to send a new upload: one link, or the plan for sending it in parts. */
export const sendPlanValidator = {
  uploadUrl: v.union(v.null(), v.string()),
  parts: v.union(v.null(), v.object({ partSize: v.number(), partCount: v.number() })),
};

/** Refuses a size the bucket cannot take. */
export function checkUploadSize(size: number) {
  if (!(size > 0) || size > MAX_FILE_BYTES) {
    throw new ConvexError({ code: "too_large", message: `Files can be up to ${MAX_FILE_TEXT}.` });
  }
}

/**
 * Gets a new upload ready to send: a PUT link for a small file, or an upload in parts for a
 * big one (its parts are signed later, a batch at a time).
 */
export async function prepareSend(
  bucket: Bucket,
  key: string,
  size: number,
  contentType: string,
): Promise<{ uploadUrl: string | null; parts: PartsPlan | null; partsUploadId: string | null }> {
  const parts = planParts(size);
  if (!parts) {
    return {
      uploadUrl: await presign(bucket, "PUT", key, UPLOAD_LINK_SECONDS),
      parts,
      partsUploadId: null,
    };
  }
  return {
    uploadUrl: null,
    parts,
    partsUploadId: await startPartsUpload(bucket, key, contentType),
  };
}

/**
 * The team's bucket, as its toolkit reports it. Null until a toolkit is connected: files
 * go to the toolkit's own bucket, so there is nothing else to set up.
 */
export const get = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const connection = await storageConnection(ctx, args.organizationId);
    if (!connection?.storage) return null;
    return {
      bucket: connection.storage.bucket,
      publicUrl: connection.storage.publicUrl,
      baseUrl: connection.baseUrl,
    };
  },
});

/**
 * Starts an upload: records the file and returns a one-time link the browser sends the
 * bytes to. The file never passes through this app's servers.
 */
export const startUpload = action({
  args: {
    organizationId: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    // "brand" for a logo or music track: kept for steps to use, never starts an automation.
    purpose: v.optional(v.literal("brand")),
    // Automations that run on every upload, unticked for this one in "On this upload".
    skipAutomations: v.optional(v.array(v.id("automations"))),
  },
  returns: v.object({ uploadId: v.id("uploads"), ...sendPlanValidator }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    uploadId: Doc<"uploads">["_id"];
    uploadUrl: string | null;
    parts: PartsPlan | null;
  }> => {
    const { userId } = await ctx.runQuery(internal.storage.authorize, {
      organizationId: args.organizationId,
      managersOnly: false,
    });
    checkUploadSize(args.size);
    const storage = await ctx.runQuery(internal.storage.load, {
      organizationId: args.organizationId,
    });
    if (!storage) throw new ConvexError({ code: "no_storage", message: NO_STORAGE });
    // Inside the team's own folder, like every key (see lib/bucket.ts).
    const key = `uploads/${crypto.randomUUID()}/${safeName(args.fileName)}`;
    const contentType = args.contentType || "application/octet-stream";
    const plan = await prepareSend(await bucketOf(storage), key, args.size, contentType);
    const uploadId = await ctx.runMutation(internal.storage.recordUpload, {
      organizationId: args.organizationId,
      key,
      fileName: args.fileName.slice(0, 200),
      contentType,
      size: args.size,
      createdBy: userId,
      ...(args.purpose ? { purpose: args.purpose } : {}),
      ...(plan.partsUploadId ? { partsUploadId: plan.partsUploadId } : {}),
      ...(args.skipAutomations?.length
        ? { skipAutomations: args.skipAutomations.slice(0, 100) }
        : {}),
    });
    return { uploadId, uploadUrl: plan.uploadUrl, parts: plan.parts };
  },
});

/** The upload in parts behind an upload the caller's team is still sending. */
async function partsUploadOf(ctx: ActionCtx, uploadId: Doc<"uploads">["_id"]) {
  const upload = await ctx.runQuery(internal.storage.loadUpload, { uploadId });
  if (upload.status !== "uploading" || !upload.partsUploadId) {
    throw new ConvexError({
      code: "not_uploading",
      message: "This file is not being sent in parts.",
    });
  }
  const storage = await ctx.runQuery(internal.storage.load, {
    organizationId: upload.organizationId,
  });
  if (!storage) throw new ConvexError({ code: "no_storage", message: NO_STORAGE });
  return { upload, partsUploadId: upload.partsUploadId, bucket: await bucketOf(storage) };
}

/** PUT links for the next parts of a file being sent in parts. */
export const signUploadParts = action({
  args: { uploadId: v.id("uploads"), partNumbers: v.array(v.number()) },
  returns: v.array(v.object({ partNumber: v.number(), url: v.string() })),
  handler: async (ctx, args): Promise<{ partNumber: number; url: string }[]> => {
    if (args.partNumbers.length === 0 || args.partNumbers.length > MAX_PARTS_PER_SIGN) {
      throw new ConvexError({
        code: "invalid_input",
        message: `Ask for 1 to ${MAX_PARTS_PER_SIGN} parts at a time.`,
      });
    }
    const { upload, partsUploadId, bucket } = await partsUploadOf(ctx, args.uploadId);
    const plan = planParts(upload.size);
    const most = Math.min(plan?.partCount ?? 0, MAX_PARTS);
    for (const number of args.partNumbers) {
      if (!Number.isInteger(number) || number < 1 || number > most) {
        throw new ConvexError({
          code: "invalid_input",
          message: `This file has parts 1 to ${most}.`,
        });
      }
    }
    return await signParts(
      bucket,
      upload.key,
      partsUploadId,
      args.partNumbers,
      UPLOAD_LINK_SECONDS,
    );
  },
});

/** Joins the parts the browser sent into the file. Then `finishUpload` marks it ready. */
export const completeUploadParts = action({
  args: {
    uploadId: v.id("uploads"),
    parts: v.array(v.object({ partNumber: v.number(), etag: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { upload, partsUploadId, bucket } = await partsUploadOf(ctx, args.uploadId);
    const plan = planParts(upload.size);
    const numbers = new Set(args.parts.map((part) => part.partNumber));
    if (!plan || args.parts.length !== plan.partCount || numbers.size !== plan.partCount) {
      throw new ConvexError({
        code: "invalid_input",
        message: "Every part has to be sent before the file can be put together.",
      });
    }
    await completeParts(bucket, upload.key, partsUploadId, args.parts);
    await ctx.runMutation(internal.storage.partsJoined, { uploadId: args.uploadId });
    return null;
  },
});

/** Stops sending a file: drops the parts already sent and the upload's record. */
export const cancelUpload = action({
  args: { uploadId: v.id("uploads") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const upload = await ctx.runQuery(internal.storage.loadUpload, { uploadId: args.uploadId });
    if (upload.status !== "uploading") return null;
    if (upload.partsUploadId) {
      const storage = await ctx.runQuery(internal.storage.load, {
        organizationId: upload.organizationId,
      });
      if (storage) {
        try {
          await abortParts(await bucketOf(storage), upload.key, upload.partsUploadId);
        } catch {
          // The bucket drops unfinished parts on its own in time; the record still goes.
        }
      }
    }
    await ctx.runMutation(internal.storage.dropUnfinished, { uploadId: args.uploadId });
    return null;
  },
});

export const partsJoined = internalMutation({
  args: { uploadId: v.id("uploads") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.uploadId, { partsUploadId: undefined });
  },
});

export const dropUnfinished = internalMutation({
  args: { uploadId: v.id("uploads") },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (upload?.status === "uploading") await ctx.db.delete(args.uploadId);
  },
});

/** Marks an upload as finished once the browser has sent every byte. */
export const finishUpload = mutation({
  args: { uploadId: v.id("uploads") },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload) return;
    await requireMember(ctx, upload.organizationId);
    if (upload.status === "ready") return;
    if (upload.partsUploadId) {
      // Sent in parts: the parts must be put together (completeUploadParts) first.
      throw new ConvexError({
        code: "not_joined",
        message: "The file's parts are not put together yet.",
      });
    }
    await ctx.db.patch(args.uploadId, { status: "ready" });
    // Every file someone brings in joins the content library, with its short ID.
    await addUploadToLibrary(ctx, { ...upload, status: "ready" });
    // Reads the file's details, then starts any automation set to run on an upload.
    await ctx.scheduler.runAfter(0, internal.storage.readDetails, { uploadId: args.uploadId });
  },
});

/** Removes the record of an upload. The file itself stays in the team's bucket. */
export const removeUpload = mutation({
  args: { uploadId: v.id("uploads") },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload) return;
    await requireMember(ctx, upload.organizationId);
    const item = await ctx.db
      .query("libraryItems")
      .withIndex("by_upload", (q) => q.eq("uploadId", args.uploadId))
      .first();
    if (item) await deleteLibraryItem(ctx, item._id);
    await ctx.db.delete(args.uploadId);
  },
});

export const listUploads = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const uploads = await ctx.db
      .query("uploads")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(100);
    // Each one's place in the library, where its transcript, SRT and VTT are read.
    const items = await Promise.all(
      uploads.map((upload) =>
        ctx.db
          .query("libraryItems")
          .withIndex("by_upload", (q) => q.eq("uploadId", upload._id))
          .first(),
      ),
    );
    return uploads.map((upload, index) => ({
      _id: upload._id,
      _creationTime: upload._creationTime,
      fileName: upload.fileName,
      // Where it is in the team's storage, for deleting it from there.
      key: upload.key,
      contentType: upload.contentType,
      size: upload.size,
      status: upload.status,
      purpose: upload.purpose ?? null,
      source: upload.source ?? null,
      sourceUrl: upload.sourceUrl ?? null,
      sharedBy: upload.sharedBy ?? null,
      details: upload.details ?? null,
      libraryItemId: items[index]?._id ?? null,
      transcript: items[index]?.transcript?.status ?? null,
    }));
  },
});

/**
 * The names of some of the team's uploads, for showing the files settings point at. An
 * upload that was removed, or never finished, comes back with no name.
 */
export const uploadNames = query({
  args: { organizationId: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const names: { id: string; fileName: string | null }[] = [];
    for (const raw of args.ids.slice(0, 100)) {
      const id = ctx.db.normalizeId("uploads", raw);
      const upload = id ? await ctx.db.get(id) : null;
      const there =
        upload && upload.organizationId === args.organizationId && upload.status === "ready";
      names.push({ id: raw, fileName: there ? upload.fileName : null });
    }
    return names;
  },
});

/** A link the toolkit can fetch the file from, good for seven days. */
export const linkFor = action({
  args: { uploadId: v.id("uploads") },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const upload = await ctx.runQuery(internal.storage.loadUpload, { uploadId: args.uploadId });
    const storage = await ctx.runQuery(internal.storage.load, {
      organizationId: upload.organizationId,
    });
    if (!storage) throw new ConvexError({ code: "no_storage", message: NO_STORAGE });
    try {
      return await presign(await bucketOf(storage), "GET", upload.key, READ_LINK_SECONDS);
    } catch (error) {
      // The link is made by the toolkit, so a toolkit that is down stops a run here. Say so.
      if (error instanceof BucketError) {
        throw new ConvexError({ code: "toolkit", message: error.message });
      }
      throw error;
    }
  },
});

/**
 * Links the Uploads page plays and shows files from, for the uploads on screen. Only finished
 * videos, sounds and pictures of the caller's own team get one; anything else is left out.
 */
export const previewLinks = action({
  args: { organizationId: v.string(), uploadIds: v.array(v.id("uploads")) },
  returns: v.array(v.object({ uploadId: v.id("uploads"), url: v.string() })),
  handler: async (ctx, args): Promise<{ uploadId: Doc<"uploads">["_id"]; url: string }[]> => {
    if (args.uploadIds.length > MAX_PREVIEW_LINKS) {
      throw new ConvexError({
        code: "too_many",
        message: `Ask for up to ${MAX_PREVIEW_LINKS} previews at a time.`,
      });
    }
    const targets = await ctx.runQuery(internal.storage.previewTargets, args);
    if (targets.length === 0) return [];
    const storage = await ctx.runQuery(internal.storage.load, {
      organizationId: args.organizationId,
    });
    if (!storage) return [];
    const bucket = await bucketOf(storage);
    const links = await Promise.all(
      targets.map(async (target) => {
        try {
          return {
            uploadId: target.uploadId,
            url: await presign(bucket, "GET", target.key, PREVIEW_LINK_SECONDS),
          };
        } catch {
          // One file the toolkit cannot sign should not keep the others from showing.
          return null;
        }
      }),
    );
    return links.filter((link) => link !== null);
  },
});

/** The keys behind the uploads asked for, once the caller is checked as a team member. */
export const previewTargets = internalQuery({
  args: { organizationId: v.string(), uploadIds: v.array(v.id("uploads")) },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const targets: { uploadId: Doc<"uploads">["_id"]; key: string }[] = [];
    for (const uploadId of new Set(args.uploadIds)) {
      const upload = await ctx.db.get(uploadId);
      if (!upload || upload.organizationId !== args.organizationId) continue;
      if (upload.status !== "ready") continue;
      if (uploadKind(upload.contentType, upload.details) === "other") continue;
      targets.push({ uploadId, key: upload.key });
    }
    return targets;
  },
});

// Internal: only reachable from the actions above.

export const authorize = internalQuery({
  args: { organizationId: v.string(), managersOnly: v.boolean() },
  handler: async (ctx, args) => {
    return await requireMember(
      ctx,
      args.organizationId,
      args.managersOnly ? MANAGER_ROLES : undefined,
    );
  },
});

/** The toolkit connection the team's files go through, or null. */
export const load = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    return await storageConnection(ctx, args.organizationId);
  },
});

export const loadUpload = internalQuery({
  args: { uploadId: v.id("uploads") },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload) throw new ConvexError({ code: "not_found", message: "Upload not found." });
    await requireMember(ctx, upload.organizationId);
    return upload;
  },
});

/** What `readDetails` needs: the upload and the toolkit that keeps it and reads it. */
export const loadForDetails = internalQuery({
  args: { uploadId: v.id("uploads") },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload || upload.status !== "ready") return null;
    return { upload, connection: await storageConnection(ctx, upload.organizationId) };
  },
});

export const saveDetails = internalMutation({
  args: { uploadId: v.id("uploads"), details: fileDetailsValidator },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload) return;
    await ctx.db.patch(args.uploadId, {
      details: args.details,
      // A video from a link comes in before its size is known.
      ...(upload.size === 0 && args.details.filesize ? { size: args.details.filesize } : {}),
    });
    // The library's copy goes with it, and the details may say better what kind it is.
    const item = await ctx.db
      .query("libraryItems")
      .withIndex("by_upload", (q) => q.eq("uploadId", args.uploadId))
      .first();
    if (item) {
      await ctx.db.patch(item._id, {
        details: args.details,
        kind: uploadKind(upload.contentType, args.details),
      });
    }
  },
});

/**
 * Has the toolkit read a finished upload (length, picture size, sound, format) and keeps
 * what it finds with the upload. Then starts the automations waiting for an upload, so a
 * run begins with the details in hand. A file the toolkit cannot read still starts them.
 */
export const readDetails = internalAction({
  args: { uploadId: v.id("uploads") },
  handler: async (ctx, args) => {
    const found = await ctx.runQuery(internal.storage.loadForDetails, args);
    if (!found) return;
    const { upload, connection } = found;
    const step = getStep("media-metadata");
    try {
      if (connection && step) {
        const bucket = await bucketOf(connection);
        const answer = (await callStep(
          bucket,
          step,
          { media_url: await presign(bucket, "GET", upload.key, READ_LINK_SECONDS) },
          { signal: AbortSignal.timeout(60_000) },
        )) as { response?: unknown } | null;
        const details = readFileDetails(answer?.response);
        if (details) await ctx.runMutation(internal.storage.saveDetails, { ...args, details });
      }
    } catch {
      // Details are a help, not a need: the upload is fine without them.
    }
    // A video brought in from a link to copy its look is studied now.
    if (upload.source === "link") {
      await ctx.runMutation(internal.links.detailsRead, { uploadId: upload._id });
    }
    // A logo or music track is kept for steps to use, and a page recording is material for
    // an edit: neither starts an automation.
    if (!upload.purpose) {
      await ctx.runAction(internal.automations.uploadFinished, args);
    }
  },
});

/** An upload by id for a job being sent, checked against the team that owns the job. */
export const uploadForTeam = internalQuery({
  args: { uploadId: v.string(), organizationId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("uploads", args.uploadId);
    const upload = id ? await ctx.db.get(id) : null;
    if (!upload || upload.organizationId !== args.organizationId) return null;
    return { key: upload.key };
  },
});

export class UploadLinkError extends Error {}

/**
 * Swaps every "upload:<id>" pointer inside a job's input for a fresh link the toolkit can
 * fetch. Settings keep the pointer, because a signed link stops working after a week.
 */
export async function withUploadLinks(
  ctx: ActionCtx,
  organizationId: string,
  input: unknown,
): Promise<unknown> {
  const ids = new Set<string>();
  const find = (value: unknown) => {
    const id = readUploadRef(value);
    if (id) ids.add(id);
    else if (Array.isArray(value)) value.forEach(find);
    else if (value && typeof value === "object") Object.values(value).forEach(find);
  };
  find(input);
  if (ids.size === 0) return input;

  const storage = await ctx.runQuery(internal.storage.load, { organizationId });
  if (!storage) throw new UploadLinkError(NO_STORAGE);
  const config = await bucketOf(storage);
  const links = new Map<string, string>();
  for (const uploadId of ids) {
    const upload = await ctx.runQuery(internal.storage.uploadForTeam, { uploadId, organizationId });
    if (!upload) {
      throw new UploadLinkError("A file this step uses is no longer in your uploads.");
    }
    links.set(uploadId, await presign(config, "GET", upload.key, READ_LINK_SECONDS));
  }
  const swap = (value: unknown): unknown => {
    const id = readUploadRef(value);
    if (id) return links.get(id);
    if (Array.isArray(value)) return value.map(swap);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, swap(item)]));
    }
    return value;
  };
  return swap(input);
}

export const recordUpload = internalMutation({
  args: {
    organizationId: v.string(),
    key: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    createdBy: v.string(),
    purpose: v.optional(v.literal("brand")),
    partsUploadId: v.optional(v.string()),
    skipAutomations: v.optional(v.array(v.id("automations"))),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("uploads", { ...args, status: "uploading" });
  },
});

/**
 * Deletes the bucket settings teams used to enter here (storage keys included), now that
 * files go through the toolkit. Run once per deployment:
 * `npx convex run storage:forgetOldStorageSettings`. The table is no longer in the schema,
 * so it is reached by name.
 */
export const forgetOldStorageSettings = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const db = ctx.db as unknown as {
      query: (table: string) => { take: (n: number) => Promise<{ _id: string }[]> };
      delete: (id: string) => Promise<void>;
    };
    const rows = await db.query("storageConnections").take(500);
    for (const row of rows) await db.delete(row._id);
    return rows.length;
  },
});
