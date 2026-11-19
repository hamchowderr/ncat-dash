import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation } from "./_generated/server";
import { MANAGER_ROLES, requireMember } from "./lib/authz";
import { encryptSecret } from "./lib/crypto";
import { DEFAULT_PARALLEL_JOBS } from "./lib/queue";

/**
 * A team's own Anthropic API key (Settings → Agent). With one set, the agent's chats and
 * the Best moments and Chapters steps run on the team's Anthropic account, so what they
 * cost is billed to the team by Anthropic instead of coming out of the dashboard's.
 *
 * Owners and admins add or remove it. The key is checked with Anthropic first, kept
 * encrypted, and shown afterwards only by its last four characters. Only the agent
 * server reads it back (http.ts /agent/team-key, signed with MASTRA_JWT_SECRET).
 */

const KEY_SHAPE = /^sk-ant-[\w-]{20,300}$/;

export const authorize = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => await requireMember(ctx, args.organizationId, MANAGER_ROLES),
});

export const save = internalMutation({
  args: { organizationId: v.string(), cipher: v.string(), hint: v.string(), setBy: v.string() },
  handler: async (ctx, { organizationId, ...key }) => {
    const anthropicKey = { ...key, setAt: Date.now() };
    const settings = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .first();
    if (settings) await ctx.db.patch(settings._id, { anthropicKey });
    else {
      await ctx.db.insert("teamSettings", {
        organizationId,
        maxParallelJobs: DEFAULT_PARALLEL_JOBS,
        anthropicKey,
      });
    }
  },
});

/** Whether Anthropic takes the key: "ok", "refused", or "unreachable". */
async function checkWithAnthropic(key: string): Promise<"ok" | "refused" | "unreachable"> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return "ok";
    return response.status === 401 || response.status === 403 ? "refused" : "unreachable";
  } catch {
    return "unreachable";
  }
}

/** Adds or replaces the team's key, once Anthropic has taken it. Owners and admins. */
export const set = action({
  args: { organizationId: v.string(), key: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await ctx.runQuery(internal.anthropicKey.authorize, {
      organizationId: args.organizationId,
    });
    const key = args.key.trim();
    if (!KEY_SHAPE.test(key)) {
      throw new ConvexError({
        code: "invalid_input",
        message: "That is not an Anthropic API key. It starts with sk-ant-.",
      });
    }
    const checked = await checkWithAnthropic(key);
    if (checked === "refused") {
      throw new ConvexError({
        code: "invalid_input",
        message: "Anthropic did not accept that key. Check it in the Anthropic Console.",
      });
    }
    if (checked === "unreachable") {
      throw new ConvexError({
        code: "unavailable",
        message: "Anthropic could not be reached to check the key. Try again in a moment.",
      });
    }
    await ctx.runMutation(internal.anthropicKey.save, {
      organizationId: args.organizationId,
      cipher: await encryptSecret(key),
      hint: key.slice(-4),
      setBy: userId,
    });
  },
});

/** Removes the team's key: the agent goes back to the dashboard's own. Owners and admins. */
export const remove = mutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const settings = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    if (settings?.anthropicKey) await ctx.db.patch(settings._id, { anthropicKey: undefined });
  },
});

/** The team's key, still encrypted, for the agent server only (http.ts decrypts it). */
export const forAgent = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    return settings?.anthropicKey?.cipher ?? null;
  },
});
