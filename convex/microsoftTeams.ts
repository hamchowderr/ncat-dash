import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { isMember, MANAGER_ROLES, requireMember } from "./lib/authz";

/**
 * The agent in Microsoft Teams, and alerts posted to a Teams channel.
 *
 * The dashboard has ONE Teams bot, set up once by whoever runs it: an Azure Bot for the
 * dashboard's Microsoft app (TEAMS_APP_ID, TEAMS_APP_PASSWORD and, for a bot that serves
 * one Microsoft organization, TEAMS_APP_TENANT_ID, here and on the agent server). A team
 * owner signs in with Microsoft once from Settings, which links the team's Microsoft
 * organization to the team, then uploads the dashboard's Teams app to their Teams.
 *
 * Teams says who wrote by their Microsoft account id. A member who connected Microsoft 365
 * is known already; anyone else links their Microsoft account once by signing in. The
 * agent then acts in the dashboard as them, with their rights and nothing more.
 *
 * Sign-ins go through the dashboard's Microsoft app (MICROSOFT_CLIENT_ID and
 * MICROSOFT_CLIENT_SECRET) and come back to /microsoft/callback with a "teams." state.
 */

/** A Microsoft sign-in started from Settings must come back within this long. */
const START_TTL_MS = 15 * 60 * 1000;
/** What a Teams link sign-in asks for: only who you are and your organization. */
export const TEAMS_SIGN_IN_SCOPES = "openid profile User.Read";
/** Sign-ins for Teams carry this before their nonce, so /microsoft/callback can tell. */
export const TEAMS_STATE_PREFIX = "teams.";

type Kind = "organization" | "person";

function microsoftLogin(): string {
  return (process.env.MICROSOFT_LOGIN_URL ?? "https://login.microsoftonline.com/common").replace(
    /\/+$/,
    "",
  );
}

function graphBase(): string {
  return (process.env.MICROSOFT_GRAPH_URL ?? "https://graph.microsoft.com/v1.0").replace(
    /\/+$/,
    "",
  );
}

/** Where the bot gets its own token: Microsoft's sign-in for apps. */
function botLogin(): string {
  return (process.env.TEAMS_LOGIN_URL ?? "https://login.microsoftonline.com").replace(/\/+$/, "");
}

function redirectUri(): string {
  return `${(process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "")}/microsoft/callback`;
}

export function site(): string {
  return (process.env.SITE_URL ?? "").replace(/\/+$/, "");
}

/** Whether people can sign in with Microsoft here. */
function signInReady(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

/** Whether this dashboard has a Teams bot set up. */
function botReady(): boolean {
  return Boolean(process.env.TEAMS_APP_ID && process.env.TEAMS_APP_PASSWORD);
}

/** Back to Settings, saying how the Microsoft sign-in went. */
export function settingsUrl(result: string): string {
  return `${site()}/settings/integrations/teams?teams=${encodeURIComponent(result)}`;
}

/** Where a team downloads the dashboard's Teams app to upload to its Teams. */
export function appPackageUrl(): string {
  return `${(process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "")}/teams/app.zip`;
}

/** What Settings shows about Teams: the team's organization, alerts and the viewer's link. */
export const forTeam = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    if (!(await isMember(ctx, args.organizationId))) return null;
    const { userId, role } = await requireMember(ctx, args.organizationId);
    const tenant = await ctx.db
      .query("teamsTenants")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    const addedBy = tenant
      ? await ctx.runQuery(components.betterAuth.members.contact, { userId: tenant.addedBy })
      : null;
    const seen = await ctx.db
      .query("teamsTeams")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(50);
    const me = await ctx.db
      .query("teamsPeople")
      .withIndex("by_member", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", userId),
      )
      .unique();
    const microsoft = me
      ? null
      : await ctx.db
          .query("microsoftConnections")
          .withIndex("by_member", (q) =>
            q.eq("organizationId", args.organizationId).eq("userId", userId),
          )
          .unique();
    const linked = await ctx.db
      .query("teamsPeople")
      .withIndex("by_member", (q) => q.eq("organizationId", args.organizationId))
      .take(200);
    const fromMicrosoft = await ctx.db
      .query("microsoftConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(200);
    const people = new Set([
      ...linked.map((one) => one.userId),
      ...fromMicrosoft.map((one) => one.userId),
    ]);
    return {
      ready: signInReady() && botReady(),
      canEdit: MANAGER_ROLES.includes(role),
      appPackageUrl: appPackageUrl(),
      organization: tenant
        ? {
            name: tenant.tenantName,
            addedAt: tenant.addedAt,
            addedBy: addedBy?.name ?? null,
            alertChannel: tenant.alertConversationId
              ? { id: tenant.alertConversationId, name: tenant.alertChannelName ?? "Channel" }
              : null,
          }
        : null,
      teamsSeen: seen.map((one) => one.teamName),
      me: me
        ? { name: me.name, linkedAt: me.linkedAt, via: "teams" as const }
        : microsoft
          ? { name: microsoft.msName, linkedAt: microsoft.connectedAt, via: "microsoft" as const }
          : null,
      linkedCount: people.size,
    };
  },
});

