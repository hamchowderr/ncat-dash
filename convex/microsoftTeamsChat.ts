import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";
import { createAuth } from "./auth";
import { tokenFor } from "./discord";

/**
 * Who wrote to the agent in Microsoft Teams, signed in as them. Kept apart from
 * microsoftTeams.ts because signing in loads Better Auth, which the Settings page's
 * functions should not wait for.
 */

/** A sign-in the agent uses is made for a day and replaced when it has under an hour left. */
const SESSION_MS = 24 * 60 * 60 * 1000;
const RENEW_MS = 60 * 60 * 1000;

export const rememberSession = internalMutation({
  args: { id: v.id("teamsPeople"), sessionToken: v.string(), sessionExpiresAt: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (row) {
      await ctx.db.patch(args.id, {
        sessionToken: args.sessionToken,
        sessionExpiresAt: args.sessionExpiresAt,
      });
    }
  },
});

export type TeamsPerson =
  | { ok: true; userId: string; name: string; organizationId: string; convexToken: string }
  | { ok: false; reason: "not_connected" | "not_linked" }
  | { ok: false; reason: "refused"; message: string };

/**
 * Who a Teams user is on the team that linked their Microsoft organization, with a Convex
 * token that acts as them. When they wrote in a Teams team, that team is noted so its
 * channels can be picked for alerts.
 */
export const person = internalAction({
  args: {
    tenantId: v.string(),
    aadObjectId: v.string(),
    team: v.optional(
      v.object({ teamId: v.string(), teamName: v.string(), serviceUrl: v.string() }),
    ),
  },
  handler: async (ctx, args): Promise<TeamsPerson> => {
    const tenant: Doc<"teamsTenants"> | null = await ctx.runQuery(
      internal.microsoftTeams.tenantById,
      {
        tenantId: args.tenantId,
      },
    );
    if (!tenant) return { ok: false, reason: "not_connected" };
    if (args.team) {
      await ctx.runMutation(internal.microsoftTeams.sawTeam, {
        organizationId: tenant.organizationId,
        tenantId: tenant.tenantId,
        ...args.team,
      });
    }
    const link: Doc<"teamsPeople"> | null = await ctx.runMutation(internal.microsoftTeams.linkFor, {
      aadObjectId: args.aadObjectId,
      organizationId: tenant.organizationId,
    });
    if (!link) return { ok: false, reason: "not_linked" };
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: link.organizationId,
    });
    const member = team.members.find((one) => one.userId === link.userId);
    if (!member) return { ok: false, reason: "not_linked" };
    // Checked before every reply: each one spends AI tokens.
    const answer = await ctx.runMutation(internal.access.channelTurn, {
      organizationId: link.organizationId,
      userId: member.userId,
    });
    if (!answer.ok) return { ok: false, reason: "refused", message: answer.message };

    const signedIn = (convexToken: string): TeamsPerson => ({
      ok: true,
      userId: member.userId,
      name: member.name,
      organizationId: link.organizationId,
      convexToken,
    });
    if (link.sessionToken && (link.sessionExpiresAt ?? 0) - Date.now() > RENEW_MS) {
      const convexToken = await tokenFor(ctx, link.sessionToken);
      if (convexToken) return signedIn(convexToken);
    }
    const auth = createAuth(ctx);
    const context = await auth.$context;
    const expiresAt = Date.now() + SESSION_MS;
    const session = await context.internalAdapter.createSession(member.userId, true, {
      expiresAt: new Date(expiresAt),
      userAgent: "Microsoft Teams",
    });
    const convexToken = session ? await tokenFor(ctx, session.token) : null;
    if (!session || !convexToken) {
      throw new ConvexError({ code: "failed", message: "Could not sign in for Teams." });
    }
    await ctx.runMutation(internal.microsoftTeamsChat.rememberSession, {
      id: link._id,
      sessionToken: session.token,
      sessionExpiresAt: expiresAt,
    });
    return signedIn(convexToken);
  },
});
