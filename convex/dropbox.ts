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
  type QueryCtx,
} from "./_generated/server";
import { isMember, requireMember } from "./lib/authz";
import { bucketOf, presign, safeName, storageConnection } from "./lib/bucket";
import { decryptSecret, encryptSecret } from "./lib/crypto";
import {
  apiArg,
  dropboxName,
  type DropboxEntry,
  nextPiece,
  PIECE_BYTES,
  PIECES_PER_TURN,
  type PickedFile,
  pickFile,
  sameSecret,
  sendFolderOf,
  signatureOf,
} from "./lib/dropbox";
import { addUploadToLibrary } from "./lib/library";
import { enqueueJob, pump } from "./lib/queue";

/**
 * Dropbox, both ways. The dashboard has ONE Dropbox app (DROPBOX_APP_KEY and
 * DROPBOX_APP_SECRET), set up once by whoever runs it. Each member connects their own
 * Dropbox from Settings and picks the folders to watch: their own, or team folders on a
 * Dropbox team account. Dropbox tells the dashboard when something changes; each new
 * video, sound or picture in a watched folder is streamed by the team's toolkit straight
 * from Dropbox into the team's folder, and becomes an upload like any other. A check
 * every 15 minutes catches anything a notice missed.
 *
 * The other way: an automation switched to "Send to Dropbox" sends each finished run's
 * files to a Dropbox folder, in pieces for big files.
 */

/** A Dropbox sign-in started from Settings must come back within this long. */
const START_TTL_MS = 15 * 60 * 1000;
/** An access token with less than this left is renewed before it is used. */
const RENEW_MS = 5 * 60 * 1000;
/** At most this many folders are watched per member. */
const MAX_FOLDERS = 100;
/** At most this many files are listed when looking through watched folders by hand. */
const MAX_LISTED = 2000;
/** At most this many files are brought over in one press. */
const MAX_BRING = 500;

/** What the dashboard asks Dropbox for: who you are, reading files, and adding files. */
export const DROPBOX_SCOPES = [
  "account_info.read",
  "files.metadata.read",
  "files.content.read",
  "files.content.write",
];

function base(name: string, fallback: string): string {
  return (process.env[name] ?? fallback).replace(/\/+$/, "");
}
const authBase = () => base("DROPBOX_AUTH_URL", "https://www.dropbox.com");
const apiBase = () => base("DROPBOX_API_URL", "https://api.dropboxapi.com");
const contentBase = () => base("DROPBOX_CONTENT_URL", "https://content.dropboxapi.com");

function site(): string {
  return (process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
}

/** Where Dropbox sends people back to after they sign in. */
export function redirectUri(): string {
  return `${site()}/dropbox/callback`;
}

/** Whether this dashboard has a Dropbox app set up. */
function ready(): boolean {
  return Boolean(process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET);
}

/** Back to Settings, saying how the Dropbox sign-in went. */
export function settingsUrl(result: string): string {
  const siteUrl = (process.env.SITE_URL ?? "").replace(/\/+$/, "");
  return `${siteUrl}/settings/dropbox?dropbox=${encodeURIComponent(result)}`;
}

function randomText(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function findMine(ctx: Pick<QueryCtx, "db">, organizationId: string, userId: string) {
  return await ctx.db
    .query("dropboxConnections")
    .withIndex("by_member", (q) => q.eq("organizationId", organizationId).eq("userId", userId))
    .unique();
}

async function foldersOf(ctx: Pick<QueryCtx, "db">, connectionId: Id<"dropboxConnections">) {
  return await ctx.db
    .query("dropboxFolders")
    .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
    .take(MAX_FOLDERS);
}

/** What Settings shows: the viewer's own Dropbox, its folders, the team's, what came in. */
export const forTeam = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    if (!(await isMember(ctx, args.organizationId))) return null;
    const { userId } = await requireMember(ctx, args.organizationId);
    const connections = await ctx.db
      .query("dropboxConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(50);
    const mine = connections.find((one) => one.userId === userId) ?? null;
    const others = [];
    for (const one of connections) {
      if (one.userId === userId) continue;
      const by = await ctx.runQuery(components.betterAuth.members.contact, { userId: one.userId });
      others.push({ name: one.name, memberName: by?.name ?? null });
    }
    const imports = await ctx.db
      .query("dropboxImports")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(20);
    const sends = await ctx.db
      .query("dropboxSends")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(10);
    return {
      ready: ready(),
      me: mine
        ? {
            name: mine.name,
            email: mine.email,
            connectedAt: mine.connectedAt,
            autoImport: mine.autoImport,
            needsReconnect: mine.needsReconnect ?? false,
            teamSpace: Boolean(mine.rootNamespaceId),
            folders: (await foldersOf(ctx, mine._id)).map((one) => ({
              _id: one._id,
              path: one.path,
              recursive: one.recursive !== false,
            })),
          }
        : null,
      others,
      imports: imports.map((one) => ({
        _id: one._id,
        name: one.name,
        path: one.path,
        status: one.status,
        error: one.error ?? null,
      })),
      sends: sends.map((one) => ({
        _id: one._id,
        name: one.name,
        automationName: one.automationName,
        folder: one.folder,
        dropboxPath: one.dropboxPath ?? null,
        size: one.size,
        offset: one.offset,
        status: one.status,
        error: one.error ?? null,
      })),
    };
  },
});

/** Starts a Dropbox sign-in from Settings and returns the address to open. */
export const startLink = mutation({
  args: { organizationId: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    if (!ready()) {
      throw new ConvexError({
        code: "not_ready",
        message: "Dropbox is not set up on this dashboard yet.",
      });
    }
    const nonce = randomText();
    await ctx.db.insert("dropboxLinkStarts", {
      nonce,
      organizationId: args.organizationId,
      userId,
      createdAt: Date.now(),
    });
    const url = new URL(`${authBase()}/oauth2/authorize`);
    url.searchParams.set("client_id", process.env.DROPBOX_APP_KEY!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri());
    // Offline: a refresh token, so files keep coming in with nobody signed in.
    url.searchParams.set("token_access_type", "offline");
    url.searchParams.set("scope", DROPBOX_SCOPES.join(" "));
    url.searchParams.set("state", nonce);
    return url.toString();
  },
});

/** Whether new files in the caller's watched folders come in by themselves. */
export const setAutoImport = mutation({
  args: { organizationId: v.string(), autoImport: v.boolean() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const mine = await findMine(ctx, args.organizationId, userId);
    if (!mine) {
      throw new ConvexError({ code: "not_connected", message: "Connect your Dropbox first." });
    }
    await ctx.db.patch(mine._id, { autoImport: args.autoImport });
    // Switched back on: what was added while it was off waits to be brought in by hand.
    if (args.autoImport && !mine.autoImport) {
      await ctx.scheduler.runAfter(0, internal.dropbox.skipAhead, { connectionId: mine._id });
    }
  },
});