/**
 * Starts a Microsoft sign-in from Settings and returns the address to open.
 * "organization" links the signed-in person's Microsoft organization to the team (owners
 * and admins only) and their own account too; "person" links only their own account.
 */
export const startLink = mutation({
  args: {
    organizationId: v.string(),
    kind: v.union(v.literal("organization"), v.literal("person")),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(
      ctx,
      args.organizationId,
      args.kind === "organization" ? MANAGER_ROLES : undefined,
    );
    if (!signInReady() || !botReady()) {
      throw new ConvexError({
        code: "not_ready",
        message: "Microsoft Teams is not set up on this dashboard yet.",
      });
    }
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await ctx.db.insert("teamsLinkStarts", {
      nonce,
      organizationId: args.organizationId,
      userId,
      kind: args.kind,
      createdAt: Date.now(),
    });
    const url = new URL(`${microsoftLogin()}/oauth2/v2.0/authorize`);
    url.searchParams.set("client_id", process.env.MICROSOFT_CLIENT_ID!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", TEAMS_SIGN_IN_SCOPES);
    url.searchParams.set("state", `${TEAMS_STATE_PREFIX}${nonce}`);
    url.searchParams.set("prompt", "select_account");
    return url.toString();
  },
});

/** Unlinks the team's Microsoft organization. The agent stops answering there. */
export const removeOrganization = mutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const tenant = await ctx.db
      .query("teamsTenants")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    if (tenant) await ctx.db.delete(tenant._id);
    const seen = await ctx.db
      .query("teamsTeams")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(50);
    for (const one of seen) await ctx.db.delete(one._id);
    const threads = await ctx.db
      .query("teamsReviewThreads")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(500);
    for (const one of threads) await ctx.db.delete(one._id);
  },
});

/** Forgets the caller's own Microsoft account for Teams on this team. */
export const unlinkMe = mutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const row = await ctx.db
      .query("teamsPeople")
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
      .query("teamsLinkStarts")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (Date.now() - row.createdAt > START_TTL_MS) return null;
    return { organizationId: row.organizationId, userId: row.userId, kind: row.kind as Kind };
  },
});

/** Saves what a Microsoft sign-in found. Returns how it went, for the Settings page. */
export const saveLink = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    aadObjectId: v.string(),
    name: v.string(),
    tenant: v.optional(v.object({ id: v.string(), name: v.string() })),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const role = await ctx.runQuery(components.betterAuth.members.roleFor, {
      userId: args.userId,
      organizationId: args.organizationId,
    });
    if (!role) return "not_member";
    let result = "linked";
    if (args.tenant) {
      if (!MANAGER_ROLES.includes(role as "owner")) return "not_manager";
      const taken = await ctx.db
        .query("teamsTenants")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenant!.id))
        .unique();
      if (taken && taken.organizationId !== args.organizationId) return "taken";
      const ours = await ctx.db
        .query("teamsTenants")
        .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
        .unique();
      if (ours && ours.tenantId !== args.tenant.id) {
        // A team has one Microsoft organization: a new one replaces the old.
        await ctx.db.delete(ours._id);
      }
      if (taken) await ctx.db.patch(taken._id, { tenantName: args.tenant.name });
      else {
        await ctx.db.insert("teamsTenants", {
          organizationId: args.organizationId,
          tenantId: args.tenant.id,
          tenantName: args.tenant.name,
          addedBy: args.userId,
          addedAt: Date.now(),
        });
      }
      result = "added";
    }
    // One Microsoft account per member, and one member per Microsoft account on a team.
    const mine = await ctx.db
      .query("teamsPeople")
      .withIndex("by_member", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", args.userId),
      )
      .unique();
    const theirs = await ctx.db
      .query("teamsPeople")
      .withIndex("by_aad_user", (q) =>
        q.eq("aadObjectId", args.aadObjectId).eq("organizationId", args.organizationId),
      )
      .unique();
    if (theirs && theirs.userId !== args.userId) await ctx.db.delete(theirs._id);
    const fields = {
      organizationId: args.organizationId,
      userId: args.userId,
      aadObjectId: args.aadObjectId,
      name: args.name,
      linkedAt: Date.now(),
    };
    if (mine) await ctx.db.replace(mine._id, fields);
    else await ctx.db.insert("teamsPeople", fields);
    return result;
  },
});

