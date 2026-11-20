import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { createAuth } from "./auth";
import { isMember, MANAGER_ROLES, requireMember } from "./lib/authz";

/**
 * The agent in Discord. The dashboard has ONE Discord bot, set up once by whoever runs
 * it (DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET here, the bot token on the agent
 * server). A team adds that bot to its Discord server from Settings, which links the
 * server to the team. Discord gives bots no email address, so each member links their
 * own Discord account once by signing in with Discord; the agent then acts as them.
 */

/** A sign-in the agent uses is made for a day and replaced when it has under an hour left. */
const SESSION_MS = 24 * 60 * 60 * 1000;
const RENEW_MS = 60 * 60 * 1000;
/** A Discord sign-in started from Settings must come back within this long. */
const START_TTL_MS = 15 * 60 * 1000;

/**
 * What the bot may do in a server: see channels, read history, send messages and
 * messages in threads, start public threads, attach files, embed links, add reactions.
 */
export const BOT_PERMISSIONS = "309237763136";

type Kind = "server" | "person";

function discordApi(): string {
  return (process.env.DISCORD_API_URL ?? "https://discord.com/api/v10").replace(/\/+$/, "");
}

function authorizeUrl(): string {
  return process.env.DISCORD_AUTHORIZE_URL ?? "https://discord.com/oauth2/authorize";
}

/** Where Discord sends people back to after they sign in. */
export function redirectUri(): string {
  return `${(process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "")}/discord/callback`;
}

/** Whether this dashboard has a Discord bot set up. */
function ready(): boolean {
  return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
}

/** Back to Settings, saying how the Discord sign-in went. */
export function settingsUrl(result: string): string {
  const site = (process.env.SITE_URL ?? "").replace(/\/+$/, "");
  return `${site}/settings/discord?discord=${encodeURIComponent(result)}`;
}

/** What Settings shows about Discord: the team's servers and the viewer's own link. */
export const forTeam = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    if (!(await isMember(ctx, args.organizationId))) return null;
    const { userId, role } = await requireMember(ctx, args.organizationId);
    const servers = await ctx.db
      .query("discordServers")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(20);
    const shown = [];
    for (const server of servers) {
      const by = await ctx.runQuery(components.betterAuth.members.contact, {
        userId: server.addedBy,
      });
      shown.push({
        guildId: server.guildId,
        guildName: server.guildName,
        addedAt: server.addedAt,
        addedBy: by?.name ?? null,
      });
    }
    const me = await ctx.db
      .query("discordPeople")
      .withIndex("by_member", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", userId),
      )
      .unique();
    const linked = await ctx.db
      .query("discordPeople")
      .withIndex("by_member", (q) => q.eq("organizationId", args.organizationId))
      .take(200);
    return {
      ready: ready(),
      canEdit: MANAGER_ROLES.includes(role),
      servers: shown,
      me: me ? { discordName: me.discordName, linkedAt: me.linkedAt } : null,
      linkedCount: linked.length,
    };
  },
});

/**
 * Starts a Discord sign-in from Settings and returns the address to open. "server" adds
 * the bot to a server the person picks on Discord (owners and admins only) and links
 * their own account too; "person" only links their own account.
 */
export const startLink = mutation({
  args: { organizationId: v.string(), kind: v.union(v.literal("server"), v.literal("person")) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(
      ctx,
      args.organizationId,
      args.kind === "server" ? MANAGER_ROLES : undefined,
    );
    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!clientId || !process.env.DISCORD_CLIENT_SECRET) {
      throw new ConvexError({
        code: "not_ready",
        message: "Discord is not set up on this dashboard yet.",
      });
    }
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await ctx.db.insert("discordLinkStarts", {
      nonce,
      organizationId: args.organizationId,
      userId,
      kind: args.kind,
      createdAt: Date.now(),
    });
    const url = new URL(authorizeUrl());
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("state", nonce);
    url.searchParams.set("prompt", "consent");
    if (args.kind === "server") {
      url.searchParams.set("scope", "identify bot applications.commands");
      url.searchParams.set("permissions", BOT_PERMISSIONS);
    } else {
      url.searchParams.set("scope", "identify");
    }
    return url.toString();
  },
});

