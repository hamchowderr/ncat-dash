import { teamFolder } from "@takewon/automation-core";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { isMember, requireMember } from "./lib/authz";
import { safeName } from "./lib/bucket";
import { decryptSecret, encryptSecret } from "./lib/crypto";
import { addUploadToLibrary } from "./lib/library";
import {
  type DriveItem,
  looksLikeTeamsRecording,
  pickRecording,
  RENEW_WATCH_MS,
  sameSecret,
  sharedFileOf,
  WATCH_MS,
} from "./lib/microsoft";
import { enqueueJob, pump } from "./lib/queue";
import { recordingFileName } from "./lib/zoom";

/**
 * Teams meetings, brought in by themselves. Teams saves the recording of a meeting to the
 * organizer's OneDrive, in its Recordings folder. The dashboard has ONE Microsoft app
 * (an Entra app registration, MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET), set up
 * once by whoever runs it. Each member who organizes meetings connects their own
 * Microsoft 365 account from Settings. The dashboard then asks Microsoft to tell it when
 * files in their OneDrive change; when a new recording is there, the team's toolkit
 * streams it straight from OneDrive into the team's folder, and it becomes an upload like
 * any other. A check every 15 minutes catches anything a notice missed.
 */

/** A Microsoft sign-in started from Settings must come back within this long. */
const START_TTL_MS = 15 * 60 * 1000;
/** An access token with less than this left is renewed before it is used. */
const RENEW_MS = 5 * 60 * 1000;
/** How far back "Bring in a past recording" looks. */
const PAST_DAYS = 30;
/** New recordings are looked for this far before the account was connected. */
const GRACE_MS = 10 * 60 * 1000;

/** What the dashboard asks Microsoft for: who you are, and reading your files. */
export const MICROSOFT_SCOPES = ["offline_access", "User.Read", "Files.Read"];
/** Asked for too once a member switches on recordings shared with them. */
export const SHARED_SCOPE = "Files.Read.All";
/**
 * Asked for too once a member adds a Teams channel: listing their teams and channels, and
 * reading the channel's files in SharePoint, where Teams saves channel meeting recordings.
 */
export const CHANNEL_SCOPES = ["Team.ReadBasic.All", "Channel.ReadBasic.All", "Files.Read.All"];
/** What a search for shared recordings looks for: Teams names each "… Meeting Recording". */
const SHARED_SEARCH = "Recording";
/** At most this many shared files are looked at closely on each check. */
const SHARED_LOOKUPS = 25;

/** What a sign-in asks for, from what the member allowed: shared files, Teams channels. */
export function scopesFor(granted: { shared?: boolean; channels?: boolean }): string {
  const scopes = new Set([
    ...MICROSOFT_SCOPES,
    ...(granted.shared ? [SHARED_SCOPE] : []),
    ...(granted.channels ? CHANNEL_SCOPES : []),
  ]);
  return [...scopes].join(" ");
}

/** Where a file is in Microsoft Graph: in the member's own OneDrive, or a shared one. */
function itemPath(itemId: string, driveId?: string): string {
  return driveId
    ? `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`
    : `/me/drive/items/${encodeURIComponent(itemId)}`;
}

/** How a recording is told apart from others: its file, and the OneDrive it is in. */
function itemKey(itemId: string, driveId?: string): string {
  return `${driveId ?? ""}:${itemId}`;
}

