import { PRODUCT_NAME } from "@takewon/automation-core";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { httpAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { protectedResourceMetadata } from "./lib/agentSignIn";
import { MANAGER_ROLES, requireMember, type TeamRole } from "./lib/authz";

/**
 * Sign-in for AI agents. Better Auth's MCP plugin is the authorization server (its
 * settings are in auth.ts, the shared pieces in lib/agentSignIn.ts): an agent (an MCP
 * client such as ChatGPT, Claude or Cursor) finds it from the MCP address's metadata,
 * sends the person to sign in, pick a team (/connect/team) and allow it (/connect), and
 * gets tokens that act as that person on that team. This file serves the resource metadata from
 * this backend's own address (mcpHttp.ts serves the rest, since it needs Better Auth), checks a token's connection on each MCP call, and lists and
 * ends connections for Settings > MCP.
 */

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers":
    "authorization, content-type, mcp-protocol-version, mcp-method, mcp-name",
  "access-control-expose-headers": "www-authenticate",
};

export const preflight = httpAction(async () => new Response(null, { status: 204, headers: CORS }));

/** RFC 9728: where the MCP server's tokens come from. */
export const protectedResource = httpAction(async () =>
  Response.json(protectedResourceMetadata(PRODUCT_NAME), {
    headers: { "cache-control": "no-store", ...CORS },
  }),
);

// ---------------------------------------------------------------- the MCP side

/**
 * Who a verified access token acts for, or null when its connection was ended in
 * Settings or the person has left the team. Checked on every call, so ending a
 * connection stops its access token at once, not when it runs out.
 */
export const connectionFor = internalQuery({
  args: { clientId: v.string(), userId: v.string(), organizationId: v.string() },
  handler: async (ctx, args) => {
    const role = (await ctx.runQuery(components.betterAuth.members.roleFor, {
      userId: args.userId,
      organizationId: args.organizationId,
    })) as TeamRole | null;
    if (!role) return null;
    const consent = await ctx.runQuery(components.betterAuth.agents.consentFor, args);
    if (!consent) return null;
    const use = await ctx.db
      .query("agentConnectionUse")
      .withIndex("by_consent", (q) => q.eq("consentId", consent.consentId))
      .unique();
    return { consentId: consent.consentId, role, lastUsedAt: use?.lastUsedAt ?? null };
  },
});

export const touchConnection = internalMutation({
  args: { consentId: v.string() },
  handler: async (ctx, args) => {
    const use = await ctx.db
      .query("agentConnectionUse")
      .withIndex("by_consent", (q) => q.eq("consentId", args.consentId))
      .unique();
    if (use) await ctx.db.patch(use._id, { lastUsedAt: Date.now() });
    else await ctx.db.insert("agentConnectionUse", { ...args, lastUsedAt: Date.now() });
  },
});

// ---------------------------------------------------------------- settings

/** The agents connected to the team. Everyone sees their own; managers see everyone's. */
export const connections = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId, role } = await requireMember(ctx, args.organizationId);
    const manager = MANAGER_ROLES.includes(role);
    const all = await ctx.runQuery(components.betterAuth.agents.forTeam, {
      organizationId: args.organizationId,
    });
    const visible = all.filter((each) => manager || each.userId === userId);
    const people = new Map<string, string>();
    const rows = [];
    for (const each of visible) {
      if (!people.has(each.userId)) {
        const contact = (await ctx.runQuery(components.betterAuth.members.contact, {
          userId: each.userId,
        })) as { name?: string } | null;
        people.set(each.userId, contact?.name || "Someone");
      }
      const use = await ctx.db
        .query("agentConnectionUse")
        .withIndex("by_consent", (q) => q.eq("consentId", each.consentId))
        .unique();
      rows.push({
        grantId: each.consentId,
        clientName: each.clientName,
        person: people.get(each.userId) ?? "Someone",
        mine: each.userId === userId,
        createdAt: each.createdAt,
        lastUsedAt: use?.lastUsedAt ?? null,
      });
    }
    return rows;
  },
});

/** Ends a connection. The agent has to be allowed again to come back. */
export const disconnect = mutation({
  args: { organizationId: v.string(), grantId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, role } = await requireMember(ctx, args.organizationId);
    const all = await ctx.runQuery(components.betterAuth.agents.forTeam, {
      organizationId: args.organizationId,
    });
    const found = all.find((each) => each.consentId === args.grantId);
    if (!found) return null;
    if (found.userId !== userId && !MANAGER_ROLES.includes(role)) {
      throw new ConvexError({
        code: "forbidden",
        message: "Only a team owner or admin can disconnect someone else's agent.",
      });
    }
    await ctx.runMutation(components.betterAuth.agents.end, { consentId: found.consentId });
    const use = await ctx.db
      .query("agentConnectionUse")
      .withIndex("by_consent", (q) => q.eq("consentId", found.consentId))
      .unique();
    if (use) await ctx.db.delete(use._id);
    return null;
  },
});