/** Stops watching one folder. What came in from it stays. */
export const removeFolder = mutation({
  args: { folderId: v.id("dropboxFolders") },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder) return;
    const { userId } = await requireMember(ctx, folder.organizationId);
    const connection = await ctx.db.get(folder.connectionId);
    if (!connection || connection.userId !== userId) {
      throw new ConvexError({ code: "forbidden", message: "That folder is someone else's." });
    }
    await ctx.db.delete(folder._id);
  },
});

/**
 * Forgets the caller's Dropbox on this team: its watched folders, and automations that
 * sent files to it stop doing so. Files brought in stay.
 */
export const disconnect = mutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const mine = await findMine(ctx, args.organizationId, userId);
    if (!mine) return;
    for (const folder of await foldersOf(ctx, mine._id)) await ctx.db.delete(folder._id);
    const automations = await ctx.db
      .query("automations")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(500);
    for (const automation of automations) {
      if (automation.dropboxSend?.connectionId === mine._id) {
        await ctx.db.patch(automation._id, { dropboxSend: undefined });
      }
    }
    await ctx.db.delete(mine._id);
    await ctx.scheduler.runAfter(0, internal.dropbox.revoke, {
      refreshTokenCipher: mine.refreshTokenCipher,
    });
  },
});

interface DropboxTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  account_id?: string;
}

/** Trades a code or a refresh token for an access token. Null when Dropbox refuses. */
async function tokens(form: Record<string, string>): Promise<DropboxTokens | null> {
  const response = await fetch(`${apiBase()}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DROPBOX_APP_KEY ?? "",
      client_secret: process.env.DROPBOX_APP_SECRET ?? "",
      ...form,
    }).toString(),
  });
  const token = (response.ok ? await response.json() : {}) as Partial<DropboxTokens>;
  if (!token.access_token) return null;
  return token as DropboxTokens;
}

/** Tells Dropbox the dashboard no longer needs the sign-in. */
export const revoke = internalAction({
  args: { refreshTokenCipher: v.string() },
  handler: async (_ctx, args) => {
    if (!ready()) return;
    try {
      const token = await tokens({
        grant_type: "refresh_token",
        refresh_token: await decryptSecret(args.refreshTokenCipher),
      });
      if (!token) return;
      await fetch(`${apiBase()}/2/auth/token/revoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${token.access_token}` },
      });
    } catch {
      // A sign-in nobody uses does no harm; Dropbox lists it under connected apps.
    }
  },
});

// Signing in.

/** Uses up a started sign-in. Null when it is unknown or too old. */
export const takeStart = internalMutation({
  args: { nonce: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("dropboxLinkStarts")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (Date.now() - row.createdAt > START_TTL_MS) return null;
    return { organizationId: row.organizationId, userId: row.userId };
  },
});

/** Saves a Dropbox a member connected. Returns how it went, for Settings. */
export const saveConnection = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    accountId: v.string(),
    email: v.string(),
    name: v.string(),
    accessTokenCipher: v.string(),
    refreshTokenCipher: v.string(),
    expiresAt: v.number(),
    rootNamespaceId: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const role = await ctx.runQuery(components.betterAuth.members.roleFor, {
      userId: args.userId,
      organizationId: args.organizationId,
    });
    if (!role) return "not_member";
    // One Dropbox belongs to one team, so each file has one home.
    const elsewhere = await ctx.db
      .query("dropboxConnections")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .take(10);
    for (const one of elsewhere) {
      if (one.organizationId !== args.organizationId) return "taken";
      if (one.userId !== args.userId) return "taken_here";
    }
    const mine = await findMine(ctx, args.organizationId, args.userId);
    // The same Dropbox signing in again keeps its folders; another one starts over.
    const same = mine?.accountId === args.accountId ? mine : null;
    const fields = {
      ...args,
      connectedAt: same?.connectedAt ?? Date.now(),
      autoImport: mine?.autoImport ?? true,
      needsReconnect: undefined,
    };
    if (mine) {
      if (!same) {
        for (const folder of await foldersOf(ctx, mine._id)) await ctx.db.delete(folder._id);
      }
      await ctx.db.replace(mine._id, fields);
    } else {
      await ctx.db.insert("dropboxConnections", fields);
    }
    return "connected";
  },
});

/** Finishes a Dropbox sign-in: trades the code for tokens, finds the account, saves it. */
export const finishLink = internalAction({
  args: { code: v.string(), state: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const start = await ctx.runMutation(internal.dropbox.takeStart, { nonce: args.state });
    if (!start) return settingsUrl("expired");
    if (!ready()) return settingsUrl("not_ready");
    try {
      const token = await tokens({
        grant_type: "authorization_code",
        code: args.code,
        redirect_uri: redirectUri(),
      });
      if (!token?.refresh_token) return settingsUrl("refused");
      const meResponse = await fetch(`${apiBase()}/2/users/get_current_account`, {
        method: "POST",
        headers: { authorization: `Bearer ${token.access_token}` },
      });
      if (!meResponse.ok) return settingsUrl("refused");
      const me = (await meResponse.json()) as {
        account_id?: string;
        email?: string;
        name?: { display_name?: string };
        root_info?: { root_namespace_id?: string; home_namespace_id?: string };
      };
      if (!me.account_id) return settingsUrl("refused");
      const root = me.root_info?.root_namespace_id;
      const teamSpace = root && root !== me.root_info?.home_namespace_id ? root : undefined;
      const result = await ctx.runMutation(internal.dropbox.saveConnection, {
        organizationId: start.organizationId,
        userId: start.userId,
        accountId: me.account_id,
        email: me.email ?? "",
        name: me.name?.display_name || me.email || "Dropbox",
        accessTokenCipher: await encryptSecret(token.access_token),
        refreshTokenCipher: await encryptSecret(token.refresh_token),
        expiresAt: Date.now() + (token.expires_in ?? 14_400) * 1000,
        ...(teamSpace ? { rootNamespaceId: teamSpace } : {}),
      });
      return settingsUrl(result);
    } catch {
      return settingsUrl("unreachable");
    }
  },
});

// Tokens and requests.

export const connection = internalQuery({
  args: { connectionId: v.id("dropboxConnections") },
  handler: async (ctx, args) => await ctx.db.get(args.connectionId),
});

export const patchConnection = internalMutation({
  args: {
    connectionId: v.id("dropboxConnections"),
    fields: v.object({
      accessTokenCipher: v.optional(v.string()),
      expiresAt: v.optional(v.number()),
      needsReconnect: v.optional(v.boolean()),
      lastCheckedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { connectionId, fields }) => {
    if (await ctx.db.get(connectionId)) await ctx.db.patch(connectionId, fields);
  },
});

export class DropboxSignInError extends Error {}

/** A working access token for a connected Dropbox, renewed when it runs low. */
export async function accessTokenFor(
  ctx: ActionCtx,
  connectionId: Id<"dropboxConnections">,
): Promise<string> {
  const row: Doc<"dropboxConnections"> | null = await ctx.runQuery(internal.dropbox.connection, {
    connectionId,
  });
  if (!row) throw new DropboxSignInError("This Dropbox is no longer connected.");
  if (row.expiresAt - Date.now() > RENEW_MS) return await decryptSecret(row.accessTokenCipher);
  const token = await tokens({
    grant_type: "refresh_token",
    refresh_token: await decryptSecret(row.refreshTokenCipher),
  });
  if (!token) {
    await ctx.runMutation(internal.dropbox.patchConnection, {
      connectionId,
      fields: { needsReconnect: true },
    });
    throw new DropboxSignInError(
      "Dropbox no longer accepts this account's sign-in. Connect it again in Settings.",
    );
  }
  await ctx.runMutation(internal.dropbox.patchConnection, {
    connectionId,
    fields: {
      accessTokenCipher: await encryptSecret(token.access_token),
      expiresAt: Date.now() + (token.expires_in ?? 14_400) * 1000,
    },
  });
  return token.access_token;
}

/**
 * For a Dropbox team account, requests are read from the top of the team space, so team
 * folders and the member's own folder show side by side. `home` reads from the member's
 * own folder instead, for files sent back to a folder nobody picked.
 */
function pathRoot(row: Doc<"dropboxConnections">, home = false): Record<string, string> {
  if (!row.rootNamespaceId || home) return {};
  return {
    "dropbox-api-path-root": JSON.stringify({ ".tag": "root", root: row.rootNamespaceId }),
  };
}

/** One of Dropbox's RPC requests: JSON in, JSON out. */
async function rpc(
  token: string,
  row: Doc<"dropboxConnections">,
  path: string,
  body: unknown,
  options: { home?: boolean } = {},
): Promise<Response> {
  return await fetch(`${apiBase()}/2/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...pathRoot(row, options.home),
    },
    body: JSON.stringify(body),
  });
}

