import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";

/**
 * The Better Auth side of deleting a team or an account. The app calls these through
 * components.betterAuth.deletion.* once it knows who is asking (teamDeletion.ts,
 * accountDeletion.ts). The app's own rows are taken away there.
 */

const MAX_TEAMS = 100;
const MAX_ROWS = 500;

const teamPlan = v.object({
  id: v.string(),
  name: v.string(),
  role: v.string(),
  // How many people are on it, counting this one.
  people: v.number(),
  // How many of them are owners, counting this one when they are.
  owners: v.number(),
});

/** Each team a person is on, with how many people and owners it has. */
export const teamsOf = query({
  args: { userId: v.string() },
  returns: v.array(teamPlan),
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("member")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .take(MAX_TEAMS);
    const teams = [];
    for (const membership of memberships) {
      const id = ctx.db.normalizeId("organization", membership.organizationId);
      const organization = id ? await ctx.db.get(id) : null;
      if (!organization) continue;
      const everyone = await ctx.db
        .query("member")
        .withIndex("organizationId", (q) => q.eq("organizationId", organization._id))
        .take(MAX_ROWS);
      teams.push({
        id: organization._id,
        name: organization.name,
        role: membership.role,
        people: everyone.length,
        owners: everyone.filter((one) => one.role === "owner").length,
      });
    }
    return teams;
  },
});

/** The team's name, or null once it is gone. */
export const teamName = query({
  args: { organizationId: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("organization", args.organizationId);
    const organization = id ? await ctx.db.get(id) : null;
    return organization?.name ?? null;
  },
});

/** Ends every AI agent connection that was made through these consents. */
async function endConsents(ctx: MutationCtx, consentIds: Id<"oauthConsent">[]) {
  for (const id of consentIds) {
    const consent = await ctx.db.get(id);
    if (!consent) continue;
    await ctx.db.delete(consent._id);
    if (!consent.userId) continue;
    const refresh = await ctx.db
      .query("oauthRefreshToken")
      .withIndex("clientId", (q) => q.eq("clientId", consent.clientId))
      .take(MAX_ROWS);
    for (const token of refresh) {
      if (token.userId !== consent.userId || token.referenceId !== consent.referenceId) continue;
      const access = await ctx.db
        .query("oauthAccessToken")
        .withIndex("refreshId", (q) => q.eq("refreshId", token._id))
        .take(MAX_ROWS);
      for (const each of access) await ctx.db.delete(each._id);
      await ctx.db.delete(token._id);
    }
  }
}

/**
 * Takes a team out of Better Auth, as its own delete does (members, invitations, the
 * team), and also ends the AI agent connections made to it. Used when an account takes a
 * team with it; a team deleted from Settings goes through Better Auth's own route, and
 * its agents are ended here afterwards (endTeamAgents). Returns the team's name, or null
 * when it was gone already.
 */
export const removeTeam = mutation({
  args: { organizationId: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("organization", args.organizationId);
    const organization = id ? await ctx.db.get(id) : null;
    for (const table of ["member", "invitation"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("organizationId", (q) => q.eq("organizationId", args.organizationId))
        .take(MAX_ROWS);
      for (const row of rows) await ctx.db.delete(row._id);
    }
    await endTeamAgentsIn(ctx, args.organizationId);
    if (!organization) return null;
    await ctx.db.delete(organization._id);
    return organization.name;
  },
});

async function endTeamAgentsIn(ctx: MutationCtx, organizationId: string) {
  const consents = await ctx.db
    .query("oauthConsent")
    .withIndex("referenceId", (q) => q.eq("referenceId", organizationId))
    .take(MAX_ROWS);
  await endConsents(
    ctx,
    consents.map((consent) => consent._id),
  );
}

/** Ends every AI agent connection made to a team. */
export const endTeamAgents = mutation({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await endTeamAgentsIn(ctx, args.organizationId);
    return null;
  },
});

/** Takes one person off one team. */
export const leaveTeam = mutation({
  args: { userId: v.string(), organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("member")
      .withIndex("userId_organizationId", (q) =>
        q.eq("userId", args.userId).eq("organizationId", args.organizationId),
      )
      .take(10);
    for (const membership of memberships) await ctx.db.delete(membership._id);
    return null;
  },
});

/**
 * What Better Auth keeps about a person beyond their account, sessions and sign-ins
 * (which its own delete takes): the AI agents they connected and the tokens those hold.
 * Run just before the account itself goes.
 */
export const forgetPerson = mutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const consents = await ctx.db
      .query("oauthConsent")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .take(MAX_ROWS);
    await endConsents(
      ctx,
      consents.map((consent) => consent._id),
    );
    for (const table of ["oauthAccessToken", "oauthRefreshToken"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("userId", (q) => q.eq("userId", args.userId))
        .take(MAX_ROWS);
      for (const row of rows) await ctx.db.delete(row._id);
    }
    return null;
  },
});
