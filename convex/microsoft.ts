import { teamFolder } from "@ncat-dash/automation-core";
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
} from "./_generated/server";
import { isMember, requireMember } from "./lib/authz";
import { safeName } from "./lib/bucket";
import { decryptSecret, encryptSecret } from "./lib/crypto";
import { addUploadToLibrary } from "./lib/library";
import {
  type DriveItem,
  pickRecording,
  RENEW_WATCH_MS,
  sameSecret,
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
  return `${base}/settings/microsoft?microsoft=${encodeURIComponent(result)}`;
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
          }
        : null,
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

/** Starts a Microsoft sign-in from Settings and returns the address to open. */
export const startLink = mutation({
  args: { organizationId: v.string() },
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
    });
    const url = new URL(`${loginBase()}/oauth2/v2.0/authorize`);
    url.searchParams.set("client_id", process.env.MICROSOFT_CLIENT_ID!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", MICROSOFT_SCOPES.join(" "));
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

/** Forgets the caller's Microsoft account on this team. Recordings brought in stay. */
export const disconnect = mutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const mine = await findMine(ctx, args.organizationId, userId);
    if (!mine) return;
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
async function tokens(form: Record<string, string>): Promise<MicrosoftTokens | null> {
  const response = await fetch(`${loginBase()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
      client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
      scope: MICROSOFT_SCOPES.join(" "),
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
    return { organizationId: row.organizationId, userId: row.userId };
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
    const fields = {
      ...args,
      connectedAt: same?.connectedAt ?? Date.now(),
      autoImport: mine?.autoImport ?? true,
      recordingsFolderId: same?.recordingsFolderId,
      subscriptionId: same?.subscriptionId,
      subscriptionExpiresAt: same?.subscriptionExpiresAt,
      clientState: same?.clientState,
      needsReconnect: undefined,
    };
    let connectionId: Id<"microsoftConnections">;
    if (mine) {
      await ctx.db.replace(mine._id, fields);
      connectionId = mine._id;
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
      const token = await tokens({
        grant_type: "authorization_code",
        code: args.code,
        redirect_uri: redirectUri(),
      });
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
      });
      return settingsUrl(result);
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
  const token = await tokens({
    grant_type: "refresh_token",
    refresh_token: await decryptSecret(row.refreshTokenCipher),
  });
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
    const link = body["@odata.nextLink"];
    next = link ? link.slice(link.indexOf(graphBase()) === 0 ? graphBase().length : 0) : null;
    if (next && !next.startsWith("/")) next = null;
  }
  return items.sort(
    (a, b) => Date.parse(b.createdDateTime ?? "") - Date.parse(a.createdDateTime ?? ""),
  );
}

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

/** Looks in the member's Recordings folder and brings in what is new since they connected. */
export const check = internalAction({
  args: { connectionId: v.id("microsoftConnections") },
  handler: async (ctx, args) => {
    if (!ready()) return;
    const row = await ctx.runQuery(internal.microsoft.connection, args);
    if (!row || !row.autoImport || row.needsReconnect) return;
    let token: string;
    try {
      token = await accessTokenFor(ctx, row._id);
    } catch {
      return;
    }
    const items = await recordingsIn(ctx, row, token).catch(() => null);
    await ctx.runMutation(internal.microsoft.patchConnection, {
      connectionId: row._id,
      fields: { lastCheckedAt: Date.now() },
    });
    if (!items) return;
    const since = row.connectedAt - GRACE_MS;
    for (const item of items) {
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
      else if (row.autoImport) {
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
      .first(),
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
      const row = await ctx.runQuery(internal.microsoft.bySubscription, {
        subscriptionId: notice.subscriptionId,
      });
      if (!row?.clientState || !sameSecret(row.clientState, notice.clientState ?? "")) continue;
      await ctx.scheduler.runAfter(0, internal.microsoft.check, { connectionId: row._id });
    }
    // Answered quickly whatever happened, so Microsoft does not send it again.
    return { status: 202 };
  },
});

// Bringing a recording in.

const recordingValidator = v.object({
  itemId: v.string(),
  topic: v.string(),
  startTime: v.number(),
  extension: v.literal("mp4"),
  contentType: v.string(),
  size: v.number(),
  minutes: v.union(v.number(), v.null()),
});

type StartOutcome = "started" | "already" | "no_toolkit" | "gone";

/** The address the job keeps for a recording. Swapped for a fresh link as it is sent. */
export function contentUrl(itemId: string): string {
  return `${graphBase()}/me/drive/items/${encodeURIComponent(itemId)}/content`;
}

/**
 * Starts bringing one recording in: records an upload that is on its way, and has the
 * toolkit stream the file from OneDrive into the team's folder. A recording already
 * brought in, or on its way, is left alone; one that failed is tried again.
 */
export const startImport = internalMutation({
  args: { connectionId: v.id("microsoftConnections"), recording: recordingValidator },
  handler: async (ctx, args): Promise<StartOutcome> => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return "gone";
    const { organizationId } = connection;
    const { recording } = args;
    const before = await ctx.db
      .query("microsoftImports")
      .withIndex("by_item", (q) =>
        q.eq("organizationId", organizationId).eq("itemId", recording.itemId),
      )
      .first();
    if (before && before.status !== "failed") return "already";

    const fileName = recordingFileName(recording.topic, recording.startTime, recording.extension);
    const key = `uploads/${crypto.randomUUID()}/${safeName(fileName)}`;
    const importId =
      before?._id ??
      (await ctx.db.insert("microsoftImports", {
        organizationId,
        connectionId: connection._id,
        itemId: recording.itemId,
        topic: recording.topic,
        startTime: recording.startTime,
        status: "importing",
      }));
    const queued = await enqueueJob(ctx, {
      organizationId,
      stepId: "storage-upload-s3",
      input: {
        file_url: contentUrl(recording.itemId),
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
  const response = await graph(token, `/me/drive/items/${encodeURIComponent(found.itemId)}`);
  if (response.status === 404) {
    throw new MicrosoftSignInError("The recording is no longer in OneDrive.");
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
      brought: imports.filter((one) => one.status !== "failed").map((one) => one.itemId),
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
  const since = Date.now() - PAST_DAYS * 24 * 60 * 60 * 1000;
  return (items ?? [])
    .filter((item) => Date.parse(item.createdDateTime ?? "") >= since)
    .map((item) => pickRecording(item, Date.now()))
    .filter((one) => one !== null);
}

export interface PastRecording {
  itemId: string;
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
      topic: one.topic,
      startTime: one.startTime,
      minutes: one.minutes,
      size: one.size,
      brought: found.brought.includes(one.itemId),
    }));
  },
});

/** Brings in one of the caller's recent recordings, by the file OneDrive listed. */
export const bringIn = action({
  args: { organizationId: v.string(), itemId: v.string() },
  handler: async (ctx, args): Promise<StartOutcome> => {
    const found: Mine = await ctx.runQuery(internal.microsoft.mine, {
      organizationId: args.organizationId,
    });
    // Looked up again rather than taken from the browser: OneDrive's list is the truth.
    const recording = (await pastRecordingsOf(ctx, found)).find(
      (one) => one.itemId === args.itemId,
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