/** What Dropbox said went wrong, from a 409 answer: "path/not_found/..." and the like. */
async function problemOf(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as { error_summary?: string };
    return body.error_summary ?? "";
  } catch {
    return "";
  }
}

interface ListPage {
  entries?: DropboxEntry[];
  cursor?: string;
  has_more?: boolean;
}

// Choosing folders.

export const mine = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const row = await findMine(ctx, args.organizationId, userId);
    if (!row) {
      throw new ConvexError({ code: "not_connected", message: "Connect your Dropbox first." });
    }
    return { row, folders: await foldersOf(ctx, row._id) };
  },
});

type Mine = { row: Doc<"dropboxConnections">; folders: Doc<"dropboxFolders">[] };

async function signedIn(ctx: ActionCtx, row: Doc<"dropboxConnections">): Promise<string> {
  try {
    return await accessTokenFor(ctx, row._id);
  } catch (error) {
    throw new ConvexError({ code: "dropbox_sign_in", message: (error as Error).message });
  }
}

export interface DropboxFolderChoice {
  name: string;
  path: string;
  // A team folder (or a folder shared with the member), not one of their own.
  shared: boolean;
}

/** The folders inside one Dropbox folder ("" is the top), for picking ones to watch. */
export const browse = action({
  args: { organizationId: v.string(), path: v.string() },
  handler: async (ctx, args): Promise<DropboxFolderChoice[]> => {
    const found: Mine = await ctx.runQuery(internal.dropbox.mine, {
      organizationId: args.organizationId,
    });
    const token = await signedIn(ctx, found.row);
    const folders: DropboxFolderChoice[] = [];
    let response = await rpc(token, found.row, "files/list_folder", {
      path: args.path,
      recursive: false,
      include_deleted: false,
      limit: 2000,
    });
    for (let page = 0; page < 3; page++) {
      if (!response.ok) {
        const problem = await problemOf(response);
        throw new ConvexError({
          code: "dropbox_refused",
          message: problem.startsWith("path/not_found")
            ? "That folder is no longer in Dropbox."
            : `Dropbox did not list that folder (HTTP ${response.status}).`,
        });
      }
      const body = (await response.json()) as ListPage & {
        entries?: (DropboxEntry & { sharing_info?: unknown; shared_folder_id?: string })[];
      };
      for (const entry of body.entries ?? []) {
        if (entry[".tag"] !== "folder" || !entry.name) continue;
        folders.push({
          name: entry.name,
          path: entry.path_display ?? entry.path_lower ?? `/${entry.name}`,
          shared: Boolean(entry.sharing_info || entry.shared_folder_id),
        });
      }
      if (!body.has_more || !body.cursor) break;
      response = await rpc(token, found.row, "files/list_folder/continue", {
        cursor: body.cursor,
      });
    }
    return folders.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const saveFolder = internalMutation({
  args: {
    connectionId: v.id("dropboxConnections"),
    path: v.string(),
    cursor: v.string(),
    recursive: v.optional(v.boolean()),
  },
  returns: v.union(v.id("dropboxFolders"), v.null()),
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return null;
    const folders = await foldersOf(ctx, connection._id);
    const pathLower = args.path.toLowerCase();
    const before = folders.find((one) => one.pathLower === pathLower);
    if (before) return before._id;
    if (folders.length >= MAX_FOLDERS) {
      throw new ConvexError({
        code: "too_many",
        message: `You can watch up to ${MAX_FOLDERS} folders. Stop watching one first.`,
      });
    }
    return await ctx.db.insert("dropboxFolders", {
      organizationId: connection.organizationId,
      connectionId: connection._id,
      path: args.path,
      pathLower,
      cursor: args.cursor,
      ...(args.recursive === false ? { recursive: false } : {}),
      addedAt: Date.now(),
    });
  },
});

/**
 * Starts watching a folder and the folders inside it. Only files added from now on come
 * in by themselves; what is already there can be brought over from the list in Settings.
 */
export const addFolder = action({
  args: { organizationId: v.string(), path: v.string() },
  handler: async (ctx, args): Promise<Id<"dropboxFolders"> | null> => {
    const found: Mine = await ctx.runQuery(internal.dropbox.mine, {
      organizationId: args.organizationId,
    });
    const token = await signedIn(ctx, found.row);
    let path = args.path.replace(/\/+$/, "");
    if (path) {
      const meta = await rpc(token, found.row, "files/get_metadata", { path });
      const entry = (meta.ok ? await meta.json() : {}) as DropboxEntry;
      if (entry[".tag"] !== "folder") {
        throw new ConvexError({ code: "not_found", message: "That folder is not in Dropbox." });
      }
      path = entry.path_display ?? path;
    }
    const latest = await rpc(token, found.row, "files/list_folder/get_latest_cursor", {
      path,
      recursive: true,
      include_deleted: false,
    });
    const cursor = ((latest.ok ? await latest.json() : {}) as { cursor?: string }).cursor;
    if (!cursor) {
      throw new ConvexError({
        code: "dropbox_refused",
        message: `Dropbox did not let the dashboard watch that folder (HTTP ${latest.status}).`,
      });
    }
    return await ctx.runMutation(internal.dropbox.saveFolder, {
      connectionId: found.row._id,
      path: path || "/",
      cursor,
    });
  },
});

// Reading the whole Dropbox: one list of the folders that hold media, to tick and bring in.

/** How many entries a scan reads at most, so a huge Dropbox still answers in time. */
const MAX_SCANNED = 40_000;
/** How many folders a scan lists, the fullest first. */
const MAX_SCAN_FOLDERS = 300;
/** How many folders one press can bring in. */
const MAX_PULL_FOLDERS = 50;

export interface DropboxMediaFolder {
  path: string;
  name: string;
  /** Videos, sounds and pictures right in this folder. */
  files: number;
  /** Of those, how many are not in Uploads yet. */
  fresh: number;
  watched: boolean;
}

/** "/A/B/clip.mp4" gives "/A/B"; a file at the very top gives "/". */
function folderOfFile(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut > 0 ? path.slice(0, cut) : "/";
}

/**
 * Reads the caller's whole Dropbox (team folders too, on a team account) and lists every
 * folder that has videos, sounds or pictures right in it, with how many and how many
 * are new to Uploads. Folders already watched are marked.
 */
export const scan = action({
  args: { organizationId: v.string() },
  handler: async (ctx, args): Promise<{ folders: DropboxMediaFolder[]; partial: boolean }> => {
    const found: Mine = await ctx.runQuery(internal.dropbox.mine, {
      organizationId: args.organizationId,
    });
    const done = await ctx.runQuery(internal.dropbox.brought, {
      organizationId: args.organizationId,
    });
    const files = new Set(done.files);
    const hashes = new Set(done.hashes);
    const token = await signedIn(ctx, found.row);
    const counts = new Map<string, DropboxMediaFolder>();
    let read = 0;
    let partial = false;
    let response = await rpc(token, found.row, "files/list_folder", {
      path: "",
      recursive: true,
      include_deleted: false,
      limit: 2000,
    });
    for (;;) {
      if (!response.ok) {
        throw new ConvexError({
          code: "dropbox_refused",
          message: `Dropbox did not list your files (HTTP ${response.status}).`,
        });
      }
      const body = (await response.json()) as ListPage;
      for (const entry of body.entries ?? []) {
        const picked = pickFile(entry);
        if (!picked) continue;
        const path = folderOfFile(picked.path);
        const key = path.toLowerCase();
        const row = counts.get(key) ?? {
          path,
          name: path === "/" ? "Dropbox" : path.slice(path.lastIndexOf("/") + 1),
          files: 0,
          fresh: 0,
          watched: false,
        };
        row.files++;
        const isIn =
          files.has(`${picked.fileId}:${picked.contentHash}`) ||
          (picked.contentHash !== "" && hashes.has(picked.contentHash));
        if (!isIn) row.fresh++;
        counts.set(key, row);
      }
      read += body.entries?.length ?? 0;
      if (!body.has_more || !body.cursor) break;
      if (read >= MAX_SCANNED) {
        partial = true;
        break;
      }
      response = await rpc(token, found.row, "files/list_folder/continue", { cursor: body.cursor });
    }
    const watched = new Set(found.folders.map((one) => one.pathLower));
    for (const [key, row] of counts) row.watched = watched.has(key);
    const folders = [...counts.values()]
      .sort((a, b) => b.files - a.files || a.path.localeCompare(b.path))
      .slice(0, MAX_SCAN_FOLDERS);
    return { folders, partial };
  },
});

/**
 * The one button: watches each ticked folder (only the files right in it, as the scan
 * counted them) and brings in what is already there and not in Uploads yet.
 */
export const pullIn = action({
  args: { organizationId: v.string(), paths: v.array(v.string()) },
  handler: async (ctx, args): Promise<{ watching: number; started: number; more: boolean }> => {
    if (args.paths.length > MAX_PULL_FOLDERS) {
      throw new ConvexError({
        code: "too_many",
        message: `Pick up to ${MAX_PULL_FOLDERS} folders at a time.`,
      });
    }
    const found: Mine = await ctx.runQuery(internal.dropbox.mine, {
      organizationId: args.organizationId,
    });
    const token = await signedIn(ctx, found.row);
    let watching = 0;
    let started = 0;
    let more = false;
    for (const asked of args.paths) {
      let path = asked === "/" ? "" : asked.replace(/\/+$/, "");
      if (path && !path.startsWith("/")) continue;
      // Each folder is looked up in Dropbox again rather than taken on trust.
      if (path) {
        const meta = await rpc(token, found.row, "files/get_metadata", { path });
        const entry = (meta.ok ? await meta.json() : {}) as DropboxEntry;
        if (entry[".tag"] !== "folder") {
          throw new ConvexError({
            code: "not_found",
            message: `${asked} is not in your Dropbox any more.`,
          });
        }
        path = entry.path_display ?? path;
      }
      const latest = await rpc(token, found.row, "files/list_folder/get_latest_cursor", {
        path,
        recursive: false,
        include_deleted: false,
      });
      const cursor = ((latest.ok ? await latest.json() : {}) as { cursor?: string }).cursor;
      if (!cursor) {
        throw new ConvexError({
          code: "not_found",
          message: `${asked} is not in your Dropbox any more.`,
        });
      }
      const already = found.folders.some((one) => one.pathLower === (path || "/").toLowerCase());
      if (!already) {
        await ctx.runMutation(internal.dropbox.saveFolder, {
          connectionId: found.row._id,
          path: path || "/",
          cursor,
          recursive: false,
        });
      }
      watching++;
      let response = await rpc(token, found.row, "files/list_folder", {
        path,
        recursive: false,
        include_deleted: false,
        limit: 2000,
      });
      for (let page = 0; page < 10; page++) {
        if (!response.ok) break;
        const body = (await response.json()) as ListPage;
        for (const entry of body.entries ?? []) {
          const file = pickFile(entry);
          if (!file) continue;
          if (started >= MAX_BRING) {
            more = true;
            break;
          }
          const outcome = await ctx.runMutation(internal.dropbox.startImport, {
            connectionId: found.row._id,
            file,
          });
          if (outcome === "no_toolkit") {
            throw new ConvexError({
              code: "no_toolkit",
              message: "Connect your toolkit first, so there is somewhere for files to go.",
            });
          }
          if (outcome === "started") started++;
        }
        if (more || !body.has_more || !body.cursor) break;
        response = await rpc(token, found.row, "files/list_folder/continue", {
          cursor: body.cursor,
        });
      }
    }
    return { watching, started, more };
  },
});

// Watching.

export const watchedFolders = internalQuery({
  args: { connectionId: v.id("dropboxConnections") },
  handler: async (ctx, args) => await foldersOf(ctx, args.connectionId),
});

export const saveCursor = internalMutation({
  args: { folderId: v.id("dropboxFolders"), cursor: v.string() },
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.folderId)) await ctx.db.patch(args.folderId, { cursor: args.cursor });
  },
});