function loginBase(): string {
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

function site(): string {
  return (process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
}

/** Where Microsoft sends people back to after they sign in. */
export function redirectUri(): string {
  return `${site()}/microsoft/callback`;
}

/** Where Microsoft sends its change notices. */
export function eventsUrl(): string {
  return `${site()}/microsoft/events`;
}

/** Whether this dashboard has a Microsoft app set up. */
function ready(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

/** Back to Settings, saying how the Microsoft sign-in went. */
export function settingsUrl(result: string): string {
  const base = (process.env.SITE_URL ?? "").replace(/\/+$/, "");
  return `${base}/settings/integrations/microsoft?microsoft=${encodeURIComponent(result)}`;
}

function randomText(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function findMine(ctx: MutationCtx, organizationId: string, userId: string) {
  return await ctx.db
    .query("microsoftConnections")
    .withIndex("by_member", (q) => q.eq("organizationId", organizationId).eq("userId", userId))
    .unique();
}

/** Stops watching every Teams channel a Microsoft account was watching. */
async function forgetChannels(ctx: MutationCtx, connectionId: Id<"microsoftConnections">) {
  const rows = await ctx.db
    .query("microsoftChannels")
    .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
    .take(100);
  for (const one of rows) await ctx.db.delete(one._id);
}

/** What Settings shows: the viewer's own account, the team's, and what came in. */
export const forTeam = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    if (!(await isMember(ctx, args.organizationId))) return null;
    const { userId } = await requireMember(ctx, args.organizationId);
    const connections = await ctx.db
      .query("microsoftConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(50);
    const mine = connections.find((one) => one.userId === userId) ?? null;
    const others = [];
    for (const one of connections) {
      if (one.userId === userId) continue;
      const by = await ctx.runQuery(components.betterAuth.members.contact, { userId: one.userId });
      others.push({ msName: one.msName, memberName: by?.name ?? null });
    }
    const imports = await ctx.db
      .query("microsoftImports")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(20);
    return {
      ready: ready(),
      me: mine
        ? {
            msName: mine.msName,
            msEmail: mine.msEmail,
            connectedAt: mine.connectedAt,
            autoImport: mine.autoImport,
            needsReconnect: mine.needsReconnect ?? false,
            includeShared: mine.includeShared ?? false,
            sharedGranted: mine.sharedGranted ?? false,
            channelsGranted: mine.channelsGranted ?? false,
          }
        : null,
      channels: mine
        ? (
            await ctx.db
              .query("microsoftChannels")
              .withIndex("by_connection", (q) => q.eq("connectionId", mine._id))
              .take(50)
          ).map((one) => ({
            _id: one._id,
            teamName: one.teamName,
            channelName: one.channelName,
            since: one.since,
          }))
        : [],
      others,
      imports: imports.map((one) => ({
        _id: one._id,
        topic: one.topic,
        startTime: one.startTime,
        status: one.status,
        error: one.error ?? null,
      })),
    };
  },
});

/**
 * Starts a Microsoft sign-in from Settings and returns the address to open. With shared,
 * it also asks to read files shared with the member, and switches those on once done.
 */
export const startLink = mutation({
  args: {
    organizationId: v.string(),
    shared: v.optional(v.boolean()),
    channels: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    if (!ready()) {
      throw new ConvexError({
        code: "not_ready",
        message: "Microsoft 365 is not set up on this dashboard yet.",
      });
    }
    const nonce = randomText();
    await ctx.db.insert("microsoftLinkStarts", {
      nonce,
      organizationId: args.organizationId,
      userId,
      createdAt: Date.now(),
      ...(args.shared ? { shared: true } : {}),
      ...(args.channels ? { channels: true } : {}),
    });
    // Someone who already allowed shared files or channels keeps that when they sign in again.
    const mine = await findMine(ctx, args.organizationId, userId);
    const url = new URL(`${loginBase()}/oauth2/v2.0/authorize`);
    url.searchParams.set("client_id", process.env.MICROSOFT_CLIENT_ID!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("response_mode", "query");
    url.searchParams.set(
      "scope",
      scopesFor({
        shared: args.shared || mine?.sharedGranted,
        channels: args.channels || mine?.channelsGranted,
      }),
    );
    url.searchParams.set("state", nonce);
    url.searchParams.set("prompt", "select_account");
    return url.toString();
  },
});

/** Whether new recordings of the caller's Microsoft account come in by themselves. */
export const setAutoImport = mutation({
  args: { organizationId: v.string(), autoImport: v.boolean() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const mine = await findMine(ctx, args.organizationId, userId);
    if (!mine) {
      throw new ConvexError({
        code: "not_connected",
        message: "Connect your Microsoft account first.",
      });
    }
    // Switched back on: only recordings from now on come in by themselves.
    await ctx.db.patch(mine._id, {
      autoImport: args.autoImport,
      ...(args.autoImport && !mine.autoImport ? { connectedAt: Date.now() } : {}),
    });
  },
});

/**
 * Whether recordings of other people's meetings, shared with the caller, come in too.
 * Switching it on the first time needs Microsoft's say-so (startLink with shared).
 */
export const setIncludeShared = mutation({
  args: { organizationId: v.string(), includeShared: v.boolean() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const mine = await findMine(ctx, args.organizationId, userId);
    if (!mine) {
      throw new ConvexError({
        code: "not_connected",
        message: "Connect your Microsoft account first.",
      });
    }
    if (args.includeShared && !mine.sharedGranted) {
      throw new ConvexError({
        code: "needs_permission",
        message: "Microsoft needs to allow reading files shared with you first.",
      });
    }
    // Switched on: only recordings shared from now on come in by themselves.
    await ctx.db.patch(mine._id, {
      includeShared: args.includeShared,
      ...(args.includeShared && !mine.includeShared ? { sharedSince: Date.now() } : {}),
    });
    if (args.includeShared) {
      await ctx.scheduler.runAfter(0, internal.microsoft.check, { connectionId: mine._id });
    }
  },
});

/** Forgets the caller's Microsoft account on this team. Recordings brought in stay. */
export const disconnect = mutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const mine = await findMine(ctx, args.organizationId, userId);
    if (!mine) return;
    await forgetChannels(ctx, mine._id);
    await ctx.db.delete(mine._id);
    // Microsoft is asked to stop watching the OneDrive too.
    if (mine.subscriptionId) {
      await ctx.scheduler.runAfter(0, internal.microsoft.unwatch, {
        subscriptionId: mine.subscriptionId,
        refreshTokenCipher: mine.refreshTokenCipher,
      });
    }
  },
});