/** Takes the bot out of the team's link to a server. The agent stops answering there. */
export const removeServer = mutation({
  args: { organizationId: v.string(), guildId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const row = await ctx.db
      .query("discordServers")
      .withIndex("by_guild", (q) => q.eq("guildId", args.guildId))
      .unique();
    if (row && row.organizationId === args.organizationId) await ctx.db.delete(row._id);
  },
});

/** Forgets the caller's own Discord account on this team. */
export const unlinkMe = mutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const row = await ctx.db
      .query("discordPeople")
      .withIndex("by_member", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", userId),
      )
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

/** Uses up a started sign-in. Null when it is unknown or too old. */
export const takeStart = internalMutation({
  args: { nonce: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("discordLinkStarts")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (Date.now() - row.createdAt > START_TTL_MS) return null;
    return { organizationId: row.organizationId, userId: row.userId, kind: row.kind as Kind };
  },
});

/** Saves what a Discord sign-in found. Returns how it went, for the Settings page. */
export const saveLink = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    discordUserId: v.string(),
    discordName: v.string(),
    guild: v.optional(v.object({ id: v.string(), name: v.string() })),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const role = await ctx.runQuery(components.betterAuth.members.roleFor, {
      userId: args.userId,
      organizationId: args.organizationId,
    });
    if (!role) return "not_member";
    let result = "linked";
    if (args.guild) {
      if (!MANAGER_ROLES.includes(role as "owner")) return "not_manager";
      const taken = await ctx.db
        .query("discordServers")
        .withIndex("by_guild", (q) => q.eq("guildId", args.guild!.id))
        .unique();
      if (taken && taken.organizationId !== args.organizationId) return "taken";
      if (taken) await ctx.db.patch(taken._id, { guildName: args.guild.name });
      else {
        await ctx.db.insert("discordServers", {
          organizationId: args.organizationId,
          guildId: args.guild.id,
          guildName: args.guild.name,
          addedBy: args.userId,
          addedAt: Date.now(),
        });
      }
      result = "added";
    }
    // One Discord account per member, and one member per Discord account on a team.
    const mine = await ctx.db
      .query("discordPeople")
      .withIndex("by_member", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", args.userId),
      )
      .unique();
    const theirs = await ctx.db
      .query("discordPeople")
      .withIndex("by_discord_user", (q) =>
        q.eq("discordUserId", args.discordUserId).eq("organizationId", args.organizationId),
      )
      .unique();
    if (theirs && theirs.userId !== args.userId) await ctx.db.delete(theirs._id);
    const fields = {
      organizationId: args.organizationId,
      userId: args.userId,
      discordUserId: args.discordUserId,
      discordName: args.discordName,
      linkedAt: Date.now(),
    };
    if (mine) await ctx.db.replace(mine._id, fields);
    else await ctx.db.insert("discordPeople", fields);
    return result;
  },
});

/**
 * Finishes a Discord sign-in: trades the code for the person's Discord account (and the
 * server, when the bot was added), saves it, and says where to send them.
 */