/** A folder's path as Dropbox's requests take it: "" for the very top. */
function requestPath(folder: Pick<Doc<"dropboxFolders">, "path">): string {
  return folder.path === "/" ? "" : folder.path;
}

async function latestCursor(
  token: string,
  row: Doc<"dropboxConnections">,
  folder: Doc<"dropboxFolders">,
): Promise<string | null> {
  const latest = await rpc(token, row, "files/list_folder/get_latest_cursor", {
    path: requestPath(folder),
    recursive: folder.recursive !== false,
    include_deleted: false,
  });
  return ((latest.ok ? await latest.json() : {}) as { cursor?: string }).cursor ?? null;
}

/**
 * The files added or changed in a watched folder since it was last read, and where to
 * read from next time. A folder whose place Dropbox no longer knows starts again from now.
 */
async function changesIn(
  token: string,
  row: Doc<"dropboxConnections">,
  folder: Doc<"dropboxFolders">,
): Promise<{ files: PickedFile[]; cursor: string | null }> {
  if (!folder.cursor) return { files: [], cursor: await latestCursor(token, row, folder) };
  const files: PickedFile[] = [];
  let cursor = folder.cursor;
  for (let page = 0; page < 10; page++) {
    const response = await rpc(token, row, "files/list_folder/continue", { cursor });
    if (response.status === 409) {
      const problem = await problemOf(response);
      if (problem.startsWith("reset")) {
        return { files, cursor: await latestCursor(token, row, folder) };
      }
      return { files, cursor: null };
    }
    if (!response.ok) return { files, cursor: page === 0 ? null : cursor };
    const body = (await response.json()) as ListPage;
    for (const entry of body.entries ?? []) {
      const picked = pickFile(entry);
      if (picked) files.push(picked);
    }
    if (body.cursor) cursor = body.cursor;
    if (!body.has_more) break;
  }
  return { files, cursor };
}

