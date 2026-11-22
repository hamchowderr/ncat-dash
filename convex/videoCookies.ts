import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation } from "./_generated/server";
import { MANAGER_ROLES, requireMember } from "./lib/authz";
import { encryptSecret } from "./lib/crypto";
import { DEFAULT_PARALLEL_JOBS } from "./lib/queue";

/**
 * The team's browser cookies for video sites (Settings → Video Links). YouTube, Vimeo,
 * Reddit and private Instagram posts answer a server only when it is signed in. With the
 * cookies of a browser that is, the toolkit downloads from them as that browser would.
 *
 * Owners and admins add or remove them. They are kept encrypted, shown afterwards only by
 * the sites they are for, and swapped into a download job only as it is sent (jobs.ts).
 */

/** Big enough for a whole browser's cookies; a Convex value holds up to 1 MB. */
const MOST_CHARACTERS = 400_000;

/**
 * The sites a cookies.txt file (Netscape format, as browser extensions export it) is for,
 * or null when the text is not one. Each cookie is a line of seven fields split by tabs.
 */
export function cookieSites(text: string): string[] | null {
  const sites = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.startsWith("#HttpOnly_") ? raw.slice("#HttpOnly_".length) : raw;
    if (!line.trim() || line.startsWith("#")) continue;
    const fields = line.split("\t");
    if (fields.length < 7) return null;
    const host = fields[0].replace(/^\./, "").toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(host)) return null;
    // The site, not each of its hosts: "www.youtube.com" and "m.youtube.com" are youtube.com.
    sites.add(host.split(".").slice(-2).join("."));
  }
  return sites.size > 0 ? [...sites].sort() : null;
}

export const authorize = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => await requireMember(ctx, args.organizationId, MANAGER_ROLES),
});

export const save = internalMutation({
  args: {
    organizationId: v.string(),
    cipher: v.string(),
    sites: v.array(v.string()),
    setBy: v.string(),
  },
  handler: async (ctx, { organizationId, ...cookies }) => {
    const videoCookies = { ...cookies, setAt: Date.now() };
    const settings = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .first();
    if (settings) await ctx.db.patch(settings._id, { videoCookies });
    else {
      await ctx.db.insert("teamSettings", {
        organizationId,
        maxParallelJobs: DEFAULT_PARALLEL_JOBS,
        videoCookies,
      });
    }
  },
});

/** Adds or replaces the team's cookies. Owners and admins. */
export const set = action({
  args: { organizationId: v.string(), text: v.string() },
  handler: async (ctx, args): Promise<{ sites: string[] }> => {
    const { userId } = await ctx.runQuery(internal.videoCookies.authorize, {
      organizationId: args.organizationId,
    });
    const text = args.text.trim();
    if (text.length > MOST_CHARACTERS) {
      throw new ConvexError({
        code: "invalid_input",
        message: "That file is too big. Export the cookies of the video sites only.",
      });
    }
    const sites = cookieSites(text);
    if (!sites) {
      throw new ConvexError({
        code: "invalid_input",
        message:
          "That is not a cookies.txt file. Export it with a browser extension such as Get cookies.txt LOCALLY.",
      });
    }
    await ctx.runMutation(internal.videoCookies.save, {
      organizationId: args.organizationId,
      cipher: await encryptSecret(`${text}\n`),
      sites,
      setBy: userId,
    });
    return { sites };
  },
});

/** Removes the team's cookies. Owners and admins. */
export const remove = mutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const settings = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    if (settings?.videoCookies) await ctx.db.patch(settings._id, { videoCookies: undefined });
  },
});

/** The team's cookies, still encrypted, for a download job being sent (jobs.ts). */
export const forJob = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    return settings?.videoCookies?.cipher ?? null;
  },
});