export const finishLink = internalAction({
  args: { code: v.string(), state: v.string(), guildId: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const start = await ctx.runMutation(internal.discord.takeStart, { nonce: args.state });
    if (!start) return settingsUrl("expired");
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    if (!clientId || !clientSecret) return settingsUrl("not_ready");
    try {
      const tokenResponse = await fetch(`${discordApi()}/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: args.code,
          redirect_uri: redirectUri(),
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
      });
      if (!tokenResponse.ok) return settingsUrl("refused");
      const token = (await tokenResponse.json()) as {
        access_token?: string;
        guild?: { id?: string; name?: string };
      };
      if (!token.access_token) return settingsUrl("refused");
      const meResponse = await fetch(`${discordApi()}/users/@me`, {
        headers: { authorization: `Bearer ${token.access_token}` },
      });
      if (!meResponse.ok) return settingsUrl("refused");
      const me = (await meResponse.json()) as {
        id?: string;
        username?: string;
        global_name?: string | null;
      };
      if (!me.id) return settingsUrl("refused");
      const guildId = token.guild?.id ?? args.guildId;
      if (start.kind === "server" && !guildId) return settingsUrl("no_server");
      const result = await ctx.runMutation(internal.discord.saveLink, {
        organizationId: start.organizationId,
        userId: start.userId,
        discordUserId: me.id,
        discordName: me.global_name || me.username || "Discord account",
        ...(start.kind === "server" && guildId
          ? { guild: { id: guildId, name: token.guild?.name ?? "Discord server" } }
          : {}),
      });
      return settingsUrl(result);
    } catch {
      return settingsUrl("unreachable");
    }
  },
});

export const serverByGuild = internalQuery({
  args: { guildId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("discordServers")
      .withIndex("by_guild", (q) => q.eq("guildId", args.guildId))
      .unique();
  },
});

export const linksOf = internalQuery({
  args: { discordUserId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("discordPeople")
      .withIndex("by_discord_user", (q) => q.eq("discordUserId", args.discordUserId))
      .take(20);
  },
});

export const rememberSession = internalMutation({
  args: { id: v.id("discordPeople"), sessionToken: v.string(), sessionExpiresAt: v.number() },
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

export type DiscordPerson =
  | { ok: true; userId: string; name: string; organizationId: string; convexToken: string }
  | { ok: false; reason: "not_connected" | "not_linked" | "pick_server" }
  // The team's trial is over, the team or person is blocked, or they have sent a great
  // many messages in a short time. `message` says which, for the person.
  | { ok: false; reason: "refused"; message: string };

/**
 * Who a Discord user is on the team that owns the server they wrote in, with a Convex
 * token that acts as them. In a direct message (guildId "@me") it is the one team they
 * linked their Discord to; with several, they are asked to write in that team's server.
 */
export const person = internalAction({
  args: { guildId: v.string(), discordUserId: v.string() },
  handler: async (ctx, args): Promise<DiscordPerson> => {
    const links: Doc<"discordPeople">[] = await ctx.runQuery(internal.discord.linksOf, {
      discordUserId: args.discordUserId,
    });
    let link: Doc<"discordPeople"> | undefined;
    if (args.guildId === "@me") {
      if (links.length > 1) return { ok: false, reason: "pick_server" };
      link = links[0];
    } else {
      const server: Doc<"discordServers"> | null = await ctx.runQuery(
        internal.discord.serverByGuild,
        { guildId: args.guildId },
      );
      if (!server) return { ok: false, reason: "not_connected" };
      link = links.find((one) => one.organizationId === server.organizationId);
    }
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

    if (link.sessionToken && (link.sessionExpiresAt ?? 0) - Date.now() > RENEW_MS) {
      const convexToken = await tokenFor(ctx, link.sessionToken);
      if (convexToken) {
        return {
          ok: true,
          userId: member.userId,
          name: member.name,
          organizationId: link.organizationId,
          convexToken,
        };
      }
    }
    const auth = createAuth(ctx);
    const context = await auth.$context;
    const expiresAt = Date.now() + SESSION_MS;
    const session = await context.internalAdapter.createSession(member.userId, true, {
      expiresAt: new Date(expiresAt),
      userAgent: "Discord",
    });
    const convexToken = session ? await tokenFor(ctx, session.token) : null;
    if (!session || !convexToken) {
      throw new ConvexError({ code: "failed", message: "Could not sign in for Discord." });
    }
    await ctx.runMutation(internal.discord.rememberSession, {
      id: link._id,
      sessionToken: session.token,
      sessionExpiresAt: expiresAt,
    });
    return {
      ok: true,
      userId: member.userId,
      name: member.name,
      organizationId: link.organizationId,
      convexToken,
    };
  },
});

/** A short-lived Convex token for a sign-in, as the browser gets one. */
export async function tokenFor(ctx: ActionCtx, sessionToken: string): Promise<string | null> {
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