/** Looks in each of a member's watched folders and brings in what is new. */
export const check = internalAction({
  args: { connectionId: v.id("dropboxConnections") },
  handler: async (ctx, args) => {
    if (!ready()) return;
    const row = await ctx.runQuery(internal.dropbox.connection, args);
    if (!row || row.needsReconnect || !row.autoImport) return;
    let token: string;
    try {
      token = await accessTokenFor(ctx, row._id);
    } catch {
      return;
    }
    const folders = await ctx.runQuery(internal.dropbox.watchedFolders, args);
    const seen = new Set<string>();
    for (const folder of folders) {
      let changes: { files: PickedFile[]; cursor: string | null };
      try {
        changes = await changesIn(token, row, folder);
      } catch {
        continue;
      }
      for (const file of changes.files) {
        if (seen.has(file.fileId)) continue;
        seen.add(file.fileId);
        await ctx.runMutation(internal.dropbox.startImport, { connectionId: row._id, file });
      }
      if (changes.cursor && changes.cursor !== folder.cursor) {
        await ctx.runMutation(internal.dropbox.saveCursor, {
          folderId: folder._id,
          cursor: changes.cursor,
        });
      }
    }
    await ctx.runMutation(internal.dropbox.patchConnection, {
      connectionId: row._id,
      fields: { lastCheckedAt: Date.now() },
    });
  },
});

/** Moves every watched folder's place up to now, so older changes are not brought in. */
export const skipAhead = internalAction({
  args: { connectionId: v.id("dropboxConnections") },
  handler: async (ctx, args) => {
    if (!ready()) return;
    const row = await ctx.runQuery(internal.dropbox.connection, args);
    if (!row) return;
    let token: string;
    try {
      token = await accessTokenFor(ctx, row._id);
    } catch {
      return;
    }
    for (const folder of await ctx.runQuery(internal.dropbox.watchedFolders, args)) {
      const cursor = await latestCursor(token, row, folder).catch(() => null);
      if (cursor)
        await ctx.runMutation(internal.dropbox.saveCursor, { folderId: folder._id, cursor });
    }
  },
});

export const watched = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("dropboxConnections").take(500),
});

/** Every 15 minutes: looks in each watched folder in case a notice from Dropbox was lost. */
export const sweep = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!ready()) return;
    const rows = await ctx.runQuery(internal.dropbox.watched, {});
    for (const row of rows) {
      if (row.needsReconnect || !row.autoImport) continue;
      await ctx.scheduler.runAfter(0, internal.dropbox.check, { connectionId: row._id });
    }
  },
});