interface MicrosoftTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Trades a code or a refresh token for new tokens. Null when Microsoft refuses. */
async function tokens(
  form: Record<string, string>,
  granted: { shared?: boolean; channels?: boolean } = {},
): Promise<MicrosoftTokens | null> {
  const response = await fetch(`${loginBase()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
      client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
      scope: scopesFor(granted),
      ...form,
    }).toString(),
  });
  const token = (response.ok ? await response.json() : {}) as Partial<MicrosoftTokens>;
  if (!token.access_token || !token.refresh_token) return null;
  return token as MicrosoftTokens;
}

export const unwatch = internalAction({
  args: { subscriptionId: v.string(), refreshTokenCipher: v.string() },
  handler: async (_ctx, args) => {
    if (!ready()) return;
    try {
      const token = await tokens({
        grant_type: "refresh_token",
        refresh_token: await decryptSecret(args.refreshTokenCipher),
      });
      if (!token) return;
      await fetch(`${graphBase()}/subscriptions/${encodeURIComponent(args.subscriptionId)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token.access_token}` },
      });
    } catch {
      // A watch nobody renews ends by itself within 30 days.
    }
  },
});

// Signing in.

/** Uses up a started sign-in. Null when it is unknown or too old. */
export const takeStart = internalMutation({
  args: { nonce: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("microsoftLinkStarts")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (Date.now() - row.createdAt > START_TTL_MS) return null;
    return {
      organizationId: row.organizationId,
      userId: row.userId,
      shared: row.shared ?? false,
      channels: row.channels ?? false,
    };
  },
});

/** Saves a Microsoft account a member connected. Returns how it went, for Settings. */
export const saveConnection = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    msUserId: v.string(),
    msEmail: v.string(),
    msName: v.string(),
    accessTokenCipher: v.string(),
    refreshTokenCipher: v.string(),
    expiresAt: v.number(),
    // Microsoft allowed reading files shared with the member on this sign-in.
    shared: v.optional(v.boolean()),
    // Microsoft allowed reading the member's Teams channels and their files.
    channels: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const role = await ctx.runQuery(components.betterAuth.members.roleFor, {
      userId: args.userId,
      organizationId: args.organizationId,
    });
    if (!role) return "not_member";
    // One Microsoft account belongs to one team, so each recording has one home.
    const elsewhere = await ctx.db
      .query("microsoftConnections")
      .withIndex("by_ms_user", (q) => q.eq("msUserId", args.msUserId))
      .take(10);
    for (const one of elsewhere) {
      if (one.organizationId !== args.organizationId) return "taken";
      if (one.userId !== args.userId) return "taken_here";
    }
    const mine = await findMine(ctx, args.organizationId, args.userId);
    // The same account signing in again keeps its watch and folder; another starts over.
    const same = mine?.msUserId === args.msUserId ? mine : null;
    const { shared, channels, ...account } = args;
    const channelsGranted = Boolean(channels || same?.channelsGranted);
    const sharedGranted = Boolean(shared || same?.sharedGranted);
    const includeShared = Boolean(shared || same?.includeShared);
    const fields = {
      ...account,
      connectedAt: same?.connectedAt ?? Date.now(),
      autoImport: mine?.autoImport ?? true,
      recordingsFolderId: same?.recordingsFolderId,
      subscriptionId: same?.subscriptionId,
      subscriptionExpiresAt: same?.subscriptionExpiresAt,
      clientState: same?.clientState,
      needsReconnect: undefined,
      sharedGranted: sharedGranted || undefined,
      channelsGranted: channelsGranted || undefined,
      includeShared: includeShared || undefined,
      sharedSince: includeShared
        ? same?.includeShared
          ? (same.sharedSince ?? Date.now())
          : Date.now()
        : undefined,
    };
    let connectionId: Id<"microsoftConnections">;
    if (mine) {
      await ctx.db.replace(mine._id, fields);
      connectionId = mine._id;
      // Another Microsoft account: the old one's channels are no longer watched.
      if (!same) await forgetChannels(ctx, mine._id);
    } else {
      connectionId = await ctx.db.insert("microsoftConnections", fields);
    }
    if (mine && !same && mine.subscriptionId) {
      await ctx.scheduler.runAfter(0, internal.microsoft.unwatch, {
        subscriptionId: mine.subscriptionId,
        refreshTokenCipher: mine.refreshTokenCipher,
      });
    }
    // Ask Microsoft to tell us about new files, and look for recordings straight away.
    await ctx.scheduler.runAfter(0, internal.microsoft.watch, { connectionId });
    return "connected";
  },
});

/** Finishes a Microsoft sign-in: trades the code for tokens, finds the account, saves it. */
export const finishLink = internalAction({
  args: { code: v.string(), state: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const start = await ctx.runMutation(internal.microsoft.takeStart, { nonce: args.state });
    if (!start) return settingsUrl("expired");
    if (!ready()) return settingsUrl("not_ready");
    try {
      const token = await tokens(
        { grant_type: "authorization_code", code: args.code, redirect_uri: redirectUri() },
        { shared: start.shared, channels: start.channels },
      );
      if (!token) return settingsUrl("refused");
      const meResponse = await fetch(`${graphBase()}/me`, {
        headers: { authorization: `Bearer ${token.access_token}` },
      });
      if (!meResponse.ok) return settingsUrl("refused");
      const me = (await meResponse.json()) as {
        id?: string;
        displayName?: string;
        mail?: string | null;
        userPrincipalName?: string;
      };
      if (!me.id) return settingsUrl("refused");
      const email = me.mail || me.userPrincipalName || "";
      const result = await ctx.runMutation(internal.microsoft.saveConnection, {
        organizationId: start.organizationId,
        userId: start.userId,
        msUserId: me.id,
        msEmail: email,
        msName: me.displayName || email || "Microsoft account",
        accessTokenCipher: await encryptSecret(token.access_token),
        refreshTokenCipher: await encryptSecret(token.refresh_token),
        expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
        ...(start.shared ? { shared: true } : {}),
        ...(start.channels ? { channels: true } : {}),
      });
      if (result !== "connected") return settingsUrl(result);
      return settingsUrl(start.channels ? "channels" : start.shared ? "shared" : result);
    } catch {
      return settingsUrl("unreachable");
    }
  },
});

// Tokens.

export const connection = internalQuery({
  args: { connectionId: v.id("microsoftConnections") },
  handler: async (ctx, args) => await ctx.db.get(args.connectionId),
});

export const patchConnection = internalMutation({
  args: {
    connectionId: v.id("microsoftConnections"),
    fields: v.object({
      accessTokenCipher: v.optional(v.string()),
      refreshTokenCipher: v.optional(v.string()),
      expiresAt: v.optional(v.number()),
      recordingsFolderId: v.optional(v.string()),
      subscriptionId: v.optional(v.string()),
      subscriptionExpiresAt: v.optional(v.number()),
      clientState: v.optional(v.string()),
      needsReconnect: v.optional(v.boolean()),
      lastCheckedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { connectionId, fields }) => {
    if (await ctx.db.get(connectionId)) await ctx.db.patch(connectionId, fields);
  },
});

export class MicrosoftSignInError extends Error {}

/**
 * A working access token for a connected Microsoft account, renewed when it runs low.
 * Microsoft may hand out a new refresh token each time, so the new one is kept.
 */
export async function accessTokenFor(
  ctx: ActionCtx,
  connectionId: Id<"microsoftConnections">,
): Promise<string> {
  const row: Doc<"microsoftConnections"> | null = await ctx.runQuery(
    internal.microsoft.connection,
    { connectionId },
  );
  if (!row) throw new MicrosoftSignInError("This Microsoft account is no longer connected.");
  if (row.expiresAt - Date.now() > RENEW_MS) return await decryptSecret(row.accessTokenCipher);
  const token = await tokens(
    { grant_type: "refresh_token", refresh_token: await decryptSecret(row.refreshTokenCipher) },
    { shared: row.sharedGranted, channels: row.channelsGranted },
  );
  if (!token) {
    await ctx.runMutation(internal.microsoft.patchConnection, {
      connectionId,
      fields: { needsReconnect: true },
    });
    throw new MicrosoftSignInError(
      "Microsoft no longer accepts this account's sign-in. Connect it again in Settings.",
    );
  }
  await ctx.runMutation(internal.microsoft.patchConnection, {
    connectionId,
    fields: {
      accessTokenCipher: await encryptSecret(token.access_token),
      refreshTokenCipher: await encryptSecret(token.refresh_token),
      expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    },
  });
  return token.access_token;
}

async function graph(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${graphBase()}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
}

/**
 * The OneDrive folder Teams saves recordings to. Microsoft names it as a special folder
 * on work and school accounts; otherwise it is the "Recordings" folder at the top of the
 * OneDrive. Null until Teams has saved a first recording.
 */
async function recordingsFolder(token: string): Promise<string | null> {
  for (const path of ["/me/drive/special/recordings", "/me/drive/root:/Recordings"]) {
    const response = await graph(token, path);
    if (!response.ok) continue;
    const folder = (await response.json()) as DriveItem;
    if (folder.id && folder.folder) return folder.id;
  }
  return null;
}

/** The files in the Recordings folder, newest first. Null when there is no folder yet. */
async function recordingsIn(
  ctx: ActionCtx,
  row: Doc<"microsoftConnections">,
  token: string,
): Promise<DriveItem[] | null> {
  let folderId = row.recordingsFolderId ?? null;
  if (!folderId) {
    folderId = await recordingsFolder(token);
    if (!folderId) return null;
    await ctx.runMutation(internal.microsoft.patchConnection, {
      connectionId: row._id,
      fields: { recordingsFolderId: folderId },
    });
  }
  const items: DriveItem[] = [];
  let next: string | null =
    `/me/drive/items/${encodeURIComponent(folderId)}/children?$top=200` +
    "&$select=id,name,size,createdDateTime,lastModifiedDateTime,file,folder,video";
  for (let page = 0; next && page < 5; page++) {
    const response = await graph(token, next);
    if (response.status === 404) {
      // The folder was moved or removed: look for it again next time.
      await ctx.runMutation(internal.microsoft.patchConnection, {
        connectionId: row._id,
        fields: { recordingsFolderId: undefined },
      });
      return null;
    }
    if (!response.ok) {
      throw new ConvexError({
        code: "microsoft_refused",
        message: `Microsoft did not list your recordings (HTTP ${response.status}).`,
      });
    }
    const body = (await response.json()) as {
      value?: DriveItem[];
      "@odata.nextLink"?: string;
    };
    items.push(...(body.value ?? []));
    next = nextPage(body["@odata.nextLink"]);
  }
  return items.sort(
    (a, b) => Date.parse(b.createdDateTime ?? "") - Date.parse(a.createdDateTime ?? ""),
  );
}

/** The path of the next page Microsoft names, kept to Graph itself. */
function nextPage(link: string | undefined): string | null {
  if (!link) return null;
  const next = link.slice(link.indexOf(graphBase()) === 0 ? graphBase().length : 0);
  return next.startsWith("/") ? next : null;
}

type SharedRecording = { item: DriveItem; driveId: string };

/**
 * Teams recordings in other people's OneDrives that were shared with the member: Teams
 * shares the recording of a meeting with the people in it. Microsoft's search of the
 * member's OneDrive also finds files shared with them; only ones named the way Teams
 * names a recording are looked at, and each is read from its own OneDrive.
 */
async function sharedRecordingsIn(token: string): Promise<SharedRecording[]> {
  const found = new Map<string, { driveId: string; itemId: string }>();
  let next: string | null = `/me/drive/search(q='${encodeURIComponent(SHARED_SEARCH)}')?$top=100`;
  for (let page = 0; next && page < 3; page++) {
    const response = await graph(token, next);
    if (!response.ok) {
      throw new ConvexError({
        code: "microsoft_refused",
        message: `Microsoft did not list recordings shared with you (HTTP ${response.status}).`,
      });
    }
    const body = (await response.json()) as {
      value?: DriveItem[];
      "@odata.nextLink"?: string;
    };
    for (const hit of body.value ?? []) {
      const shared = sharedFileOf(hit);
      if (!shared) continue;
      const name = hit.name ?? hit.remoteItem?.name ?? "";
      if (name && !looksLikeTeamsRecording(name)) continue;
      found.set(itemKey(shared.itemId, shared.driveId), shared);
    }
    next = nextPage(body["@odata.nextLink"]);
  }
  const recordings: SharedRecording[] = [];
  for (const shared of [...found.values()].slice(0, SHARED_LOOKUPS)) {
    const response = await graph(
      token,
      `${itemPath(shared.itemId, shared.driveId)}` +
        "?$select=id,name,size,createdDateTime,lastModifiedDateTime,file,folder,video",
    );
    if (!response.ok) continue;
    const item = (await response.json()) as DriveItem;
    if (!item.name || !looksLikeTeamsRecording(item.name)) continue;
    recordings.push({ item, driveId: shared.driveId });
  }
  return recordings.sort(
    (a, b) => Date.parse(b.item.createdDateTime ?? "") - Date.parse(a.item.createdDateTime ?? ""),
  );
}

// Teams channels.

/**
 * The recordings of a channel's meetings. Teams saves them in the channel's files, in a
 * Recordings folder it makes on the first recorded meeting. Null when there is none yet.
 */
async function channelRecordingsIn(
  token: string,
  channel: Doc<"microsoftChannels">,
): Promise<DriveItem[] | null> {
  const items: DriveItem[] = [];
  let next: string | null =
    `${itemPath(channel.folderId, channel.driveId)}:/Recordings:/children?$top=200` +
    "&$select=id,name,size,createdDateTime,lastModifiedDateTime,file,folder,video";
  for (let page = 0; next && page < 5; page++) {
    const response = await graph(token, next);
    if (response.status === 404) return page === 0 ? null : items;
    if (!response.ok) return null;
    const body = (await response.json()) as {
      value?: DriveItem[];
      "@odata.nextLink"?: string;
    };
    items.push(...(body.value ?? []));
    next = nextPage(body["@odata.nextLink"]);
  }
  return items;
}

/** The caller's own Microsoft account on a team, for the channel actions. */
async function mineFor(ctx: ActionCtx, organizationId: string) {
  const { row } = await ctx.runQuery(internal.microsoft.mine, { organizationId });
  if (!row.channelsGranted) {
    throw new ConvexError({
      code: "needs_permission",
      message: "Microsoft needs to allow reading your Teams channels first.",
    });
  }
  return row;
}

/** The Teams teams the caller is in, each with its channels, to pick from in Settings. */
export const teamChannels = action({
  args: { organizationId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ teamId: string; teamName: string; channels: { id: string; name: string }[] }[]> => {
    const found = await mineFor(ctx, args.organizationId);
    const token = await accessTokenFor(ctx, found._id);
    const teams = await graph(token, "/me/joinedTeams?$select=id,displayName");
    if (!teams.ok) {
      throw new ConvexError({
        code: "microsoft_refused",
        message: `Microsoft did not list your teams (HTTP ${teams.status}).`,
      });
    }
    const joined = ((await teams.json()) as { value?: { id?: string; displayName?: string }[] })
      .value;
    const listed = [];
    for (const team of (joined ?? []).slice(0, 50)) {
      if (!team.id) continue;
      const response = await graph(
        token,
        `/teams/${encodeURIComponent(team.id)}/channels?$select=id,displayName`,
      );
      if (!response.ok) continue;
      const channels = (
        (await response.json()) as {
          value?: { id?: string; displayName?: string }[];
        }
      ).value;
      listed.push({
        teamId: team.id,
        teamName: team.displayName || "Team",
        channels: (channels ?? [])
          .filter((one): one is { id: string; displayName?: string } => Boolean(one.id))
          .map((one) => ({ id: one.id, name: one.displayName || "Channel" })),
      });
    }
    return listed;
  },
});

/**
 * Starts bringing in the recordings of a channel's meetings. Only meetings recorded from
 * now on come in by themselves.
 */
export const watchChannel = action({
  args: {
    organizationId: v.string(),
    teamId: v.string(),
    teamName: v.string(),
    channelId: v.string(),
    channelName: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; detail: string }> => {
    const found = await mineFor(ctx, args.organizationId);
    const token = await accessTokenFor(ctx, found._id);
    const response = await graph(
      token,
      `/teams/${encodeURIComponent(args.teamId)}/channels/${encodeURIComponent(args.channelId)}` +
        "/filesFolder",
    );
    if (!response.ok) {
      return {
        ok: false,
        detail: "Microsoft did not open that channel's files. Check you are still in the team.",
      };
    }
    const folder = (await response.json()) as DriveItem & {
      parentReference?: { driveId?: string };
    };
    const driveId = folder.parentReference?.driveId;
    if (!folder.id || !driveId) {
      return { ok: false, detail: "That channel has no files folder yet. Try again later." };
    }
    await ctx.runMutation(internal.microsoft.saveChannel, {
      connectionId: found._id,
      teamId: args.teamId,
      teamName: args.teamName.slice(0, 200),
      channelId: args.channelId,
      channelName: args.channelName.slice(0, 200),
      driveId,
      folderId: folder.id,
    });
    return { ok: true };
  },
});

export const saveChannel = internalMutation({
  args: {
    connectionId: v.id("microsoftConnections"),
    teamId: v.string(),
    teamName: v.string(),
    channelId: v.string(),
    channelName: v.string(),
    driveId: v.string(),
    folderId: v.string(),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return;
    const watching = await ctx.db
      .query("microsoftChannels")
      .withIndex("by_connection", (q) => q.eq("connectionId", args.connectionId))
      .take(100);
    if (watching.some((one) => one.channelId === args.channelId)) return;
    await ctx.db.insert("microsoftChannels", {
      ...args,
      organizationId: connection.organizationId,
      since: Date.now(),
    });
  },
});

/** Stops bringing in a channel's recordings. Recordings already in Uploads stay. */
export const unwatchChannel = mutation({
  args: { organizationId: v.string(), channelRowId: v.id("microsoftChannels") },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const mine = await findMine(ctx, args.organizationId, userId);
    const row = await ctx.db.get(args.channelRowId);
    if (!mine || !row || row.connectionId !== mine._id) return;
    await ctx.db.delete(row._id);
  },
});

export const channelsOf = internalQuery({
  args: { connectionId: v.id("microsoftConnections") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("microsoftChannels")
      .withIndex("by_connection", (q) => q.eq("connectionId", args.connectionId))
      .take(100),
});

// Watching the OneDrive.

/**
 * Asks Microsoft to tell the dashboard when files in the member's OneDrive change, or
 * renews the watch it already has, then looks for new recordings.
 */
export const watch = internalAction({
  args: { connectionId: v.id("microsoftConnections") },
  handler: async (ctx, args) => {
    if (!ready()) return;
    const row = await ctx.runQuery(internal.microsoft.connection, args);
    if (!row) return;
    let token: string;
    try {
      token = await accessTokenFor(ctx, row._id);
    } catch {
      return;
    }
    const until = new Date(Date.now() + WATCH_MS).toISOString();
    if (row.subscriptionId) {
      const renewed = await graph(
        token,
        `/subscriptions/${encodeURIComponent(row.subscriptionId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ expirationDateTime: until }),
        },
      );
      if (renewed.ok) {
        await ctx.runMutation(internal.microsoft.patchConnection, {
          connectionId: row._id,
          fields: { subscriptionExpiresAt: Date.parse(until) },
        });
      } else {
        await ctx.runMutation(internal.microsoft.patchConnection, {
          connectionId: row._id,
          fields: { subscriptionId: undefined, subscriptionExpiresAt: undefined },
        });
        row.subscriptionId = undefined;
      }
    }
    if (!row.subscriptionId) {
      const clientState = randomText();
      // Microsoft checks the address answers before it agrees (see http.ts).
      const made = await graph(token, "/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          changeType: "updated",
          notificationUrl: eventsUrl(),
          resource: "/me/drive/root",
          expirationDateTime: until,
          clientState,
        }),
      });
      if (made.ok) {
        const subscription = (await made.json()) as { id?: string; expirationDateTime?: string };
        if (subscription.id) {
          await ctx.runMutation(internal.microsoft.patchConnection, {
            connectionId: row._id,
            fields: {
              subscriptionId: subscription.id,
              subscriptionExpiresAt: Date.parse(subscription.expirationDateTime ?? until),
              clientState,
            },
          });
        }
      }
      // Without a watch, the check every 15 minutes still brings recordings in.
    }
    await ctx.runAction(internal.microsoft.check, { connectionId: row._id });
  },
});

