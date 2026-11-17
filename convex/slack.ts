import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { createAuth } from "./auth";
import { isMember, MANAGER_ROLES, requireMember } from "./lib/authz";
import { decryptSecret, encryptSecret } from "./lib/crypto";
import { cleanPasted, emailOf, whoAmI } from "./lib/slackApi";

const outcome = v.union(
  v.object({ ok: v.literal(true) }),
  v.object({ ok: v.literal(false), detail: v.string() }),
);

/** A sign-in the agent uses is made for a day and replaced when it has under an hour left. */
const SESSION_MS = 24 * 60 * 60 * 1000;
const RENEW_MS = 60 * 60 * 1000;

/** What Settings shows about the team's Slack app. Never the token or the secret. */
export const forTeam = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    if (!(await isMember(ctx, args.organizationId))) return null;
    const { role } = await requireMember(ctx, args.organizationId);
    const canEdit = MANAGER_ROLES.includes(role);
    const row = await ctx.db
      .query("slackConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    if (!row) return { connected: false as const, canEdit };
    const by = await ctx.runQuery(components.betterAuth.members.contact, {
      userId: row.connectedBy,
    });
    return {
      connected: true as const,
      canEdit,
      slackTeamName: row.slackTeamName,
      connectedAt: row.connectedAt,
      connectedBy: by?.name ?? null,
    };
  },
});

/**
 * Checks a bot token with Slack and saves it with the app's signing secret, both
 * encrypted. Owners and admins only.
 */
export const connect = action({
  args: { organizationId: v.string(), botToken: v.string(), signingSecret: v.string() },
  returns: outcome,
  handler: async (ctx, args) => {
    const { userId } = await ctx.runQuery(internal.slack.authorize, {
      organizationId: args.organizationId,
    });
    const botToken = cleanPasted(args.botToken);
    const signingSecret = cleanPasted(args.signingSecret);
    if (!botToken.startsWith("xoxb-")) {
      return {
        ok: false as const,
        detail:
          "That is not a bot token. In your Slack app, open OAuth & Permissions and copy the Bot User OAuth Token, which starts with xoxb-.",
      };
    }
    if (!/^[a-f0-9]{32}$/i.test(signingSecret)) {
      return {
        ok: false as const,
        detail:
          "That is not a signing secret. In your Slack app, open Basic Information and copy the Signing Secret under App Credentials.",
      };
    }
    const check = await whoAmI(botToken);
    if (!check.ok) {
      return {
        ok: false as const,
        detail:
          check.reason === "refused"
            ? "Slack did not accept this token. Install the app to your workspace first, then copy the Bot User OAuth Token again."
            : "Slack could not be reached. Try again in a minute.",
      };
    }
    const saved = await ctx.runMutation(internal.slack.save, {
      organizationId: args.organizationId,
      slackTeamId: check.identity.teamId,
      slackTeamName: check.identity.teamName,
      botUserId: check.identity.botUserId,
      botTokenCipher: await encryptSecret(botToken),
      signingSecretCipher: await encryptSecret(signingSecret),
      connectedBy: userId,
    });
    if (!saved) {
      return {
        ok: false as const,
        detail: `The ${check.identity.teamName} Slack workspace is already connected to another team on this dashboard.`,
      };
    }
    return { ok: true as const };
  },
});

/** Forgets the team's Slack app. The agent stops answering there. */
export const disconnect = mutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const row = await ctx.db
      .query("slackConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    if (!row) return;
    await ctx.db.delete(row._id);
    const people = await ctx.db
      .query("slackPeople")
      .withIndex("by_slack_user", (q) => q.eq("slackTeamId", row.slackTeamId))
      .collect();
    for (const person of people) await ctx.db.delete(person._id);
  },
});

export const authorize = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    return await requireMember(ctx, args.organizationId, MANAGER_ROLES);
  },
});