export const byAccount = internalQuery({
  args: { accountId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("dropboxConnections")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .take(5),
});

/**
 * Notices from Dropbox. Each is signed with the app's secret; one that is not is
 * refused. A notice only names the accounts whose files changed, so their watched
 * folders are looked in.
 */
export const takeEvent = internalAction({
  args: { body: v.string(), signature: v.string() },
  handler: async (ctx, args): Promise<{ status: number }> => {
    const secret = process.env.DROPBOX_APP_SECRET;
    if (!secret) return { status: 403 };
    if (!sameSecret(await signatureOf(secret, args.body), args.signature.toLowerCase())) {
      return { status: 403 };
    }
    let event: { list_folder?: { accounts?: string[] } };
    try {
      event = JSON.parse(args.body);
    } catch {
      return { status: 400 };
    }
    for (const accountId of new Set(event.list_folder?.accounts ?? [])) {
      for (const row of await ctx.runQuery(internal.dropbox.byAccount, { accountId })) {
        await ctx.scheduler.runAfter(0, internal.dropbox.check, { connectionId: row._id });
      }
    }
    // Answered quickly whatever happened: Dropbox expects an answer within 10 seconds.
    return { status: 200 };
  },
});

// Bringing a file in.

const fileValidator = v.object({
  fileId: v.string(),
  path: v.string(),
  name: v.string(),
  size: v.number(),
  contentHash: v.string(),
  contentType: v.string(),
  kind: v.union(v.literal("video"), v.literal("audio"), v.literal("image")),
  modifiedAt: v.number(),
});

type StartOutcome = "started" | "already" | "duplicate" | "no_toolkit" | "gone";

/** The address a job keeps for a Dropbox file. Swapped for a fresh link as it is sent. */
export function fileAddress(fileId: string): string {
  return `${contentBase()}/2/files/download#${encodeURIComponent(fileId)}`;
}

/**
 * Starts bringing one file in: records an upload that is on its way, and has the toolkit
 * stream the file from Dropbox into the team's folder. A file already in (the same file,
 * or the very same contents from another folder or teammate) is left alone; one that
 * failed is tried again; a changed file comes in as a new upload.
 */
export const startImport = internalMutation({
  args: { connectionId: v.id("dropboxConnections"), file: fileValidator },
  handler: async (ctx, args): Promise<StartOutcome> => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return "gone";
    const { organizationId } = connection;
    const { file } = args;
    const before = (
      await ctx.db
        .query("dropboxImports")
        .withIndex("by_file", (q) =>
          q.eq("organizationId", organizationId).eq("fileId", file.fileId),
        )
        .order("desc")
        .take(10)
    ).find((one) => one.contentHash === file.contentHash);
    if (before && before.status !== "failed") return "already";
    if (file.contentHash) {
      const same = (
        await ctx.db
          .query("dropboxImports")
          .withIndex("by_hash", (q) =>
            q.eq("organizationId", organizationId).eq("contentHash", file.contentHash),
          )
          .take(10)
      ).find((one) => one.status === "done" || one.status === "importing");
      if (same) {
        const fields = {
          organizationId,
          connectionId: connection._id,
          fileId: file.fileId,
          path: file.path,
          name: file.name,
          contentHash: file.contentHash,
          size: file.size,
          modifiedAt: file.modifiedAt,
          status: "duplicate" as const,
          ...(same.uploadId ? { uploadId: same.uploadId } : {}),
          error: undefined,
        };
        if (before) await ctx.db.patch(before._id, fields);
        else await ctx.db.insert("dropboxImports", fields);
        return "duplicate";
      }
    }

    const key = `uploads/Dropbox/${crypto.randomUUID()}/${safeName(file.name)}`;
    const importId =
      before?._id ??
      (await ctx.db.insert("dropboxImports", {
        organizationId,
        connectionId: connection._id,
        fileId: file.fileId,
        path: file.path,
        name: file.name,
        contentHash: file.contentHash,
        size: file.size,
        modifiedAt: file.modifiedAt,
        status: "importing",
      }));
    const queued = await enqueueJob(ctx, {
      organizationId,
      stepId: "storage-upload-s3",
      input: {
        file_url: fileAddress(file.fileId),
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
            ? "Connect your toolkit first, so there is somewhere for files to go."
            : queued.message,
      });
      return "no_toolkit";
    }
    const uploadId = await ctx.db.insert("uploads", {
      organizationId,
      key,
      fileName: file.name,
      contentType: file.contentType,
      size: file.size,
      status: "uploading",
      createdBy: connection.userId,
      source: "dropbox",
    });
    await ctx.db.patch(queued.jobId, { dropboxImportId: importId });
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
  args: { dropboxImportId: v.id("dropboxImports") },
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.dropboxImportId);
    if (!found) return null;
    return { found, row: await ctx.db.get(found.connectionId) };
  },
});

/**
 * The address the toolkit fetches a file from: a link Dropbox makes for it that works
 * for four hours without a sign-in, asked for only as the job is sent, so it is never kept.
 */
export async function downloadUrlFor(
  ctx: ActionCtx,
  dropboxImportId: Id<"dropboxImports">,
): Promise<string> {
  const loaded: { found: Doc<"dropboxImports">; row: Doc<"dropboxConnections"> | null } | null =
    await ctx.runQuery(internal.dropbox.importForJob, { dropboxImportId });
  if (!loaded) throw new DropboxSignInError("This file is no longer being brought in.");
  if (!loaded.row) throw new DropboxSignInError("This Dropbox is no longer connected.");
  const token = await accessTokenFor(ctx, loaded.row._id);
  const response = await rpc(token, loaded.row, "files/get_temporary_link", {
    path: loaded.found.fileId,
  });
  if (response.status === 409) {
    throw new DropboxSignInError("The file is no longer in Dropbox.");
  }
  const body = (response.ok ? await response.json() : {}) as { link?: string };
  if (!body.link) {
    throw new DropboxSignInError(
      `Dropbox did not give a download link for the file (HTTP ${response.status}).`,
    );
  }
  return body.link;
}

/**
 * The toolkit finished (or gave up on) a file's job. A finished one becomes a ready
 * upload: it joins the library, its details are read, and upload automations start.
 */
export async function onDropboxJobFinished(
  ctx: MutationCtx,
  job: Doc<"jobs">,
  ok: boolean,
  error: string | null,
): Promise<void> {
  if (!job.dropboxImportId) return;
  const found = await ctx.db.get(job.dropboxImportId);
  if (!found || found.jobId !== job._id) return;
  const upload = found.uploadId ? await ctx.db.get(found.uploadId) : null;
  if (!ok || !upload) {
    await ctx.db.patch(found._id, {
      status: "failed",
      error: error ?? "The file could not be brought in.",
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

// Files already in watched folders, by hand.

export const brought = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const imports = await ctx.db
      .query("dropboxImports")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(2000);
    const live = imports.filter((one) => one.status !== "failed");
    return {
      files: live.map((one) => `${one.fileId}:${one.contentHash}`),
      hashes: live.map((one) => one.contentHash).filter(Boolean),
    };
  },
});

/** Every media file in the member's watched folders (or one of them), newest first. */
async function filesIn(
  ctx: ActionCtx,
  found: Mine,
  folderId?: Id<"dropboxFolders">,
): Promise<(PickedFile & { folder: string })[]> {
  const token = await signedIn(ctx, found.row);
  const folders = folderId ? found.folders.filter((one) => one._id === folderId) : found.folders;
  const all = new Map<string, PickedFile & { folder: string }>();
  for (const folder of folders) {
    let response = await rpc(token, found.row, "files/list_folder", {
      path: requestPath(folder),
      recursive: folder.recursive !== false,
      include_deleted: false,
      limit: 2000,
    });
    for (let page = 0; page < 10 && all.size < MAX_LISTED; page++) {
      if (!response.ok) {
        throw new ConvexError({
          code: "dropbox_refused",
          message: `Dropbox did not list ${folder.path} (HTTP ${response.status}).`,
        });
      }
      const body = (await response.json()) as ListPage;
      for (const entry of body.entries ?? []) {
        const picked = pickFile(entry);
        if (picked && !all.has(picked.fileId))
          all.set(picked.fileId, { ...picked, folder: folder.path });
      }
      if (!body.has_more || !body.cursor) break;
      response = await rpc(token, found.row, "files/list_folder/continue", { cursor: body.cursor });
    }
  }
  return [...all.values()].sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, MAX_LISTED);
}