/**
 * Looks in the member's Recordings folder and brings in what is new since they connected,
 * and, when they switched it on, recordings of other people's meetings shared with them.
 */
export const check = internalAction({
  args: { connectionId: v.id("microsoftConnections") },
  handler: async (ctx, args) => {
    if (!ready()) return;
    const row = await ctx.runQuery(internal.microsoft.connection, args);
    if (!row || row.needsReconnect) return;
    const withShared = Boolean(row.includeShared && row.sharedGranted);
    const channels = row.channelsGranted
      ? await ctx.runQuery(internal.microsoft.channelsOf, { connectionId: row._id })
      : [];
    if (!row.autoImport && !withShared && channels.length === 0) return;
    let token: string;
    try {
      token = await accessTokenFor(ctx, row._id);
    } catch {
      return;
    }
    const items = row.autoImport ? await recordingsIn(ctx, row, token).catch(() => null) : null;
    const shared = withShared ? await sharedRecordingsIn(token).catch(() => null) : null;
    await ctx.runMutation(internal.microsoft.patchConnection, {
      connectionId: row._id,
      fields: { lastCheckedAt: Date.now() },
    });
    const sharedSince = (row.sharedSince ?? Date.now()) - GRACE_MS;
    for (const { item, driveId } of shared ?? []) {
      if (Date.parse(item.createdDateTime ?? "") < sharedSince) continue;
      const picked = pickRecording(item, Date.now(), driveId);
      if (!picked) continue;
      await ctx.runMutation(internal.microsoft.startImport, {
        connectionId: row._id,
        recording: picked,
      });
    }
    for (const channel of channels) {
      const found = await channelRecordingsIn(token, channel).catch(() => null);
      for (const item of found ?? []) {
        if (Date.parse(item.createdDateTime ?? "") < channel.since - GRACE_MS) continue;
        const picked = pickRecording(item, Date.now(), channel.driveId);
        if (!picked) continue;
        await ctx.runMutation(internal.microsoft.startImport, {
          connectionId: row._id,
          recording: picked,
        });
      }
    }
    const since = row.connectedAt - GRACE_MS;
    for (const item of items ?? []) {
      if (Date.parse(item.createdDateTime ?? "") < since) continue;
      const picked = pickRecording(item, Date.now());
      if (!picked) continue;
      await ctx.runMutation(internal.microsoft.startImport, {
        connectionId: row._id,
        recording: picked,
      });
    }
  },
});

