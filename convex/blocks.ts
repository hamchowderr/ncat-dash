import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { createAuth } from "./auth";
import { blockOf } from "./lib/access";

// For the operator: block a team or a person, and take it back.
//
//   npx convex run blocks:blockTeam '{"organizationId":"...","reason":"Card testing"}'
//   npx convex run blocks:unblockTeam '{"organizationId":"..."}'
//   npx convex run blocks:blockUser '{"email":"someone@example.com"}'
//   npx convex run blocks:unblockUser '{"email":"someone@example.com"}'
//   npx convex run blocks:list
//
// A blocked team keeps everything it made, and its people can still sign in and look,
// but nothing new starts: no runs, no agent replies (dashboard, Slack or Discord), no MCP
// calls. A blocked person is signed out everywhere and can't sign in again.

const kind = v.union(v.literal("team"), v.literal("user"));

async function putBlock(
  ctx: MutationCtx,
  args: { kind: "team" | "user"; targetId: string; reason?: string },
): Promise<boolean> {
  if (await blockOf(ctx, args.kind, args.targetId)) return false;
  await ctx.db.insert("blocks", {
    kind: args.kind,
    targetId: args.targetId,
    ...(args.reason ? { reason: args.reason } : {}),
    blockedAt: Date.now(),
  });
  return true;
}

async function removeBlock(ctx: MutationCtx, kind: "team" | "user", targetId: string) {
  const block = await blockOf(ctx, kind, targetId);
  if (!block) return false;
  await ctx.db.delete(block._id);
  return true;
}

export const put = internalMutation({
  args: { kind, targetId: v.string(), reason: v.optional(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, args) => await putBlock(ctx, args),
});

export const remove = internalMutation({
  args: { kind, targetId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => await removeBlock(ctx, args.kind, args.targetId),
});

export const blockTeam = internalMutation({
  args: { organizationId: v.string(), reason: v.optional(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, args) =>
    await putBlock(ctx, { kind: "team", targetId: args.organizationId, reason: args.reason }),
});

export const unblockTeam = internalMutation({
  args: { organizationId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => await removeBlock(ctx, "team", args.organizationId),
});

/** The person's id, from their id or their email address. */
async function personId(
  ctx: ActionCtx,
  args: { userId?: string; email?: string },
): Promise<string | null> {
  if (args.userId) return args.userId;
  if (!args.email) return null;
  const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "email", value: args.email.trim().toLowerCase() }],
  })) as { _id: string } | null;
  return user?._id ?? null;
}

export const blockUser = internalAction({
  args: { userId: v.optional(v.string()), email: v.optional(v.string()), reason: v.optional(v.string()) },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args): Promise<string | null> => {
    const userId = await personId(ctx, args);
    if (!userId) return null;
    await ctx.runMutation(internal.blocks.put, { kind: "user", targetId: userId, reason: args.reason });
    // Signed out everywhere: the dashboard, and the sign-ins Slack and Discord use.
    const auth = await createAuth(ctx).$context;
    await auth.internalAdapter.deleteUserSessions(userId);
    return userId;
  },
});

export const unblockUser = internalAction({
  args: { userId: v.optional(v.string()), email: v.optional(v.string()) },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args): Promise<string | null> => {
    const userId = await personId(ctx, args);
    if (!userId) return null;
    await ctx.runMutation(internal.blocks.remove, { kind: "user", targetId: userId });
    return userId;
  },
});

export const list = internalQuery({
  args: {},
  returns: v.array(
    v.object({ kind, targetId: v.string(), reason: v.union(v.null(), v.string()), blockedAt: v.number() }),
  ),
  handler: async (ctx) =>
    (await ctx.db.query("blocks").order("desc").take(500)).map((block) => ({
      kind: block.kind,
      targetId: block.targetId,
      reason: block.reason ?? null,
      blockedAt: block.blockedAt,
    })),
});