export interface DropboxPastFile {
  fileId: string;
  name: string;
  path: string;
  folder: string;
  kind: "video" | "audio" | "image";
  size: number;
  modifiedAt: number;
  brought: boolean;
}

/** What is already in the caller's watched folders, saying which files are in Uploads. */
export const pastFiles = action({
  args: { organizationId: v.string(), folderId: v.optional(v.id("dropboxFolders")) },
  handler: async (ctx, args): Promise<DropboxPastFile[]> => {
    const found: Mine = await ctx.runQuery(internal.dropbox.mine, {
      organizationId: args.organizationId,
    });
    const done = await ctx.runQuery(internal.dropbox.brought, {
      organizationId: args.organizationId,
    });
    const files = new Set(done.files);
    const hashes = new Set(done.hashes);
    return (await filesIn(ctx, found, args.folderId)).map((one) => ({
      fileId: one.fileId,
      name: one.name,
      path: one.path,
      folder: one.folder,
      kind: one.kind,
      size: one.size,
      modifiedAt: one.modifiedAt,
      brought:
        files.has(`${one.fileId}:${one.contentHash}`) ||
        (one.contentHash !== "" && hashes.has(one.contentHash)),
    }));
  },
});

/** Brings over the ticked files, looked up again in Dropbox rather than taken on trust. */
export const bringOver = action({
  args: { organizationId: v.string(), fileIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<{ started: number; skipped: number }> => {
    if (args.fileIds.length > MAX_BRING) {
      throw new ConvexError({
        code: "too_many",
        message: `Bring over up to ${MAX_BRING} files at a time.`,
      });
    }
    const found: Mine = await ctx.runQuery(internal.dropbox.mine, {
      organizationId: args.organizationId,
    });
    const wanted = new Set(args.fileIds);
    const files = (await filesIn(ctx, found)).filter((one) => wanted.has(one.fileId));
    let started = 0;
    for (const one of files) {
      const { folder, ...file } = one;
      void folder; // Only used to show the file under its folder in Settings.
      const outcome = await ctx.runMutation(internal.dropbox.startImport, {
        connectionId: found.row._id,
        file,
      });
      if (outcome === "no_toolkit") {
        throw new ConvexError({
          code: "no_toolkit",
          message: "Connect your toolkit first, so there is somewhere for files to go.",
        });
      }
      if (outcome === "started") started++;
    }
    return { started, skipped: args.fileIds.length - started };
  },
});

// Sending finished files to Dropbox.

/** What an automation's "Send to Dropbox" switch shows. */
export const forAutomation = query({
  args: { automationId: v.id("automations") },
  handler: async (ctx, args) => {
    const automation = await ctx.db.get(args.automationId);
    if (!automation) return null;
    if (!(await isMember(ctx, automation.organizationId))) return null;
    const { userId } = await requireMember(ctx, automation.organizationId);
    const mineRow = await findMine(ctx, automation.organizationId, userId);
    const send = automation.dropboxSend;
    const target = send ? await ctx.db.get(send.connectionId) : null;
    if (!ready() || (!mineRow && !target)) return null;
    return {
      on: Boolean(send && target),
      canSwitch: Boolean(mineRow) || Boolean(target && target.userId === userId),
      account: target?.name ?? mineRow?.name ?? "",
      mine: target ? target.userId === userId : true,
      folder: sendFolderOf(send?.folder, automation.name),
    };
  },
});

/**
 * Switches an automation's finished files going to Dropbox on or off. On, they go to the
 * caller's own Dropbox, into the folder they picked or "/Takewon/<automation>".
 */
export const setSend = mutation({
  args: {
    automationId: v.id("automations"),
    on: v.boolean(),
    folder: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const automation = await ctx.db.get(args.automationId);
    if (!automation)
      throw new ConvexError({ code: "not_found", message: "That automation is gone." });
    const { userId } = await requireMember(ctx, automation.organizationId);
    if (!args.on) {
      await ctx.db.patch(automation._id, { dropboxSend: undefined });
      return;
    }
    const mineRow = await findMine(ctx, automation.organizationId, userId);
    if (!mineRow) {
      throw new ConvexError({
        code: "not_connected",
        message: "Connect your Dropbox in Settings first.",
      });
    }
    const folder = args.folder?.trim().replace(/\/+$/, "");
    if (folder !== undefined && folder !== "" && !folder.startsWith("/")) {
      throw new ConvexError({ code: "bad_folder", message: "A Dropbox folder starts with /." });
    }
    await ctx.db.patch(automation._id, {
      dropboxSend: { connectionId: mineRow._id, by: userId, ...(folder ? { folder } : {}) },
    });
  },
});

/** After a run's files are kept: one send for each, when its automation is switched on. */
export const queueSends = internalMutation({
  args: { runId: v.id("runs"), keys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "done" || args.keys.length === 0) return;
    const automation = await ctx.db.get(run.automationId);
    const send = automation?.dropboxSend;
    if (!automation || !send) return;
    const target = await ctx.db.get(send.connectionId);
    if (!target || target.organizationId !== run.organizationId) return;
    // A run's files are sent once, even if they are kept again later.
    const before = await ctx.db
      .query("dropboxSends")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .first();
    if (before) return;
    const folder = sendFolderOf(send.folder, automation.name);
    for (const key of [...new Set(args.keys)].slice(0, 100)) {
      const name = dropboxName(key.split("/").pop() ?? "", "File");
      const sendId = await ctx.db.insert("dropboxSends", {
        organizationId: run.organizationId,
        connectionId: target._id,
        runId: run._id,
        automationName: automation.name,
        key,
        name,
        size: 0,
        folder,
        status: "sending",
        offset: 0,
        createdAt: Date.now(),
        ...(send.folder ? {} : { home: true }),
      });
      await ctx.scheduler.runAfter(0, internal.dropbox.sendOne, { sendId });
    }
  },
});

export const loadSend = internalQuery({
  args: { sendId: v.id("dropboxSends") },
  handler: async (ctx, args) => {
    const send = await ctx.db.get(args.sendId);
    if (!send || send.status !== "sending") return null;
    const row = await ctx.db.get(send.connectionId);
    const storage = await storageConnection(ctx, send.organizationId);
    return { send, row, storage };
  },
});