export const watched = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("microsoftConnections").take(500),
});

/**
 * Every 15 minutes: renews watches that are running out, and looks in each Recordings
 * folder in case a notice from Microsoft was lost.
 */
export const sweep = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!ready()) return;
    const rows = await ctx.runQuery(internal.microsoft.watched, {});
    for (const row of rows) {
      if (row.needsReconnect) continue;
      const running =
        row.subscriptionId && (row.subscriptionExpiresAt ?? 0) - Date.now() > RENEW_WATCH_MS;
      if (!running)
        await ctx.scheduler.runAfter(0, internal.microsoft.watch, { connectionId: row._id });
      else if (row.autoImport || row.includeShared || row.channelsGranted) {
        await ctx.scheduler.runAfter(0, internal.microsoft.check, { connectionId: row._id });
      }
    }
  },
});

export const bySubscription = internalQuery({
  args: { subscriptionId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("microsoftConnections")
      .withIndex("by_subscription", (q) => q.eq("subscriptionId", args.subscriptionId))
      .take(5),
});

type EventAnswer = { status: number };

/**
 * Change notices from Microsoft. Each names the watch it is for and carries the secret
 * the dashboard gave that watch; a notice that does not match is ignored. Notices say
 * only that something changed, so the Recordings folder is looked in.
 */
export const takeEvent = internalAction({
  args: { body: v.string() },
  handler: async (ctx, args): Promise<EventAnswer> => {
    let event: { value?: { subscriptionId?: string; clientState?: string }[] };
    try {
      event = JSON.parse(args.body);
    } catch {
      return { status: 400 };
    }
    const seen = new Set<string>();
    for (const notice of event.value ?? []) {
      if (!notice.subscriptionId || seen.has(notice.subscriptionId)) continue;
      seen.add(notice.subscriptionId);
      const rows = await ctx.runQuery(internal.microsoft.bySubscription, {
        subscriptionId: notice.subscriptionId,
      });
      // The watch's own secret decides which connection it is, should two share an id.
      const row = rows.find(
        (one) => one.clientState && sameSecret(one.clientState, notice.clientState ?? ""),
      );
      if (!row) continue;
      await ctx.scheduler.runAfter(0, internal.microsoft.check, { connectionId: row._id });
    }
    // Answered quickly whatever happened, so Microsoft does not send it again.
    return { status: 202 };
  },
});

// Bringing a recording in.

const recordingValidator = v.object({
  itemId: v.string(),
  driveId: v.optional(v.string()),
  topic: v.string(),
  startTime: v.number(),
  extension: v.literal("mp4"),
  contentType: v.string(),
  size: v.number(),
  minutes: v.union(v.number(), v.null()),
});

type StartOutcome = "started" | "already" | "duplicate" | "no_toolkit" | "gone";

/** The address the job keeps for a recording. Swapped for a fresh link as it is sent. */
export function contentUrl(itemId: string, driveId?: string): string {
  return `${graphBase()}${itemPath(itemId, driveId)}/content`;
}

/**
 * An upload the team already has with the very same file: the same size in bytes. A
 * recording shared with a member may already be in, brought in by the teammate who
 * organized the meeting. Recordings are hundreds of megabytes, so sizes do not repeat.
 */
async function sameFileIn(
  ctx: Pick<QueryCtx, "db">,
  organizationId: string,
  size: number,
): Promise<Doc<"uploads"> | null> {
  if (size <= 0) return null;
  const same = await ctx.db
    .query("uploads")
    .withIndex("by_organization_and_size", (q) =>
      q.eq("organizationId", organizationId).eq("size", size),
    )
    .take(10);
  return same.find((one) => one.purpose !== "brand") ?? null;
}

/**
 * Starts bringing one recording in: records an upload that is on its way, and has the
 * toolkit stream the file from OneDrive into the team's folder. A recording already
 * brought in, or on its way, is left alone; one that failed is tried again. A shared
 * recording whose file is already in Uploads is marked as in, and not brought in twice.
 */
export const startImport = internalMutation({
  args: { connectionId: v.id("microsoftConnections"), recording: recordingValidator },
  handler: async (ctx, args): Promise<StartOutcome> => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return "gone";
    const { organizationId } = connection;
    const { recording } = args;
    const before = (
      await ctx.db
        .query("microsoftImports")
        .withIndex("by_item", (q) =>
          q.eq("organizationId", organizationId).eq("itemId", recording.itemId),
        )
        .take(10)
    ).find((one) => (one.driveId ?? "") === (recording.driveId ?? ""));
    if (before && before.status !== "failed") return "already";
    if (recording.driveId) {
      const same = await sameFileIn(ctx, organizationId, recording.size);
      if (same) {
        const fields = {
          organizationId,
          connectionId: connection._id,
          itemId: recording.itemId,
          driveId: recording.driveId,
          topic: recording.topic,
          startTime: recording.startTime,
          status: "done" as const,
          uploadId: same._id,
          error: undefined,
        };
        if (before) await ctx.db.patch(before._id, fields);
        else await ctx.db.insert("microsoftImports", fields);
        return "duplicate";
      }
    }

    const fileName = recordingFileName(recording.topic, recording.startTime, recording.extension);
    const key = `uploads/Microsoft/${crypto.randomUUID()}/${safeName(fileName)}`;
    const importId =
      before?._id ??
      (await ctx.db.insert("microsoftImports", {
        organizationId,
        connectionId: connection._id,
        itemId: recording.itemId,
        ...(recording.driveId ? { driveId: recording.driveId } : {}),
        topic: recording.topic,
        startTime: recording.startTime,
        status: "importing",
      }));
    const queued = await enqueueJob(ctx, {
      organizationId,
      stepId: "storage-upload-s3",
      input: {
        file_url: contentUrl(recording.itemId, recording.driveId),
        // The toolkit names files by their key in the bucket: the team's own folder.
        filename: `${teamFolder(organizationId)}${key}`,
      },
      createdBy: connection.userId,
    });
    if (!queued.ok) {
      await ctx.db.patch(importId, {
        status: "failed",
        connectionId: connection._id,
        error:
          queued.code === "no_toolkit"
            ? "Connect your toolkit first, so there is somewhere for recordings to go."
            : queued.message,
      });
      return "no_toolkit";
    }
    const uploadId = await ctx.db.insert("uploads", {
      organizationId,
      key,
      fileName,
      contentType: recording.contentType,
      size: recording.size,
      status: "uploading",
      createdBy: connection.userId,
      source: "microsoft",
    });
    await ctx.db.patch(queued.jobId, { microsoftImportId: importId });
    await ctx.db.patch(importId, {
      connectionId: connection._id,
      status: "importing",
      uploadId,
      jobId: queued.jobId,
      error: undefined,
    });
    await pump(ctx, organizationId);
    return "started";
  },
});

