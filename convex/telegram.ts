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
import { botHearsGroup, botUsername, telegramReady } from "./lib/chatAlerts/telegram";

/**
 * The agent in Telegram. The dashboard has ONE Telegram bot, made once in BotFather by
 * whoever runs it (TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME here and on the agent
 * server). Telegram gives bots no email address, so each member links their own Telegram
 * once: Settings opens the bot with a one-time code, they press Start, and the agent
 * then acts as them. A team can also add the bot to a Telegram group the same way.
 * Alerts go to each linked member's own chat with the bot (convex/lib/chatAlerts).
 */

/** A sign-in the agent uses is made for a day and replaced when it has under an hour left. */
const SESSION_MS = 24 * 60 * 60 * 1000;
const RENEW_MS = 60 * 60 * 1000;
/** A code made in Settings must reach the bot within this long. */
const CODE_TTL_MS = 15 * 60 * 1000;

/** What Settings shows about Telegram: the team's groups and the viewer's own link. */
export const forTeam = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    if (!(await isMember(ctx, args.organizationId))) return null;
    const { userId, role } = await requireMember(ctx, args.organizationId);
    const groups = await ctx.db
      .query("telegramGroups")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(20);
    const shown = [];
    for (const group of groups) {
      const by = await ctx.runQuery(components.betterAuth.members.contact, {
        userId: group.addedBy,
      });
      shown.push({
        chatId: group.chatId,
        title: group.title,
        addedAt: group.addedAt,
        addedBy: by?.name ?? null,
        reviews: group.reviews === true,
      });
    }
    const me = await ctx.db
      .query("telegramPeople")
      .withIndex("by_member", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", userId),
      )
      .unique();
    const linked = await ctx.db
      .query("telegramPeople")
      .withIndex("by_member", (q) => q.eq("organizationId", args.organizationId))
      .take(200);
    return {
      ready: telegramReady(),
      botUsername: botUsername(),
      canEdit: MANAGER_ROLES.includes(role),
      groups: shown,
      me: me
        ? { telegramName: me.telegramName, username: me.username ?? null, linkedAt: me.linkedAt }
        : null,
      linkedCount: linked.length,
    };
  },
});

/** The team's groups, for checking whether the bot hears being tagged in each. */
export const groupsToCheck = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const groups = await ctx.db
      .query("telegramGroups")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(20);
    return groups.map((group) => ({
      chatId: group.chatId,
      privacyOffAtJoin: group.privacyOffAtJoin,
    }));
  },
});

/**
 * Whether tagging the agent works in each of the team's groups, asked of Telegram. Settings
 * shows how to fix a group where it doesn't: the bot's privacy mode in BotFather, or
 * making the bot an admin there. Null for a group Telegram can't be asked about.
 */
export const groupHearing = action({
  args: { organizationId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ chatId: string; hears: boolean | null; privacyOff: boolean | null }[]> => {
    const groups: { chatId: string; privacyOffAtJoin?: boolean }[] = await ctx.runQuery(
      internal.telegram.groupsToCheck,
      args,
    );
    if (!telegramReady()) return [];
    const checked = [];
    for (const group of groups) {
      const heard = await botHearsGroup(group.chatId, group.privacyOffAtJoin);
      checked.push({
        chatId: group.chatId,
        hears: heard?.hears ?? null,
        privacyOff: heard?.privacyOff ?? null,
      });
    }
    return checked;
  },
});

/**
 * Makes a one-time code and returns the Telegram address that opens the bot with it.
 * "person" opens a chat with the bot; pressing Start links the person's Telegram.
 * "group" asks which group to add the bot to (owners and admins only).
 */