/** The organization ("tid") a Microsoft id token names, read from its middle part. */
export function tenantOfIdToken(idToken: string | undefined): string | null {
  const middle = idToken?.split(".")[1];
  if (!middle) return null;
  try {
    const claims = JSON.parse(atob(middle.replace(/-/g, "+").replace(/_/g, "/"))) as {
      tid?: unknown;
    };
    return typeof claims.tid === "string" ? claims.tid : null;
  } catch {
    return null;
  }
}

/** A personal Microsoft account's organization: those accounts cannot use Teams bots here. */
const PERSONAL_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

/**
 * Finishes a Microsoft sign-in for Teams: reads who signed in and their organization,
 * saves the link, and says where to send them.
 */
export const finishLink = internalAction({
  args: { code: v.string(), nonce: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const start = await ctx.runMutation(internal.microsoftTeams.takeStart, { nonce: args.nonce });
    if (!start) return settingsUrl("expired");
    if (!signInReady()) return settingsUrl("not_ready");
    try {
      const tokenResponse = await fetch(`${microsoftLogin()}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
          client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
          scope: TEAMS_SIGN_IN_SCOPES,
          grant_type: "authorization_code",
          code: args.code,
          redirect_uri: redirectUri(),
        }).toString(),
      });
      if (!tokenResponse.ok) return settingsUrl("refused");
      const token = (await tokenResponse.json()) as { access_token?: string; id_token?: string };
      if (!token.access_token) return settingsUrl("refused");
      const headers = { authorization: `Bearer ${token.access_token}` };
      const meResponse = await fetch(`${graphBase()}/me`, { headers });
      if (!meResponse.ok) return settingsUrl("refused");
      const me = (await meResponse.json()) as {
        id?: string;
        displayName?: string;
        userPrincipalName?: string;
      };
      if (!me.id) return settingsUrl("refused");
      const tenantId = tenantOfIdToken(token.id_token);
      if (!tenantId || tenantId === PERSONAL_TENANT) return settingsUrl("personal_account");
      let tenant: { id: string; name: string } | undefined;
      if (start.kind === "organization") {
        let name = "Microsoft organization";
        const orgResponse = await fetch(`${graphBase()}/organization?$select=id,displayName`, {
          headers,
        });
        if (orgResponse.ok) {
          const found = (await orgResponse.json()) as {
            value?: { id?: string; displayName?: string }[];
          };
          name = found.value?.find((one) => one.id === tenantId)?.displayName || name;
        }
        tenant = { id: tenantId, name };
      }
      const result = await ctx.runMutation(internal.microsoftTeams.saveLink, {
        organizationId: start.organizationId,
        userId: start.userId,
        aadObjectId: me.id,
        name: me.displayName || me.userPrincipalName || "Microsoft account",
        ...(tenant ? { tenant } : {}),
      });
      return settingsUrl(result);
    } catch {
      return settingsUrl("unreachable");
    }
  },
});

// Who wrote in Teams.

export const tenantById = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("teamsTenants")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .unique();
  },
});

/**
 * The link for a Microsoft account on a team: their own Teams link, or else one made now
 * from their Microsoft 365 connection.
 */
export const linkFor = internalMutation({
  args: { aadObjectId: v.string(), organizationId: v.string() },
  handler: async (ctx, args): Promise<Doc<"teamsPeople"> | null> => {
    const link = await ctx.db
      .query("teamsPeople")
      .withIndex("by_aad_user", (q) =>
        q.eq("aadObjectId", args.aadObjectId).eq("organizationId", args.organizationId),
      )
      .unique();
    if (link) return link;
    const connections = await ctx.db
      .query("microsoftConnections")
      .withIndex("by_ms_user", (q) => q.eq("msUserId", args.aadObjectId))
      .take(20);
    const connection = connections.find((one) => one.organizationId === args.organizationId);
    if (!connection) return null;
    const mine = await ctx.db
      .query("teamsPeople")
      .withIndex("by_member", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", connection.userId),
      )
      .unique();
    // Someone who linked a different Microsoft account on purpose keeps that one.
    if (mine) return null;
    const id: Id<"teamsPeople"> = await ctx.db.insert("teamsPeople", {
      organizationId: args.organizationId,
      userId: connection.userId,
      aadObjectId: args.aadObjectId,
      name: connection.msName,
      linkedAt: Date.now(),
    });
    return await ctx.db.get(id);
  },
});

/** Notes a Microsoft Teams team the bot was seen in, so its channels can take alerts. */
export const sawTeam = internalMutation({
  args: {
    organizationId: v.string(),
    tenantId: v.string(),
    teamId: v.string(),
    teamName: v.string(),
    serviceUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("teamsTeams")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .unique();
    if (row && row.organizationId !== args.organizationId) return;
    if (row) {
      await ctx.db.patch(row._id, {
        teamName: args.teamName || row.teamName,
        serviceUrl: args.serviceUrl,
        seenAt: Date.now(),
      });
    } else {
      await ctx.db.insert("teamsTeams", { ...args, seenAt: Date.now() });
    }
  },
});

// Alerts in a Teams channel.

/** A token for the dashboard's bot to post with. Null when it is not set up or refused. */
export async function botToken(): Promise<string | null> {
  const appId = process.env.TEAMS_APP_ID;
  const password = process.env.TEAMS_APP_PASSWORD;
  if (!appId || !password) return null;
  const tenant = process.env.TEAMS_APP_TENANT_ID || "botframework.com";
  const response = await fetch(`${botLogin()}/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: appId,
      client_secret: password,
      scope: "https://api.botframework.com/.default",
    }).toString(),
  });
  if (!response.ok) return null;
  const token = (await response.json()) as { access_token?: string };
  return token.access_token ?? null;
}