export const importForJob = internalQuery({
  args: { microsoftImportId: v.id("microsoftImports") },
  handler: async (ctx, args) => await ctx.db.get(args.microsoftImportId),
});

/**
 * The address the toolkit fetches a recording from: a short-lived link OneDrive makes
 * for the file, asked for only as the job is sent, so no sign-in is ever kept with it.
 */
export async function downloadUrlFor(
  ctx: ActionCtx,
  microsoftImportId: Id<"microsoftImports">,
): Promise<string> {
  const found: Doc<"microsoftImports"> | null = await ctx.runQuery(
    internal.microsoft.importForJob,
    { microsoftImportId },
  );
  if (!found) throw new MicrosoftSignInError("This recording is no longer being brought in.");
  const token = await accessTokenFor(ctx, found.connectionId);
  const response = await graph(token, itemPath(found.itemId, found.driveId));
  if (response.status === 404 || (found.driveId && response.status === 403)) {
    throw new MicrosoftSignInError(
      found.driveId
        ? "The recording is no longer shared with you."
        : "The recording is no longer in OneDrive.",
    );
  }
  const item = (response.ok ? await response.json() : {}) as DriveItem;
  const link = item["@microsoft.graph.downloadUrl"];
  if (!link) {
    throw new MicrosoftSignInError(
      `OneDrive did not give a download link for the recording (HTTP ${response.status}).`,
    );
  }
  return link;
}

