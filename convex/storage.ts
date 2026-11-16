import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { MANAGER_ROLES, requireMember } from "./lib/authz";
import { decryptSecret, encryptSecret } from "./lib/crypto";
import { type BucketConfig, checkBucket, presign } from "./lib/s3";

const UPLOAD_LINK_SECONDS = 60 * 60;
// The longest a presigned link may live (SigV4 limit). Long enough for a job to fetch it.
const READ_LINK_SECONDS = 7 * 24 * 60 * 60;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

async function toBucketConfig(storage: Doc<"storageConnections">): Promise<BucketConfig> {
  return {
    endpoint: storage.endpoint,
    region: storage.region,
    bucket: storage.bucket,
    accessKeyId: storage.accessKeyId,
    secretAccessKey: await decryptSecret(storage.secretCipher),
  };
}

function safeName(fileName: string): string {
  const cleaned = fileName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "");
  return cleaned.slice(-120) || "file";
}

/** The team's bucket settings, without the secret. Null when none is set up. */
export const get = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const storage = await ctx.db
      .query("storageConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    if (!storage) return null;
    return {
      endpoint: storage.endpoint,
      region: storage.region,
      bucket: storage.bucket,
      accessKeyHint: storage.accessKeyId.slice(-4),
    };
  },
});

/** Tests the bucket settings and saves them when the test passes. */
export const connect = action({
  args: {
    organizationId: v.string(),
    endpoint: v.string(),
    region: v.string(),
    bucket: v.string(),
    accessKeyId: v.string(),
    secretAccessKey: v.string(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({ ok: v.literal(false), detail: v.string() }),
  ),
  handler: async (ctx, args) => {
    const { userId } = await ctx.runQuery(internal.storage.authorize, {
      organizationId: args.organizationId,
      managersOnly: true,
    });

    let endpoint: string;
    try {
      const url = new URL(args.endpoint.trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
      endpoint = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    } catch {
      return { ok: false as const, detail: "Enter the storage address, starting with https://" };
    }
    const config: BucketConfig = {
      endpoint,
      region: args.region.trim() || "auto",
      bucket: args.bucket.trim(),
      accessKeyId: args.accessKeyId.trim(),
      secretAccessKey: args.secretAccessKey.trim(),
    };
    if (!config.bucket || !config.accessKeyId || !config.secretAccessKey) {
      return { ok: false as const, detail: "Fill in the bucket name and both keys." };
    }

    const check = await checkBucket(config);
    if (!check.ok) return check;

    await ctx.runMutation(internal.storage.save, {
      organizationId: args.organizationId,
      endpoint: config.endpoint,
      region: config.region,
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      secretCipher: await encryptSecret(config.secretAccessKey),
      createdBy: userId,
    });
    return { ok: true as const };
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
  },
  returns: v.object({ uploadId: v.id("uploads"), uploadUrl: v.string() }),
  handler: async (ctx, args): Promise<{ uploadId: Doc<"uploads">["_id"]; uploadUrl: string }> => {
    const { userId } = await ctx.runQuery(internal.storage.authorize, {
      organizationId: args.organizationId,
      managersOnly: false,
    });
    if (args.size <= 0 || args.size > MAX_UPLOAD_BYTES) {
      throw new ConvexError({ code: "too_large", message: "Files can be up to 5 GB." });
    }
    const storage = await ctx.runQuery(internal.storage.load, {
      organizationId: args.organizationId,
    });
    if (!storage) {
      throw new ConvexError({ code: "no_storage", message: "Connect your storage first." });
    }
    const key = `uploads/${args.organizationId}/${crypto.randomUUID()}/${safeName(args.fileName)}`;
    const uploadUrl = await presign(await toBucketConfig(storage), "PUT", key, UPLOAD_LINK_SECONDS);
    const uploadId = await ctx.runMutation(internal.storage.recordUpload, {
      organizationId: args.organizationId,
      key,
      fileName: args.fileName.slice(0, 200),
      contentType: args.contentType || "application/octet-stream",
      size: args.size,
      createdBy: userId,
    });
    return { uploadId, uploadUrl };
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
    await ctx.db.patch(args.uploadId, { status: "ready" });
    // Starts any automation set to run when a file is uploaded.
    await ctx.scheduler.runAfter(0, internal.automations.uploadFinished, {
      uploadId: args.uploadId,
    });
  },
});

/** Removes the record of an upload. The file itself stays in the team's bucket. */
export const removeUpload = mutation({
  args: { uploadId: v.id("uploads") },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload) return;
    await requireMember(ctx, upload.organizationId);
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
    return uploads.map((upload) => ({
      _id: upload._id,
      _creationTime: upload._creationTime,
      fileName: upload.fileName,
      contentType: upload.contentType,
      size: upload.size,
      status: upload.status,
    }));
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
    if (!storage) {
      throw new ConvexError({ code: "no_storage", message: "Connect your storage first." });
    }
    return await presign(await toBucketConfig(storage), "GET", upload.key, READ_LINK_SECONDS);
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

export const load = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("storageConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
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

export const save = internalMutation({
  args: {
    organizationId: v.string(),
    endpoint: v.string(),
    region: v.string(),
    bucket: v.string(),
    accessKeyId: v.string(),
    secretCipher: v.string(),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("storageConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    if (existing) await ctx.db.replace(existing._id, args);
    else await ctx.db.insert("storageConnections", args);
  },
});

export const recordUpload = internalMutation({
  args: {
    organizationId: v.string(),
    key: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("uploads", { ...args, status: "uploading" });
  },
});
