import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * The AI agents (OAuth clients of Better Auth's MCP plugin) connected to teams. A
 * connection is a consent: one person allowing one agent on one team (its referenceId).
 * The app calls these through components.betterAuth.agents.* once it knows the caller.
 */

const MAX_PER_TEAM = 100;

/** Every connection to a team, with the agent's name. */
export const forTeam = query({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      consentId: v.string(),
      clientId: v.string(),
      clientName: v.string(),
      userId: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const consents = await ctx.db
      .query("oauthConsent")
      .withIndex("referenceId", (q) => q.eq("referenceId", args.organizationId))
      .take(MAX_PER_TEAM);
    const rows = [];
    for (const consent of consents) {
      if (!consent.userId) continue;
      const client = await ctx.db
        .query("oauthClient")
        .withIndex("clientId", (q) => q.eq("clientId", consent.clientId))
        .unique();
      rows.push({
        consentId: consent._id,
        clientId: consent.clientId,
        clientName: client?.name || hostOf(consent.clientId) || "An app",
        userId: consent.userId,
        createdAt: consent.createdAt ?? consent._creationTime,
      });
    }
    return rows;
  },
});

/** How many agents are connected to a team, counted up to the most allowed. */
export const countForTeam = query({
  args: { organizationId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) =>
    (
      await ctx.db
        .query("oauthConsent")
        .withIndex("referenceId", (q) => q.eq("referenceId", args.organizationId))
        .take(MAX_PER_TEAM + 1)
    ).length,
});

/** The connection a token comes from, or null once it was disconnected. */
export const consentFor = query({
  args: { clientId: v.string(), userId: v.string(), organizationId: v.string() },
  returns: v.union(v.null(), v.object({ consentId: v.string(), clientName: v.string() })),
  handler: async (ctx, args) => {
    const consent = await ctx.db
      .query("oauthConsent")
      .withIndex("clientId_referenceId_userId", (q) =>
        q
          .eq("clientId", args.clientId)
          .eq("referenceId", args.organizationId)
          .eq("userId", args.userId),
      )
      .first();
    if (!consent) return null;
    const client = await ctx.db
      .query("oauthClient")
      .withIndex("clientId", (q) => q.eq("clientId", args.clientId))
      .unique();
    return { consentId: consent._id, clientName: client?.name || hostOf(args.clientId) || "An app" };
  },
});

/**
 * Ends a connection: the consent goes, and so do its refresh and access tokens, so the
 * agent has to be allowed again. An access token already handed out stops working too:
 * the MCP server checks the consent on every call.
 */
export const end = mutation({
  args: { consentId: v.string() },
  returns: v.union(
    v.null(),
    v.object({ clientId: v.string(), userId: v.string(), organizationId: v.string() }),
  ),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("oauthConsent", args.consentId);
    const consent = id ? await ctx.db.get(id) : null;
    if (!consent || !consent.userId || !consent.referenceId) return null;
    const { clientId, userId, referenceId } = consent;
    await ctx.db.delete(consent._id);
    const refresh = await ctx.db
      .query("oauthRefreshToken")
      .withIndex("clientId", (q) => q.eq("clientId", clientId))
      .take(1000);
    for (const token of refresh) {
      if (token.userId !== userId || token.referenceId !== referenceId) continue;
      const access = await ctx.db
        .query("oauthAccessToken")
        .withIndex("refreshId", (q) => q.eq("refreshId", token._id))
        .take(100);
      for (const each of access) await ctx.db.delete(each._id);
      await ctx.db.delete(token._id);
    }
    return { clientId, userId, organizationId: referenceId };
  },
});

function hostOf(clientId: string): string | null {
  try {
    return new URL(clientId).host || null;
  } catch {
    return null;
  }
}
