import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { MANAGER_ROLES, requireMember } from "./lib/authz";
import { hashMcpKey, newMcpKey } from "./lib/mcpKeys";

/**
 * Keys for the dashboard's MCP server, which lets Claude and other AI agents list the
 * team's automations, start them on a file and see how runs went. A key acts for the
 * team, so only an owner or admin makes or removes one.
 */

/** A team may keep this many keys. */
export const MAX_MCP_KEYS = 20;

export const list = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { role } = await requireMember(ctx, args.organizationId);
    const canEdit = MANAGER_ROLES.includes(role);
    if (!canEdit) return { canEdit, keys: [] };
    const keys = await ctx.db
      .query("mcpKeys")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(MAX_MCP_KEYS);
    return {
      canEdit,
      keys: keys
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((key) => ({
          keyId: key._id,
          name: key.name,
          hint: key.hint,
          createdAt: key.createdAt,
          lastUsedAt: key.lastUsedAt,
        })),
    };
  },
});

/** Makes a key and returns it. It is never shown again: only its hash is kept. */
export const create = mutation({
  args: { organizationId: v.string(), name: v.string() },
  returns: v.object({ key: v.string() }),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const name = args.name.trim();
    if (name.length < 1 || name.length > 60) {
      throw new ConvexError({ code: "invalid_input", message: "Name the key in 1 to 60 characters." });
    }
    const existing = await ctx.db
      .query("mcpKeys")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(MAX_MCP_KEYS);
    if (existing.length >= MAX_MCP_KEYS) {
      throw new ConvexError({
        code: "too_many",
        message: `A team can keep ${MAX_MCP_KEYS} keys. Remove one first.`,
      });
    }
    const key = newMcpKey();
    await ctx.db.insert("mcpKeys", {
      organizationId: args.organizationId,
      name,
      hash: await hashMcpKey(key),
      hint: key.slice(-4),
      createdBy: userId,
      createdAt: Date.now(),
      lastUsedAt: null,
    });
    return { key };
  },
});

/** Removes a key. Anything still using it is turned away from then on. */
export const remove = mutation({
  args: { organizationId: v.string(), keyId: v.id("mcpKeys") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const key = await ctx.db.get(args.keyId);
    if (key && key.organizationId === args.organizationId) await ctx.db.delete(key._id);
  },
});