/**
 * The toolkit finished (or gave up on) a recording's job. A finished one becomes a ready
 * upload: it joins the library, its details are read, and upload automations start.
 */
export async function onMicrosoftJobFinished(
  ctx: MutationCtx,
  job: Doc<"jobs">,
  ok: boolean,
  error: string | null,
): Promise<void> {
  if (!job.microsoftImportId) return;
  const found = await ctx.db.get(job.microsoftImportId);
  if (!found || found.jobId !== job._id) return;
  const upload = found.uploadId ? await ctx.db.get(found.uploadId) : null;
  if (!ok || !upload) {
    await ctx.db.patch(found._id, {
      status: "failed",
      error: error ?? "The recording could not be brought in.",
    });
    if (upload && upload.status === "uploading") await ctx.db.delete(upload._id);
    return;
  }
  await ctx.db.patch(found._id, { status: "done" });
  if (upload.status === "ready") return;
  await ctx.db.patch(upload._id, { status: "ready" });
  await addUploadToLibrary(ctx, { ...upload, status: "ready" });
  await ctx.scheduler.runAfter(0, internal.storage.readDetails, { uploadId: upload._id });
}

// Past recordings, by hand.

/** The connection a member made on a team, for the actions below. */
export const mine = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const row = await ctx.db
      .query("microsoftConnections")
      .withIndex("by_member", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", userId),
      )
      .unique();
    if (!row) {
      throw new ConvexError({
        code: "not_connected",
        message: "Connect your Microsoft account first.",
      });
    }
    const imports = await ctx.db
      .query("microsoftImports")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(500);
    return {
      row,
      brought: imports
        .filter((one) => one.status !== "failed")
        .map((one) => itemKey(one.itemId, one.driveId)),
    };
  },
});

