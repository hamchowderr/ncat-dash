import { v } from "convex/values";

import { components } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { blockOf, rateLimitedMessage, refusalFor, takeAgentTurn } from "./lib/access";
import { requireMember } from "./lib/authz";
import { emailKey } from "./lib/emailKey";
import { UNKNOWN_NETWORK } from "./lib/clientIp";
import { getEdition } from "./lib/edition";
import { INVITE_ONLY_MESSAGE, signUpsMode } from "./lib/signUps";
import { limiter, waitLabel } from "./lib/limits";

const refusal = v.object({
  reason: v.union(
    v.literal("trial_ended"),
    v.literal("team_blocked"),
    v.literal("user_blocked"),
    v.literal("rate_limited"),
  ),
  message: v.string(),
});

const answer = v.union(
  v.object({ ok: v.literal(true) }),
  v.object({ ok: v.literal(false), reason: refusal.fields.reason, message: v.string() }),
);

/**
 * Whether the team on screen (and the person looking) can start something new, for the
 * band along the top. Null when they can.
 */
export const mine = query({
  args: { organizationId: v.string() },
  returns: v.union(v.null(), refusal),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    return await refusalFor(ctx, args.organizationId, userId);
  },
});

/**
 * Asked by the dashboard before each message goes to the agent: refused once the trial
 * is over, when the team or person is blocked, or when they have sent a great many in a
 * short time. Otherwise one reply is taken from their allowance.
 */
export const agentTurn = mutation({
  args: { organizationId: v.string() },
  returns: answer,
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const refused =
      (await refusalFor(ctx, args.organizationId, userId)) ??
      (await takeAgentTurn(ctx, args.organizationId, userId));
    return refused ? { ok: false as const, ...refused } : { ok: true as const };
  },
});

/** The same, for a message someone sent the agent in Slack or Discord. */
export const channelTurn = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: answer,
  handler: async (ctx, args) => {
    const refused =
      (await refusalFor(ctx, args.organizationId, args.userId)) ??
      (await takeAgentTurn(ctx, args.organizationId, args.userId));
    return refused ? { ok: false as const, ...refused } : { ok: true as const };
  },
});

/** Whether the operator has blocked this person. They can't sign in while they are. */
export const userBlocked = internalQuery({
  args: { userId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => (await blockOf(ctx, "user", args.userId)) !== null,
});

/**
 * On an invite-only copy (SIGN_UPS=invite-only), what to tell someone who may not make an
 * account: everyone but the first person needs an open invitation to a team. Null when
 * they may.
 */
export const signUpRefusal = internalQuery({
  args: { email: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    if (signUpsMode() !== "invite-only") return null;
    const check = await ctx.runQuery(components.betterAuth.members.signUpCheck, {
      email: args.email,
    });
    return !check.hasAccounts || check.invited ? null : INVITE_ONLY_MESSAGE;
  },
});

/**
 * Takes one sign-up from the network's allowance and everyone's, on the hosted edition.
 * Returns what to tell the person when there is none left, or null.
 */
export const takeSignUp = internalMutation({
  args: { networkKey: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    if (getEdition() !== "hosted") return null;
    const network =
      args.networkKey === UNKNOWN_NETWORK
        ? await limiter.limit(ctx, "signUpFromUnknown")
        : await limiter.limit(ctx, "signUpFromNetwork", { key: args.networkKey });
    const everyone = network.ok ? await limiter.limit(ctx, "signUps") : network;
    if (everyone.ok) return null;
    return `Too many accounts have been made from here in a short time. Try again ${waitLabel(everyone.retryAfter ?? 60_000)}.`;
  },
});

/** Notes where a new person signed up from, so a later team of theirs finds their trial. */
export const recordSignUp = internalMutation({
  args: { userId: v.string(), email: v.string(), networkKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (getEdition() !== "hosted") return null;
    const mailbox = emailKey(args.email);
    if (!mailbox) return null;
    await ctx.db.insert("signUps", {
      userId: args.userId,
      emailKey: mailbox,
      networkKey: args.networkKey,
      at: Date.now(),
    });
    return null;
  },
});

/** Takes one new team from the person's allowance, on the hosted edition. */
export const takeNewTeam = internalMutation({
  args: { userId: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    if (getEdition() !== "hosted") return null;
    const status = await limiter.limit(ctx, "newTeam", { key: args.userId });
    if (status.ok) return null;
    return `You've made several teams today. Try again ${waitLabel(status.retryAfter ?? 60_000)}.`;
  },
});

/**
 * Asked before each MCP request: refused like an agent reply is, and limited per key or
 * sign-in so an AI client stuck in a loop can't flood the dashboard.
 */
export const mcpCall = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: answer,
  handler: async (ctx, args) => {
    const refused = await refusalFor(ctx, args.organizationId, args.userId);
    if (refused) return { ok: false as const, ...refused };
    const status = await limiter.limit(ctx, "mcpCall", {
      key: `${args.organizationId}:${args.userId}`,
    });
    if (status.ok) return { ok: true as const };
    return {
      ok: false as const,
      reason: "rate_limited" as const,
      message: rateLimitedMessage(status.retryAfter),
    };
  },
});

/**
 * Asked by the agent server before one of the agent's own schedules fires ("every
 * morning, check..."): refused like any reply once the team's trial is over or the team
 * or person is blocked, and taken from the team's allowance, since each fire spends AI
 * tokens with nobody watching.
 */
export const scheduledTurn = internalMutation({
  args: { organizationId: v.string(), userId: v.optional(v.string()) },
  returns: answer,
  handler: async (ctx, args) => {
    const refused = await refusalFor(ctx, args.organizationId, args.userId);
    if (refused) return { ok: false as const, ...refused };
    const team = await limiter.limit(ctx, "agentTurnTeam", { key: args.organizationId });
    if (team.ok) return { ok: true as const };
    return {
      ok: false as const,
      reason: "rate_limited" as const,
      message: rateLimitedMessage(team.retryAfter),
    };
  },
});