export const startLink = mutation({
  args: { organizationId: v.string(), kind: v.union(v.literal("person"), v.literal("group")) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(
      ctx,
      args.organizationId,
      args.kind === "group" ? MANAGER_ROLES : undefined,
    );
    const bot = botUsername();
    if (!telegramReady() || !bot) {
      throw new ConvexError({
        code: "not_ready",
        message: "Telegram is not set up on this dashboard yet.",
      });
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const code = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await ctx.db.insert("telegramLinkStarts", {
      code,
      organizationId: args.organizationId,
      userId,
      kind: args.kind,
      createdAt: Date.now(),
    });
    const param = args.kind === "group" ? "startgroup" : "start";
    return `https://t.me/${bot}?${param}=${code}`;
  },
});

/** Takes the bot's link to a group away. The agent stops answering there. */
export const removeGroup = mutation({
  args: { organizationId: v.string(), chatId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const row = await ctx.db
      .query("telegramGroups")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .unique();
    if (row && row.organizationId === args.organizationId) await ctx.db.delete(row._id);
  },
});

/**
 * Picks the group that hears the team's review activity (new reviews, client feedback,
 * mentions), or none with `chatId: null`. One group at a time, like Slack's channel.
 */
export const setReviewGroup = mutation({
  args: { organizationId: v.string(), chatId: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const groups = await ctx.db
      .query("telegramGroups")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(20);
    if (args.chatId !== null && !groups.some((group) => group.chatId === args.chatId)) {
      throw new ConvexError({
        code: "not_found",
        message: "That group is not linked to this team.",
      });
    }
    for (const group of groups) {
      const reviews = group.chatId === args.chatId;
      if ((group.reviews === true) !== reviews) await ctx.db.patch(group._id, { reviews });
    }
  },
});

/** Forgets the caller's own Telegram on this team. Alerts stop going there. */
export const unlinkMe = mutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const row = await ctx.db
      .query("telegramPeople")
      .withIndex("by_member", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", userId),
      )
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

export type LinkResult =
  | "linked"
  | "added"
  | "expired"
  | "not_member"
  | "not_manager"
  | "taken"
  | "use_in_group"
  | "use_in_private";

/**
 * Someone sent the bot /start with a code from Settings. A person code links their
 * Telegram to the member who made it; a group code links the group to the team (and the
 * person who added it, too). A code works once.
 */
export const link = internalMutation({
  args: {
    code: v.string(),
    telegramUserId: v.string(),
    chatId: v.string(),
    isGroup: v.boolean(),
    chatTitle: v.optional(v.string()),
    telegramName: v.string(),
    username: v.optional(v.string()),
    privacyOff: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ result: LinkResult; teamName: string | null }> => {
    const start = await ctx.db
      .query("telegramLinkStarts")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();
    if (!start || Date.now() - start.createdAt > CODE_TTL_MS) {
      if (start) await ctx.db.delete(start._id);
      return { result: "expired", teamName: null };
    }
    if (start.kind === "person" && args.isGroup)
      return { result: "use_in_private", teamName: null };
    if (start.kind === "group" && !args.isGroup) return { result: "use_in_group", teamName: null };
    await ctx.db.delete(start._id);
    const role = await ctx.runQuery(components.betterAuth.members.roleFor, {
      userId: start.userId,
      organizationId: start.organizationId,
    });
    if (!role) return { result: "not_member", teamName: null };
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: start.organizationId,
    });
    const teamName = team.teamName ?? null;

    let result: LinkResult = "linked";
    if (start.kind === "group") {
      if (!MANAGER_ROLES.includes(role as "owner")) return { result: "not_manager", teamName };
      const taken = await ctx.db
        .query("telegramGroups")
        .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
        .unique();
      if (taken && taken.organizationId !== start.organizationId) {
        return { result: "taken", teamName };
      }
      const title = args.chatTitle || "Telegram group";
      // Adding the bot again is how a group picks up privacy mode going off.
      const privacy = args.privacyOff === undefined ? {} : { privacyOffAtJoin: args.privacyOff };
      if (taken) await ctx.db.patch(taken._id, { title, ...privacy });
      else {
        await ctx.db.insert("telegramGroups", {
          organizationId: start.organizationId,
          chatId: args.chatId,
          title,
          addedBy: start.userId,
          addedAt: Date.now(),
          ...privacy,
        });
      }
      result = "added";
    }

    // One Telegram per member, and one member per Telegram on a team. A person's chat
    // with the bot has the same id as the person, so it is known even from a group.
    const mine = await ctx.db
      .query("telegramPeople")
      .withIndex("by_member", (q) =>
        q.eq("organizationId", start.organizationId).eq("userId", start.userId),
      )
      .unique();
    const theirs = await ctx.db
      .query("telegramPeople")
      .withIndex("by_telegram_user", (q) =>
        q.eq("telegramUserId", args.telegramUserId).eq("organizationId", start.organizationId),
      )
      .unique();
    if (theirs && theirs.userId !== start.userId) await ctx.db.delete(theirs._id);
    const fields = {
      organizationId: start.organizationId,
      userId: start.userId,
      telegramUserId: args.telegramUserId,
      chatId: args.telegramUserId,
      telegramName: args.telegramName,
      ...(args.username ? { username: args.username } : {}),
      linkedAt: Date.now(),
    };
    if (mine) await ctx.db.replace(mine._id, fields);
    else await ctx.db.insert("telegramPeople", fields);
    return { result, teamName };
  },
});