export const patchSend = internalMutation({
  args: {
    sendId: v.id("dropboxSends"),
    fields: v.object({
      size: v.optional(v.number()),
      offset: v.optional(v.number()),
      sessionId: v.optional(v.string()),
      status: v.optional(v.union(v.literal("sending"), v.literal("done"), v.literal("failed"))),
      dropboxPath: v.optional(v.string()),
      error: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { sendId, fields }) => {
    if (await ctx.db.get(sendId)) await ctx.db.patch(sendId, fields);
  },
});

/** Sends a failed file to Dropbox again, from the start. */
export const sendAgain = mutation({
  args: { sendId: v.id("dropboxSends") },
  handler: async (ctx, args) => {
    const send = await ctx.db.get(args.sendId);
    if (!send) return;
    await requireMember(ctx, send.organizationId);
    if (send.status !== "failed") return;
    await ctx.db.patch(send._id, {
      status: "sending",
      offset: 0,
      sessionId: undefined,
      error: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.dropbox.sendOne, { sendId: send._id });
  },
});

class SendError extends Error {}

/** One piece of a file in the team's bucket, read with a signed link. */
async function readPiece(link: string, start: number, end: number): Promise<ArrayBuffer> {
  const response = await fetch(link, { headers: { range: `bytes=${start}-${end}` } });
  if (response.status !== 206 && !(response.ok && start === 0)) {
    throw new SendError(`The file could not be read from storage (HTTP ${response.status}).`);
  }
  return await response.arrayBuffer();
}

/** How big a file in the bucket is, from the first byte's Content-Range. */
async function sizeOf(link: string): Promise<number> {
  const response = await fetch(link, { headers: { range: "bytes=0-0" } });
  if (response.status === 404) throw new SendError("The finished file is no longer in storage.");
  const total = /\/(\d+)$/.exec(response.headers.get("content-range") ?? "")?.[1];
  await response.body?.cancel();
  if (total) return Number(total);
  const length = Number(response.headers.get("content-length") ?? "");
  if (response.ok && Number.isFinite(length) && length > 0) return length;
  throw new SendError(`The finished file could not be read (HTTP ${response.status}).`);
}

async function content(
  token: string,
  row: Doc<"dropboxConnections">,
  home: boolean,
  path: string,
  arg: unknown,
  body: ArrayBuffer | null,
): Promise<Response> {
  return await fetch(`${contentBase()}/2/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/octet-stream",
      "dropbox-api-arg": apiArg(arg),
      ...pathRoot(row, home),
    },
    body: body ?? new ArrayBuffer(0),
  });
}

async function refused(response: Response, what: string): Promise<SendError> {
  const problem = await problemOf(response);
  if (problem.includes("insufficient_space")) {
    return new SendError("The Dropbox is full, so the file could not be added.");
  }
  if (problem.includes("no_write_permission")) {
    return new SendError("You cannot add files to that Dropbox folder.");
  }
  return new SendError(`Dropbox did not take ${what} (HTTP ${response.status}).`);
}

/**
 * Sends one finished file to Dropbox. A small file goes in one request; a big one in
 * 8 MiB pieces, a number of them each turn, so no single action runs long or holds much.
 */
type LoadedSend = {
  send: Doc<"dropboxSends">;
  row: Doc<"dropboxConnections"> | null;
  storage: Doc<"toolkitConnections"> | null;
} | null;

export const sendOne = internalAction({
  args: { sendId: v.id("dropboxSends") },
  handler: async (ctx, args): Promise<void> => {
    const loaded: LoadedSend = await ctx.runQuery(internal.dropbox.loadSend, args);
    if (!loaded) return;
    const { send, row, storage } = loaded;
    const fail = async (error: string): Promise<void> => {
      await ctx.runMutation(internal.dropbox.patchSend, {
        sendId: send._id,
        fields: { status: "failed", error },
      });
    };
    if (!row) return await fail("That Dropbox is no longer connected.");
    if (!storage) return await fail("The team's toolkit storage is not connected.");
    const home = send.home === true;
    try {
      const token = await accessTokenFor(ctx, row._id);
      const link = await presign(await bucketOf(storage), "GET", send.key, 3600);
      const size = send.size > 0 ? send.size : await sizeOf(link);
      if (size !== send.size) {
        await ctx.runMutation(internal.dropbox.patchSend, { sendId: send._id, fields: { size } });
      }
      const commit = {
        path: `${send.folder}/${send.name}`,
        mode: "add",
        autorename: true,
        mute: true,
      };
      if (size <= PIECE_BYTES) {
        const response = await content(
          token,
          row,
          home,
          "files/upload",
          commit,
          await readPiece(link, 0, size - 1),
        );
        if (!response.ok) throw await refused(response, send.name);
        const meta = (await response.json()) as DropboxEntry;
        await ctx.runMutation(internal.dropbox.patchSend, {
          sendId: send._id,
          fields: { status: "done", offset: size, dropboxPath: meta.path_display ?? commit.path },
        });
        return;
      }
      let offset = send.offset;
      let sessionId = send.sessionId;
      for (let turn = 0; turn < PIECES_PER_TURN; turn++) {
        const piece = nextPiece(offset, size);
        if (!piece) break;
        const bytes = await readPiece(link, piece.start, piece.end);
        const response = sessionId
          ? await content(
              token,
              row,
              home,
              "files/upload_session/append_v2",
              { cursor: { session_id: sessionId, offset }, close: false },
              bytes,
            )
          : await content(token, row, home, "files/upload_session/start", { close: false }, bytes);
        if (!response.ok) throw await refused(response, send.name);
        if (!sessionId) {
          sessionId = ((await response.json()) as { session_id?: string }).session_id;
          if (!sessionId) throw new SendError("Dropbox did not start taking the file.");
        } else {
          await response.body?.cancel();
        }
        offset += bytes.byteLength;
        await ctx.runMutation(internal.dropbox.patchSend, {
          sendId: send._id,
          fields: { offset, sessionId },
        });
      }
      if (offset < size) {
        await ctx.scheduler.runAfter(0, internal.dropbox.sendOne, args);
        return;
      }
      const finished = await content(
        token,
        row,
        home,
        "files/upload_session/finish",
        { cursor: { session_id: sessionId, offset }, commit },
        null,
      );
      if (!finished.ok) throw await refused(finished, send.name);
      const meta = (await finished.json()) as DropboxEntry;
      await ctx.runMutation(internal.dropbox.patchSend, {
        sendId: send._id,
        fields: { status: "done", dropboxPath: meta.path_display ?? commit.path },
      });
    } catch (error) {
      await fail(
        error instanceof SendError || error instanceof DropboxSignInError
          ? error.message
          : "Dropbox or the storage could not be reached.",
      );
    }
  },
});