type Mine = { row: Doc<"microsoftConnections">; brought: string[] };

/** The caller's Teams recordings from the last 30 days, newest first. */
async function pastRecordingsOf(ctx: ActionCtx, found: Mine) {
  let token: string;
  try {
    token = await accessTokenFor(ctx, found.row._id);
  } catch (error) {
    throw new ConvexError({ code: "microsoft_sign_in", message: (error as Error).message });
  }
  let items: DriveItem[] | null;
  try {
    items = await recordingsIn(ctx, found.row, token);
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    throw new ConvexError({
      code: "unreachable",
      message: "Microsoft could not be reached. Try again.",
    });
  }
  let shared: SharedRecording[] = [];
  if (found.row.includeShared && found.row.sharedGranted) {
    try {
      shared = await sharedRecordingsIn(token);
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      throw new ConvexError({
        code: "unreachable",
        message: "Microsoft could not be reached. Try again.",
      });
    }
  }
  const since = Date.now() - PAST_DAYS * 24 * 60 * 60 * 1000;
  const all: { item: DriveItem; driveId?: string }[] = [
    ...(items ?? []).map((item) => ({ item })),
    ...shared,
  ];
  return all
    .filter(({ item }) => Date.parse(item.createdDateTime ?? "") >= since)
    .map(({ item, driveId }) => pickRecording(item, Date.now(), driveId))
    .filter((one) => one !== null)
    .sort((a, b) => b.startTime - a.startTime);
}

export interface PastRecording {
  itemId: string;
  // Set for a recording of someone else's meeting, shared with the caller.
  driveId?: string;
  shared: boolean;
  topic: string;
  startTime: number;
  minutes: number | null;
  size: number;
  brought: boolean;
}

/** The caller's recent Teams recordings, saying which have been brought in already. */
export const pastRecordings = action({
  args: { organizationId: v.string() },
  handler: async (ctx, args): Promise<PastRecording[]> => {
    const found: Mine = await ctx.runQuery(internal.microsoft.mine, args);
    return (await pastRecordingsOf(ctx, found)).map((one) => ({
      itemId: one.itemId,
      ...(one.driveId ? { driveId: one.driveId } : {}),
      shared: Boolean(one.driveId),
      topic: one.topic,
      startTime: one.startTime,
      minutes: one.minutes,
      size: one.size,
      brought: found.brought.includes(itemKey(one.itemId, one.driveId)),
    }));
  },
});

/** Brings in one of the caller's recent recordings, by the file OneDrive listed. */
export const bringIn = action({
  args: { organizationId: v.string(), itemId: v.string(), driveId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<StartOutcome> => {
    const found: Mine = await ctx.runQuery(internal.microsoft.mine, {
      organizationId: args.organizationId,
    });
    // Looked up again rather than taken from the browser: OneDrive's list is the truth.
    const recording = (await pastRecordingsOf(ctx, found)).find(
      (one) => one.itemId === args.itemId && (one.driveId ?? "") === (args.driveId ?? ""),
    );
    if (!recording) {
      throw new ConvexError({
        code: "not_found",
        message: "OneDrive no longer has that recording.",
      });
    }
    const outcome = await ctx.runMutation(internal.microsoft.startImport, {
      connectionId: found.row._id,
      recording,
    });
    if (outcome === "no_toolkit") {
      throw new ConvexError({
        code: "no_toolkit",
        message: "Connect your toolkit first, so there is somewhere for recordings to go.",
      });
    }
    return outcome;
  },
});
