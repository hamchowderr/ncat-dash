import { testConnection } from "@ncat-dash/step-catalog";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { MANAGER_ROLES, requireMember } from "./lib/authz";
import { checkStorage } from "./lib/bucket";
import { decryptSecret, encryptSecret } from "./lib/crypto";

const testResult = v.union(
  v.object({ ok: v.literal(true), buildNumber: v.union(v.null(), v.string()) }),
  v.object({
    ok: v.literal(false),
    reason: v.union(
      v.literal("invalid_url"),
      v.literal("unreachable"),
      v.literal("unauthorized"),
      v.literal("not_a_toolkit"),
      // Stephen's original toolkit: it has no storage requests, so the dashboard cannot use it.
      v.literal("not_fork"),
      // The toolkit answers but its own bucket does not.
      v.literal("storage"),
    ),
    detail: v.string(),
  }),
);

const CHECK_FAILURES = {
  unreachable: "The toolkit did not answer at this address.",
  unauthorized: "The toolkit no longer accepts the saved key.",
  not_a_toolkit: "This address no longer answers like the NCA Toolkit.",
} as const;

const storageInfo = v.object({
  bucket: v.string(),
  endpoint: v.union(v.null(), v.string()),
  publicUrl: v.union(v.null(), v.string()),
});

/** The toolkit's own test, then its storage: a toolkit is only usable with both. */
async function checkToolkit(target: { baseUrl: string; apiKey: string }) {
  const result = await testConnection(target, { signal: AbortSignal.timeout(15_000) });
  if (!result.ok) return { result, storage: null };
  const storage = await checkStorage(target);
  if (!storage.ok) {
    return {
      result: { ok: false as const, reason: storage.reason, detail: storage.detail },
      storage: null,
    };
  }
  const { bucket, endpoint, publicUrl } = storage;
  return { result, storage: { bucket, endpoint, publicUrl } };
}

/** What the browser may see: everything except the encrypted key. */
function toPublic(connection: Doc<"toolkitConnections">) {
  return {
    _id: connection._id,
    baseUrl: connection.baseUrl,
    apiKeyHint: connection.apiKeyHint,
    status: connection.status,
    buildNumber: connection.buildNumber,
    bucket: connection.storage?.bucket ?? null,
    lastCheckedAt: connection.lastCheckedAt,
    lastError: connection.lastError,
  };
}

function normaliseBaseUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/** A team's toolkit connections, for any member. */
export const list = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const connections = await ctx.db
      .query("toolkitConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(50);
    return connections.map(toPublic);
  },
});

/**
 * Tests a toolkit URL and key and, when the test passes, saves the connection with the
 * key encrypted. A failed test saves nothing and says what went wrong.
 */
export const connect = action({
  args: { organizationId: v.string(), baseUrl: v.string(), apiKey: v.string() },
  returns: testResult,
  handler: async (ctx, args) => {
    const { userId } = await ctx.runQuery(internal.toolkitConnections.authorize, {
      organizationId: args.organizationId,
    });
    const baseUrl = normaliseBaseUrl(args.baseUrl);
    const apiKey = args.apiKey.trim();
    if (!baseUrl) {
      return {
        ok: false as const,
        reason: "invalid_url" as const,
        detail: "Enter the toolkit's full address, starting with https://",
      };
    }
    if (!apiKey) {
      return { ok: false as const, reason: "unauthorized" as const, detail: "Enter the API key." };
    }

    // Fork only: a toolkit without the storage requests is refused with steps to switch.
    const { result, storage } = await checkToolkit({ baseUrl, apiKey });
    if (!result.ok || !storage) return result;

    await ctx.runMutation(internal.toolkitConnections.save, {
      organizationId: args.organizationId,
      baseUrl,
      apiKeyCipher: await encryptSecret(apiKey),
      apiKeyHint: apiKey.slice(-4),
      buildNumber: result.buildNumber,
      storage,
      createdBy: userId,
    });
    // The team's own folder in the bucket, ready for Files (see lib/bucket.ts).
    await ctx.scheduler.runAfter(0, internal.files.settleTeamFolder, {
      organizationId: args.organizationId,
    });
    return result;
  },
});

/** Runs the connection test again for a saved connection and records the outcome. */
export const recheck = action({
  args: { connectionId: v.id("toolkitConnections") },
  returns: testResult,
  handler: async (ctx, args) => {
    const connection = await ctx.runQuery(internal.toolkitConnections.getForCheck, {
      connectionId: args.connectionId,
    });
    const { result, storage } = await checkToolkit({
      baseUrl: connection.baseUrl,
      apiKey: await decryptSecret(connection.apiKeyCipher),
    });
    await ctx.runMutation(internal.toolkitConnections.recordCheck, {
      connectionId: args.connectionId,
      ok: result.ok,
      buildNumber: result.ok ? result.buildNumber : null,
      error: result.ok
        ? null
        : result.reason === "not_fork" || result.reason === "storage"
          ? result.detail
          : CHECK_FAILURES[result.reason],
      ...(storage ? { storage } : {}),
    });
    return result;
  },
});

export const remove = mutation({
  args: { connectionId: v.id("toolkitConnections") },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return;
    await requireMember(ctx, connection.organizationId, MANAGER_ROLES);
    await ctx.db.delete(args.connectionId);
  },
});

// Internal: only reachable from the actions above.

export const authorize = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    return await requireMember(ctx, args.organizationId, MANAGER_ROLES);
  },
});

export const getForCheck = internalQuery({
  args: { connectionId: v.id("toolkitConnections") },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) throw new ConvexError({ code: "not_found", message: "Connection not found." });
    await requireMember(ctx, connection.organizationId);
    return connection;
  },
});

export const save = internalMutation({
  args: {
    organizationId: v.string(),
    baseUrl: v.string(),
    apiKeyCipher: v.string(),
    apiKeyHint: v.string(),
    buildNumber: v.union(v.null(), v.string()),
    storage: storageInfo,
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    const fields = { ...args, status: "ok" as const, lastCheckedAt: Date.now(), lastError: null };
    // Connecting the same address again replaces its key instead of adding a duplicate.
    const existing = await ctx.db
      .query("toolkitConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(50);
    const same = existing.find((connection) => connection.baseUrl === args.baseUrl);
    if (same) {
      await ctx.db.patch(same._id, fields);
      return same._id;
    }
    return await ctx.db.insert("toolkitConnections", fields);
  },
});

export const recordCheck = internalMutation({
  args: {
    connectionId: v.id("toolkitConnections"),
    ok: v.boolean(),
    buildNumber: v.union(v.null(), v.string()),
    error: v.union(v.null(), v.string()),
    storage: v.optional(storageInfo),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.connectionId, {
      status: args.ok ? "ok" : "failing",
      lastCheckedAt: Date.now(),
      lastError: args.error,
      ...(args.ok ? { buildNumber: args.buildNumber } : {}),
      ...(args.storage ? { storage: args.storage } : {}),
    });
  },
});
