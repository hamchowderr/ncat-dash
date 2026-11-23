import { testConnection } from "@ncat-dash/step-catalog";
import { outboundProblem } from "./lib/outbound";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
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
      // Jobs are still out on the team's current toolkit, so it can't switch yet.
      v.literal("busy"),
    ),
    detail: v.string(),
  }),
);

type TestResult = typeof testResult.type;

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
    // The toolkit the operator lends (HOSTED_TOOLKIT_URL), rather than the team's own.
    ours: isOurs(connection.baseUrl),
    baseUrl: connection.baseUrl,
    // The lent toolkit's key is the operator's, so not even its ending is shown.
    apiKeyHint: isOurs(connection.baseUrl) ? "" : connection.apiKeyHint,
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
  handler: async (ctx, args) => connectTeam(ctx, args),
});

/** The toolkit the operator lends to teams without one, when both its address and key are set. */
function ourToolkit(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = process.env.HOSTED_TOOLKIT_URL?.trim();
  const apiKey = process.env.HOSTED_TOOLKIT_API_KEY?.trim();
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

/** Whether an address is the lent toolkit's (same origin as HOSTED_TOOLKIT_URL). */
export function isOurs(baseUrl: string): boolean {
  const ours = process.env.HOSTED_TOOLKIT_URL?.trim();
  if (!ours) return false;
  try {
    return new URL(ours).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

// A new team tries the lent toolkit this many times (1, 2, 4, 8 minutes apart) before it is
// left for the team to connect from Settings.
const LEND_TRIES = 5;

/** Whether setting up can offer "just use ours" for a team without its own toolkit. */
export const offersOurs = query({
  args: { organizationId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    return ourToolkit() !== null;
  },
});

/**
 * Connects the team to the toolkit the operator runs (HOSTED_TOOLKIT_URL and
 * HOSTED_TOOLKIT_API_KEY), tested the same way as a team's own. The key never reaches
 * the browser. With either unset it answers `not_offered` and saves nothing.
 */
export const connectOurs = action({
  args: { organizationId: v.string() },
  returns: v.union(
    testResult,
    v.object({ ok: v.literal(false), reason: v.literal("not_offered") }),
  ),
  handler: async (ctx, args) => {
    const ours = ourToolkit();
    if (!ours) {
      await ctx.runQuery(internal.toolkitConnections.authorize, {
        organizationId: args.organizationId,
      });
      return { ok: false as const, reason: "not_offered" as const };
    }
    return connectTeam(ctx, { organizationId: args.organizationId, ...ours });
  },
});

/**
 * Puts a new team on the lent toolkit, so nobody setting up is asked about a toolkit.
 * Scheduled when a team is made (auth.ts). Does nothing without HOSTED_TOOLKIT_URL and
 * HOSTED_TOOLKIT_API_KEY, or once the team has a toolkit; tries again a few times when the
 * toolkit does not answer.
 */
export const lendOurs = internalAction({
  args: { organizationId: v.string(), userId: v.string(), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const ours = ourToolkit();
    if (!ours) return null;
    const has: boolean = await ctx.runQuery(internal.toolkitConnections.hasAny, {
      organizationId: args.organizationId,
    });
    if (has) return null;
    const result = await saveIfWorking(ctx, {
      organizationId: args.organizationId,
      createdBy: args.userId,
      ...ours,
    });
    const attempt = args.attempt ?? 1;
    if (!result.ok && attempt < LEND_TRIES) {
      await ctx.scheduler.runAfter(
        2 ** (attempt - 1) * 60_000,
        internal.toolkitConnections.lendOurs,
        {
          ...args,
          attempt: attempt + 1,
        },
      );
    }
    return null;
  },
});

async function connectTeam(
  ctx: ActionCtx,
  args: { organizationId: string; baseUrl: string; apiKey: string },
): Promise<TestResult> {
  const { userId }: { userId: string } = await ctx.runQuery(internal.toolkitConnections.authorize, {
    organizationId: args.organizationId,
  });
  // A team has one toolkit at a time, so switching waits for jobs out on the old one.
  const busy: number = await ctx.runQuery(internal.toolkitConnections.jobsOut, {
    organizationId: args.organizationId,
  });
  if (busy > 0) {
    return {
      ok: false as const,
      reason: "busy" as const,
      detail: `${busy} ${busy === 1 ? "job is" : "jobs are"} still out on your current toolkit. Switch once ${busy === 1 ? "it finishes" : "they finish"}.`,
    };
  }
  return saveIfWorking(ctx, { ...args, createdBy: userId });
}

/** Tests a toolkit and saves it as the team's one toolkit when the test passes. */
async function saveIfWorking(
  ctx: ActionCtx,
  args: { organizationId: string; baseUrl: string; apiKey: string; createdBy: string },
): Promise<TestResult> {
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
  // A copy strangers sign up to never calls inside its own network, except the toolkit
  // its owner lends (lib/outbound.ts).
  const refused = outboundProblem(baseUrl, ourToolkit() ? [ourToolkit()!.baseUrl] : []);
  if (refused) return { ok: false as const, reason: "invalid_url" as const, detail: refused };

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
    createdBy: args.createdBy,
  });
  // The team's own folder in the bucket, ready for Files (see lib/bucket.ts).
  await ctx.scheduler.runAfter(0, internal.files.settleTeamFolder, {
    organizationId: args.organizationId,
  });
  return result;
}

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

export const hasAny = internalQuery({
  args: { organizationId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const first = await ctx.db
      .query("toolkitConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    return first !== null;
  },
});

/** How many of the team's jobs are queued or running, up to 100. */
export const jobsOut = internalQuery({
  args: { organizationId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    let count = 0;
    for (const status of ["queued", "running"] as const) {
      const jobs = await ctx.db
        .query("jobs")
        .withIndex("by_organization_and_status", (q) =>
          q.eq("organizationId", args.organizationId).eq("status", status),
        )
        .take(100);
      count += jobs.length;
    }
    return count;
  },
});

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
    // A team has one toolkit: connecting the same address again replaces its key, and
    // connecting another one (its own, or ours again) replaces the old connection.
    const existing = await ctx.db
      .query("toolkitConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(50);
    const same = existing.find((connection) => connection.baseUrl === args.baseUrl);
    for (const other of existing) {
      if (other._id !== same?._id) await ctx.db.delete(other._id);
    }
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