export type TeamsChannel = {
  id: string;
  name: string;
  teamName: string;
};

export const alertSetup = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const tenant = await ctx.db
      .query("teamsTenants")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    const seen = await ctx.db
      .query("teamsTeams")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(50);
    return { tenant, seen };
  },
});

/** Every channel of the Teams teams the bot was seen in, with where to post to each. */
async function channelsOf(
  seen: Doc<"teamsTeams">[],
): Promise<(TeamsChannel & { serviceUrl: string })[] | null> {
  const token = await botToken();
  if (!token) return null;
  const found: (TeamsChannel & { serviceUrl: string })[] = [];
  for (const team of seen) {
    const base = team.serviceUrl.replace(/\/+$/, "");
    const response = await fetch(
      `${base}/v3/teams/${encodeURIComponent(team.teamId)}/conversations`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!response.ok) continue;
    const body = (await response.json()) as {
      conversations?: { id?: string; name?: string | null }[];
    };
    for (const channel of body.conversations ?? []) {
      if (!channel.id) continue;
      found.push({
        id: channel.id,
        // Teams leaves the General channel unnamed.
        name: channel.name || "General",
        teamName: team.teamName,
        serviceUrl: team.serviceUrl,
      });
    }
  }
  return found;
}

/** The channels Settings offers for alerts. Owners and admins only. */
export const channels = action({
  args: { organizationId: v.string() },
  handler: async (ctx, args): Promise<TeamsChannel[] | null> => {
    const setup: { tenant: Doc<"teamsTenants"> | null; seen: Doc<"teamsTeams">[] } =
      await ctx.runQuery(internal.microsoftTeams.alertSetup, args);
    if (!setup.tenant) return null;
    const found = await channelsOf(setup.seen);
    return found?.map(({ id, name, teamName }) => ({ id, name, teamName })) ?? null;
  },
});

const outcome = v.union(
  v.object({ ok: v.literal(true) }),
  v.object({ ok: v.literal(false), detail: v.string() }),
);