export const groupByChat = internalQuery({
  args: { chatId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("telegramGroups")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .unique();
  },
});

export const linksOf = internalQuery({
  args: { telegramUserId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("telegramPeople")
      .withIndex("by_telegram_user", (q) => q.eq("telegramUserId", args.telegramUserId))
      .take(20);
  },
});

export const rememberSession = internalMutation({
  args: { id: v.id("telegramPeople"), sessionToken: v.string(), sessionExpiresAt: v.number() },
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

export type TelegramPerson =
  | { ok: true; userId: string; name: string; organizationId: string; convexToken: string }
  | { ok: false; reason: "not_connected" | "not_linked" }
  // The team's trial is over, the team or person is blocked, or they have sent a great
  // many messages in a short time. `message` says which, for the person.
  | { ok: false; reason: "refused"; message: string };

/** In a direct chat, the team someone linked last; in a group, the team that added it. */
export function pickLink(
  links: Doc<"telegramPeople">[],
  group: Doc<"telegramGroups"> | null,
  isGroup: boolean,
): Doc<"telegramPeople"> | "not_connected" | undefined {
  if (isGroup) {
    if (!group) return "not_connected";
    return links.find((one) => one.organizationId === group.organizationId);
  }
  return [...links].sort((a, b) => b.linkedAt - a.linkedAt)[0];
}

/**
 * Who a Telegram user is on the team, with a Convex token that acts as them. In a group,
 * the team that added the bot there; in a direct chat, the team they linked last.
 */
export const person = internalAction({
  args: { chatId: v.string(), telegramUserId: v.string(), isGroup: v.boolean() },
  handler: async (ctx, args): Promise<TelegramPerson> => {
    const links: Doc<"telegramPeople">[] = await ctx.runQuery(internal.telegram.linksOf, {
      telegramUserId: args.telegramUserId,
    });
    const group: Doc<"telegramGroups"> | null = args.isGroup
      ? await ctx.runQuery(internal.telegram.groupByChat, { chatId: args.chatId })
      : null;
    const link = pickLink(links, group, args.isGroup);
    if (link === "not_connected") return { ok: false, reason: "not_connected" };
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

    const found = { userId: member.userId, name: member.name, organizationId: link.organizationId };
    if (link.sessionToken && (link.sessionExpiresAt ?? 0) - Date.now() > RENEW_MS) {
      const convexToken = await tokenFor(ctx, link.sessionToken);
      if (convexToken) return { ok: true, ...found, convexToken };
    }
    const auth = createAuth(ctx);
    const context = await auth.$context;
    const expiresAt = Date.now() + SESSION_MS;
    const session = await context.internalAdapter.createSession(member.userId, true, {
      expiresAt: new Date(expiresAt),
      userAgent: "Telegram",
    });
    const convexToken = session ? await tokenFor(ctx, session.token) : null;
    if (!session || !convexToken) {
      throw new ConvexError({ code: "failed", message: "Could not sign in for Telegram." });
    }
    await ctx.runMutation(internal.telegram.rememberSession, {
      id: link._id,
      sessionToken: session.token,
      sessionExpiresAt: expiresAt,
    });
    return { ok: true, ...found, convexToken };
  },
});

/**
 * Someone pressed Approve or Send back on an alert in Telegram. Finds the member they
 * linked on the team the approval belongs to, and decides as them.
 */
export const decide = internalMutation({
  args: {
    runStepId: v.string(),
    telegramUserId: v.string(),
    decision: v.union(v.literal("approve"), v.literal("send_back")),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; message: string }> => {
    const runStepId = ctx.db.normalizeId("runSteps", args.runStepId);
    const step = runStepId ? await ctx.db.get(runStepId) : null;
    if (!step || !runStepId) return { ok: false, message: "This approval no longer exists." };
    const link = await ctx.db
      .query("telegramPeople")
      .withIndex("by_telegram_user", (q) =>
        q.eq("telegramUserId", args.telegramUserId).eq("organizationId", step.organizationId),
      )
      .unique();
    if (!link) {
      return {
        ok: false,
        message: "Your Telegram is not linked to this team. Link it in Settings first.",
      };
    }
    return await ctx.runMutation(internal.chatAlerts.decideFromChat, {
      runStepId,
      userId: link.userId,
      decision: args.decision,
      app: "telegram",
    });
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