/** Saves the connection, or returns false when another team already has that workspace. */
export const save = internalMutation({
  args: {
    organizationId: v.string(),
    slackTeamId: v.string(),
    slackTeamName: v.string(),
    botUserId: v.string(),
    botTokenCipher: v.string(),
    signingSecretCipher: v.string(),
    connectedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const taken = await ctx.db
      .query("slackConnections")
      .withIndex("by_slack_team", (q) => q.eq("slackTeamId", args.slackTeamId))
      .unique();
    if (taken && taken.organizationId !== args.organizationId) return false;
    const mine = await ctx.db
      .query("slackConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    const fields = { ...args, connectedAt: Date.now() };
    if (mine) {
      // A different workspace: the people found in the old one no longer apply.
      if (mine.slackTeamId !== args.slackTeamId) {
        const people = await ctx.db
          .query("slackPeople")
          .withIndex("by_slack_user", (q) => q.eq("slackTeamId", mine.slackTeamId))
          .collect();
        for (const person of people) await ctx.db.delete(person._id);
      }
      await ctx.db.replace(mine._id, fields);
    } else {
      await ctx.db.insert("slackConnections", fields);
    }
    return true;
  },
});

export const bySlackTeam = internalQuery({
  args: { slackTeamId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("slackConnections")
      .withIndex("by_slack_team", (q) => q.eq("slackTeamId", args.slackTeamId))
      .unique();
  },
});

export type Installation = {
  organizationId: string;
  botUserId: string;
  botToken: string;
  signingSecret: string;
};

/** What the agent server needs to take a Slack workspace's events, or null. */
export const installation = internalAction({
  args: { slackTeamId: v.string() },
  handler: async (ctx, args): Promise<Installation | null> => {
    const row: Doc<"slackConnections"> | null = await ctx.runQuery(
      internal.slack.bySlackTeam,
      args,
    );
    if (!row) return null;
    return {
      organizationId: row.organizationId,
      botUserId: row.botUserId,
      botToken: await decryptSecret(row.botTokenCipher),
      signingSecret: await decryptSecret(row.signingSecretCipher),
    };
  },
});

export const knownPerson = internalQuery({
  args: { slackTeamId: v.string(), slackUserId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("slackPeople")
      .withIndex("by_slack_user", (q) =>
        q.eq("slackTeamId", args.slackTeamId).eq("slackUserId", args.slackUserId),
      )
      .unique();
  },
});

export const rememberPerson = internalMutation({
  args: {
    slackTeamId: v.string(),
    slackUserId: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    sessionToken: v.string(),
    sessionExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("slackPeople")
      .withIndex("by_slack_user", (q) =>
        q.eq("slackTeamId", args.slackTeamId).eq("slackUserId", args.slackUserId),
      )
      .unique();
    if (existing) await ctx.db.replace(existing._id, args);
    else await ctx.db.insert("slackPeople", args);
  },
});

export type SlackPerson =
  | {
      ok: true;
      userId: string;
      name: string;
      organizationId: string;
      convexToken: string;
    }
  | { ok: false; reason: "not_connected" | "no_email" | "not_member"; email: string | null };

/**
 * Who a Slack user is on the team, matched by email address, with a Convex token that
 * acts as them. The agent then does only what that person could do in the dashboard.
 */
export const person = internalAction({
  args: { slackTeamId: v.string(), slackUserId: v.string() },
  handler: async (ctx, args): Promise<SlackPerson> => {
    const connection: Doc<"slackConnections"> | null = await ctx.runQuery(
      internal.slack.bySlackTeam,
      {
        slackTeamId: args.slackTeamId,
      },
    );
    if (!connection) return { ok: false, reason: "not_connected", email: null };
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: connection.organizationId,
    });

    const known: Doc<"slackPeople"> | null = await ctx.runQuery(internal.slack.knownPerson, args);
    const knownMember =
      known && known.organizationId === connection.organizationId
        ? team.members.find((member) => member.userId === known.userId)
        : undefined;
    if (known && knownMember && known.sessionExpiresAt - Date.now() > RENEW_MS) {
      const convexToken = await tokenFor(ctx, known.sessionToken);
      if (convexToken) {
        return {
          ok: true,
          userId: knownMember.userId,
          name: knownMember.name,
          organizationId: connection.organizationId,
          convexToken,
        };
      }
    }

    const email = await emailOf(await decryptSecret(connection.botTokenCipher), args.slackUserId);
    if (!email) return { ok: false, reason: "no_email", email: null };
    const member = team.members.find((candidate) => candidate.email.toLowerCase() === email);
    if (!member) return { ok: false, reason: "not_member", email };

    const auth = createAuth(ctx);
    const context = await auth.$context;
    const expiresAt = Date.now() + SESSION_MS;
    const session = await context.internalAdapter.createSession(member.userId, true, {
      expiresAt: new Date(expiresAt),
      userAgent: "Slack",
    });
    if (!session)
      throw new ConvexError({ code: "failed", message: "Could not sign in for Slack." });
    const convexToken = await tokenFor(ctx, session.token);
    if (!convexToken) {
      throw new ConvexError({ code: "failed", message: "Could not sign in for Slack." });
    }
    await ctx.runMutation(internal.slack.rememberPerson, {
      ...args,
      organizationId: connection.organizationId,
      userId: member.userId,
      sessionToken: session.token,
      sessionExpiresAt: expiresAt,
    });
    return {
      ok: true,
      userId: member.userId,
      name: member.name,
      organizationId: connection.organizationId,
      convexToken,
    };
  },
});

/** A short-lived Convex token for a sign-in, as the browser gets one. */
async function tokenFor(ctx: ActionCtx, sessionToken: string): Promise<string | null> {
  try {
    const auth = createAuth(ctx);
    const result = (await auth.api.getConvexToken({
      headers: new Headers({ authorization: `Bearer ${sessionToken}` }),
    })) as { token?: unknown } | null;
    return typeof result?.token === "string" ? result.token : null;
  } catch {
    return null;
  }
}