/** Picks the channel alerts go to, or none. Owners and admins only. */
export const setAlertChannel = action({
  args: { organizationId: v.string(), channelId: v.union(v.null(), v.string()) },
  returns: outcome,
  handler: async (ctx, args) => {
    const setup: { tenant: Doc<"teamsTenants"> | null; seen: Doc<"teamsTeams">[] } =
      await ctx.runQuery(internal.microsoftTeams.alertSetup, {
        organizationId: args.organizationId,
      });
    if (!setup.tenant)
      return { ok: false as const, detail: "Link your Microsoft organization first." };
    if (args.channelId === null) {
      await ctx.runMutation(internal.microsoftTeams.saveAlertChannel, {
        tenantId: setup.tenant._id,
        channel: null,
      });
      return { ok: true as const };
    }
    const channel = (await channelsOf(setup.seen))?.find((one) => one.id === args.channelId);
    if (!channel) {
      return { ok: false as const, detail: "That channel was not found. Try another." };
    }
    await ctx.runMutation(internal.microsoftTeams.saveAlertChannel, {
      tenantId: setup.tenant._id,
      channel: {
        id: channel.id,
        serviceUrl: channel.serviceUrl,
        name: `${channel.teamName} › ${channel.name}`,
      },
    });
    return { ok: true as const };
  },
});

export const saveAlertChannel = internalMutation({
  args: {
    tenantId: v.id("teamsTenants"),
    channel: v.union(
      v.null(),
      v.object({ id: v.string(), serviceUrl: v.string(), name: v.string() }),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.tenantId, {
      alertConversationId: args.channel?.id,
      alertServiceUrl: args.channel?.serviceUrl,
      alertChannelName: args.channel?.name,
    });
  },
});

/** Markdown special characters taken literally, so a name cannot change the message. */
export function plain(text: string): string {
  return text.replace(/([\\`*_[\]<>#|])/g, "\\$1");
}

/**
 * Who an approval in a Teams alert waits for: each reviewer it names, with their Microsoft
 * account when it is known, so the card tags them and Teams tells them. None when it is
 * for the whole team.
 */
export const alertTags = internalQuery({
  args: { alertId: v.id("alerts") },
  handler: async (ctx, args) => {
    const alert = await ctx.db.get(args.alertId);
    if (!alert?.recipients?.length) return [];
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: alert.organizationId,
    });
    const tagged: { name: string; aadObjectId: string | null }[] = [];
    for (const member of team.members) {
      if (!alert.recipients.includes(member.userId)) continue;
      const link = await ctx.db
        .query("teamsPeople")
        .withIndex("by_member", (q) =>
          q.eq("organizationId", alert.organizationId).eq("userId", member.userId),
        )
        .unique();
      tagged.push({ name: member.name, aadObjectId: link?.aadObjectId ?? null });
    }
    return tagged;
  },
});

/**
 * Approve or Send back pressed on an alert card in Teams. The presser is known by their
 * Microsoft account on the team whose Microsoft organization the press came from; the
 * same rules as the run page then decide whether they may.
 */
export const alertPress = internalMutation({
  args: {
    tenantId: v.string(),
    aadObjectId: v.string(),
    runStepId: v.string(),
    decision: v.union(v.literal("approve"), v.literal("send_back")),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; message: string }> => {
    const tenant = await ctx.db
      .query("teamsTenants")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .unique();
    const runStepId = ctx.db.normalizeId("runSteps", args.runStepId);
    const step = runStepId ? await ctx.db.get(runStepId) : null;
    if (!tenant || !step || step.organizationId !== tenant.organizationId) {
      return { ok: false, message: "This approval no longer exists." };
    }
    const person: Doc<"teamsPeople"> | null = await ctx.runMutation(
      internal.microsoftTeams.linkFor,
      { aadObjectId: args.aadObjectId, organizationId: tenant.organizationId },
    );
    if (!person) {
      return {
        ok: false,
        message:
          'To approve from Teams, link your Microsoft account in the dashboard first (Settings, Microsoft Teams, "Link my Microsoft account").',
      };
    }
    return await ctx.runMutation(internal.chatAlerts.decideFromChat, {
      runStepId: step._id,
      userId: person.userId,
      decision: args.decision,
      app: "teams",
    });
  },
});
