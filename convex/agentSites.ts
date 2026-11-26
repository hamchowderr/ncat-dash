/**
 * Sites the agent should know: a person's own website, given when setting up or when a
 * page recording asks "Which site is this about?". They live in the agent's Knowledge
 * (packages/agent/src/mastra/ncat/page-recording.ts, `saveSite`), not here: in the
 * person's own pages by default, and in the team's pages too when they share it.
 */
import { ConvexError, v } from "convex/values";

import { components, internal } from "./_generated/api";
import { internalAction, mutation, query } from "./_generated/server";
import { requireMember } from "./lib/authz";
import { cleanPageUrl } from "./lib/pageRecording";
import { signAgentToken } from "./reviewAgent";

const KEEP_TIMEOUT_MS = 60 * 1000;

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

/** Whether the team has anyone to share with: on your own there is nothing to tick. */
export const canShare = query({
  args: { organizationId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const people = await ctx.runQuery(components.betterAuth.members.people, {
      organizationId: args.organizationId,
    });
    return people.length > 1;
  },
});

/** Keeps the caller's website for the agent: theirs alone, or the team's when shared. */
export const remember = mutation({
  args: {
    organizationId: v.string(),
    url: v.string(),
    about: v.optional(v.string()),
    share: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const url = cleanPageUrl(args.url.trim());
    if (!url) return fail("invalid_input", "Give the site's web address, starting https://.");
    await ctx.scheduler.runAfter(0, internal.agentSites.keep, {
      organizationId: args.organizationId,
      userId,
      url,
      about: (args.about ?? "").trim().slice(0, 500),
      share: args.share === true,
    });
    return null;
  },
});

/** Hands the site to the agent server. A copy with no agent keeps nothing. */
export const keep = internalAction({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    url: v.string(),
    about: v.string(),
    share: v.boolean(),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    const agentUrl = process.env.AGENT_URL;
    const secret = process.env.MASTRA_JWT_SECRET;
    if (!agentUrl || !secret) return null;
    const response = await fetch(new URL("/ncat/knowledge/site", agentUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await signAgentToken(secret, args.userId)}`,
      },
      body: JSON.stringify({
        organizationId: args.organizationId,
        url: args.url,
        about: args.about,
        share: args.share,
      }),
      signal: AbortSignal.timeout(KEEP_TIMEOUT_MS),
    }).catch(() => null);
    if (!response?.ok)
      console.warn("[agentSites] the agent did not keep the site", response?.status);
    return null;
  },
});
