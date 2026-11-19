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
import { enqueueJob, pump } from "./lib/queue";
import {
  isFromZoom,
  hmacHex,
  pickRecordingFile,
  recordingFileName,
  startOf,
  type ZoomMeeting,
} from "./lib/zoom";

/**
 * Zoom meetings, brought in by themselves. The dashboard has ONE Zoom app, set up once by
 * whoever runs it (ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET and ZOOM_WEBHOOK_SECRET). Each team
 * member who hosts meetings connects their own Zoom account from Settings. When Zoom
 * finishes a cloud recording it tells the dashboard (recording.completed), and the team's
 * toolkit streams the best file of it straight from Zoom into the team's folder. It then
 * becomes an upload like any other: it joins the library and starts the automations set
 * to run on an upload. Files never pass through this app, whatever their size.
 */

/** A Zoom sign-in started from Settings must come back within this long. */
const START_TTL_MS = 15 * 60 * 1000;
/** An access token with less than this left is renewed before it is used. */
const RENEW_MS = 5 * 60 * 1000;
/** Zoom's download token is good for a day; past this, the account's sign-in is used. */
const DOWNLOAD_TOKEN_MS = 23 * 60 * 60 * 1000;
/** How far back "Bring in a past recording" looks. */
const PAST_DAYS = 30;

/** What the dashboard asks Zoom for: who you are, your recordings, and recording events. */
export const ZOOM_SCOPES = [
  "user:read:user",
  "cloud_recording:read:list_user_recordings",
  "cloud_recording:read:recording",
];

function oauthBase(): string {
  return (process.env.ZOOM_OAUTH_URL ?? "https://zoom.us").replace(/\/+$/, "");
}

function apiBase(): string {
  return (process.env.ZOOM_API_URL ?? "https://api.zoom.us/v2").replace(/\/+$/, "");
}

function site(): string {
  return (process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
}

/** Where Zoom sends people back to after they sign in. */
export function redirectUri(): string {
  return `${site()}/zoom/callback`;
}

/** Where Zoom sends its events. */
export function eventsUrl(): string {
  return `${site()}/zoom/events`;
}

/** Whether this dashboard has a Zoom app set up. */
function ready(): boolean {
  return Boolean(
    process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET && process.env.ZOOM_WEBHOOK_SECRET,
  );
}

/** Back to Settings, saying how the Zoom sign-in went. */
export function settingsUrl(result: string): string {
  const base = (process.env.SITE_URL ?? "").replace(/\/+$/, "");
  return `${base}/settings/zoom?zoom=${encodeURIComponent(result)}`;
}

function basicAuth(): string {
  return `Basic ${btoa(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`)}`;
}

/** What Settings shows about Zoom: the viewer's own account, the team's, and what came in. */
export const forTeam = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    if (!(await isMember(ctx, args.organizationId))) return null;
    const { userId } = await requireMember(ctx, args.organizationId);
    const connections = await ctx.db
      .query("zoomConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(50);
    const mine = connections.find((one) => one.userId === userId) ?? null;
    const others = [];
    for (const one of connections) {
      if (one.userId === userId) continue;
      const by = await ctx.runQuery(components.betterAuth.members.contact, { userId: one.userId });
      others.push({ zoomName: one.zoomName, memberName: by?.name ?? null });
    }
    const imports = await ctx.db
      .query("zoomImports")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(20);
    return {
      ready: ready(),
      me: mine
        ? {
            zoomName: mine.zoomName,
            zoomEmail: mine.zoomEmail,
            connectedAt: mine.connectedAt,
            autoImport: mine.autoImport,
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

/** Starts a Zoom sign-in from Settings and returns the address to open. */
export const startLink = mutation({
  args: { organizationId: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    if (!ready()) {
      throw new ConvexError({
        code: "not_ready",
        message: "Zoom is not set up on this dashboard yet.",
      });
    }
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await ctx.db.insert("zoomLinkStarts", {
      nonce,
      organizationId: args.organizationId,
      userId,
      createdAt: Date.now(),
    });
    const url = new URL(`${oauthBase()}/oauth/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", process.env.ZOOM_CLIENT_ID!);
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("state", nonce);
    return url.toString();
  },
});

/** Whether new recordings of the caller's Zoom come in by themselves. */
export const setAutoImport = mutation({
  args: { organizationId: v.string(), autoImport: v.boolean() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const mine = await ctx.db
      .query("zoomConnections")
      .withIndex("by_member", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", userId),
      )
      .unique();
    if (!mine)
      throw new ConvexError({ code: "not_connected", message: "Connect your Zoom first." });
    await ctx.db.patch(mine._id, { autoImport: args.autoImport });
  },
});

/** Forgets the caller's Zoom on this team. Recordings already brought in stay. */
export const disconnect = mutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const mine = await ctx.db
      .query("zoomConnections")
      .withIndex("by_member", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", userId),
      )
      .unique();
    if (!mine) return;
    await ctx.db.delete(mine._id);
    // Zoom is told too, so the app no longer has the account's sign-in.
    await ctx.scheduler.runAfter(0, internal.zoom.revoke, { tokenCipher: mine.refreshTokenCipher });
  },
});

export const revoke = internalAction({
  args: { tokenCipher: v.string() },
  handler: async (_ctx, args) => {
    if (!ready()) return;
    try {
      const token = await decryptSecret(args.tokenCipher);
      await fetch(`${oauthBase()}/oauth/revoke?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { authorization: basicAuth() },
      });
    } catch {
      // Zoom forgets an unused sign-in after 90 days anyway.
    }
  },
});

// Signing in.

/** Uses up a started sign-in. Null when it is unknown or too old. */
export const takeStart = internalMutation({
  args: { nonce: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("zoomLinkStarts")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (Date.now() - row.createdAt > START_TTL_MS) return null;
    return { organizationId: row.organizationId, userId: row.userId };
  },
});

/** Saves a Zoom account a member connected. Returns how it went, for the Settings page. */
export const saveConnection = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    zoomUserId: v.string(),
    zoomAccountId: v.string(),
    zoomEmail: v.string(),
    zoomName: v.string(),
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
    // One Zoom account belongs to one team, so each recording has one home.
    const elsewhere = await ctx.db
      .query("zoomConnections")
      .withIndex("by_zoom_user", (q) => q.eq("zoomUserId", args.zoomUserId))
      .take(10);
    for (const one of elsewhere) {
      if (one.organizationId !== args.organizationId) return "taken";
      if (one.userId !== args.userId) return "taken_here";
    }
    const mine = await ctx.db
      .query("zoomConnections")
      .withIndex("by_member", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", args.userId),
      )
      .unique();
    const fields = { ...args, connectedAt: Date.now(), autoImport: mine?.autoImport ?? true };
    if (mine) await ctx.db.replace(mine._id, fields);
    else await ctx.db.insert("zoomConnections", fields);
    return "connected";
  },
});

/** Finishes a Zoom sign-in: trades the code for tokens, finds the account, saves it. */
export const finishLink = internalAction({
  args: { code: v.string(), state: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const start = await ctx.runMutation(internal.zoom.takeStart, { nonce: args.state });
    if (!start) return settingsUrl("expired");
    if (!ready()) return settingsUrl("not_ready");
    try {
      const tokenResponse = await fetch(`${oauthBase()}/oauth/token`, {
        method: "POST",
        headers: {
          authorization: basicAuth(),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: args.code,
          redirect_uri: redirectUri(),
        }).toString(),
      });
      if (!tokenResponse.ok) return settingsUrl("refused");
      const token = (await tokenResponse.json()) as Partial<ZoomTokens>;
      if (!token.access_token || !token.refresh_token) return settingsUrl("refused");
      const meResponse = await fetch(`${apiBase()}/users/me`, {
        headers: { authorization: `Bearer ${token.access_token}` },
      });
      if (!meResponse.ok) return settingsUrl("refused");
      const me = (await meResponse.json()) as {
        id?: string;
        account_id?: string;
        email?: string;
        display_name?: string;
        first_name?: string;
        last_name?: string;
      };
      if (!me.id) return settingsUrl("refused");
      const name =
        me.display_name || [me.first_name, me.last_name].filter(Boolean).join(" ") || me.email;
      const result = await ctx.runMutation(internal.zoom.saveConnection, {
        organizationId: start.organizationId,
        userId: start.userId,
        zoomUserId: me.id,
        zoomAccountId: me.account_id ?? "",
        zoomEmail: me.email ?? "",
        zoomName: name || "Zoom account",
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

interface ZoomTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export const connection = internalQuery({
  args: { connectionId: v.id("zoomConnections") },
  handler: async (ctx, args) => await ctx.db.get(args.connectionId),
});

export const saveTokens = internalMutation({
  args: {
    connectionId: v.id("zoomConnections"),
    accessTokenCipher: v.string(),
    refreshTokenCipher: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, { connectionId, ...tokens }) => {
    if (await ctx.db.get(connectionId)) await ctx.db.patch(connectionId, tokens);
  },
});

export class ZoomSignInError extends Error {}

/**
 * A working access token for a connected Zoom account, renewed when it runs low. Zoom
 * hands out a new refresh token each time, so the new one is kept straight away.
 */
export async function accessTokenFor(
  ctx: ActionCtx,
  connectionId: Id<"zoomConnections">,
): Promise<string> {
  const row: Doc<"zoomConnections"> | null = await ctx.runQuery(internal.zoom.connection, {
    connectionId,
  });
  if (!row) throw new ZoomSignInError("This Zoom account is no longer connected.");
  if (row.expiresAt - Date.now() > RENEW_MS) return await decryptSecret(row.accessTokenCipher);
  const response = await fetch(`${oauthBase()}/oauth/token`, {
    method: "POST",
    headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: await decryptSecret(row.refreshTokenCipher),
    }).toString(),
  });
  const token = (response.ok ? await response.json() : {}) as Partial<ZoomTokens>;
  if (!token.access_token || !token.refresh_token) {
    throw new ZoomSignInError("Zoom no longer accepts this account's sign-in. Connect Zoom again.");
  }
  await ctx.runMutation(internal.zoom.saveTokens, {
    connectionId,
    accessTokenCipher: await encryptSecret(token.access_token),
    refreshTokenCipher: await encryptSecret(token.refresh_token),
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
  });
  return token.access_token;
}

export const importForJob = internalQuery({
  args: { zoomImportId: v.id("zoomImports") },
  handler: async (ctx, args) => await ctx.db.get(args.zoomImportId),
});

/**
 * The sign-in header the toolkit sends to Zoom when it fetches a recording. Made when the
 * job is sent, so it is never kept with the job: Zoom's own download token while it is
 * good, otherwise the account's sign-in.
 */
export async function downloadHeadersFor(
  ctx: ActionCtx,
  zoomImportId: Id<"zoomImports">,
): Promise<{ Authorization: string }> {
  const found: Doc<"zoomImports"> | null = await ctx.runQuery(internal.zoom.importForJob, {
    zoomImportId,
  });
  if (!found) throw new ZoomSignInError("This Zoom recording is no longer being brought in.");
  if (found.downloadTokenCipher && Date.now() - found._creationTime < DOWNLOAD_TOKEN_MS) {
    return { Authorization: `Bearer ${await decryptSecret(found.downloadTokenCipher)}` };
  }
  return { Authorization: `Bearer ${await accessTokenFor(ctx, found.connectionId)}` };
}

// Bringing a recording in.

const meetingValidator = v.object({
  uuid: v.string(),
  topic: v.string(),
  startTime: v.number(),
  file: v.object({
    id: v.string(),
    downloadUrl: v.string(),
    extension: v.union(v.literal("mp4"), v.literal("m4a")),
    contentType: v.string(),
    size: v.number(),
  }),
});

type StartOutcome = "started" | "already" | "no_toolkit" | "gone";

/**
 * Starts bringing one recording in: records an upload that is on its way, and has the
 * toolkit stream the file from Zoom into the team's folder. A recording already brought
 * in, or on its way, is left alone; one that failed is tried again.
 */
export const startImport = internalMutation({
  args: {
    connectionId: v.id("zoomConnections"),
    meeting: meetingValidator,
    downloadTokenCipher: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<StartOutcome> => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return "gone";
    const { organizationId } = connection;
    const before = await ctx.db
      .query("zoomImports")
      .withIndex("by_file", (q) =>
        q.eq("organizationId", organizationId).eq("recordingFileId", args.meeting.file.id),
      )
      .first();
    if (before && before.status !== "failed") return "already";

    const fileName = recordingFileName(
      args.meeting.topic,
      args.meeting.startTime,
      args.meeting.file.extension,
    );
    const key = `uploads/${crypto.randomUUID()}/${safeName(fileName)}`;
    const importId =
      before?._id ??
      (await ctx.db.insert("zoomImports", {
        organizationId,
        connectionId: connection._id,
        meetingUuid: args.meeting.uuid,
        recordingFileId: args.meeting.file.id,
        topic: args.meeting.topic,
        startTime: args.meeting.startTime,
        status: "importing",
      }));
    const queued = await enqueueJob(ctx, {
      organizationId,
      stepId: "storage-upload-s3",
      input: {
        file_url: args.meeting.file.downloadUrl,
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
      contentType: args.meeting.file.contentType,
      size: args.meeting.file.size,
      status: "uploading",
      createdBy: connection.userId,
      source: "zoom",
    });
    await ctx.db.patch(queued.jobId, { zoomImportId: importId });
    await ctx.db.patch(importId, {
      connectionId: connection._id,
      status: "importing",
      uploadId,
      jobId: queued.jobId,
      error: undefined,
      downloadTokenCipher: args.downloadTokenCipher,
    });
    await pump(ctx, organizationId);
    return "started";
  },
});

/**
 * The toolkit finished (or gave up on) a recording's job. A finished one becomes a ready
 * upload: it joins the library, its details are read, and upload automations start.
 */
export async function onZoomJobFinished(
  ctx: MutationCtx,
  job: Doc<"jobs">,
  ok: boolean,
  error: string | null,
): Promise<void> {
  if (!job.zoomImportId) return;
  const found = await ctx.db.get(job.zoomImportId);
  if (!found || found.jobId !== job._id) return;
  const upload = found.uploadId ? await ctx.db.get(found.uploadId) : null;
  if (!ok || !upload) {
    await ctx.db.patch(found._id, {
      status: "failed",
      error: error ?? "The recording could not be brought in.",
      downloadTokenCipher: undefined,
    });
    if (upload && upload.status === "uploading") await ctx.db.delete(upload._id);
    return;
  }
  await ctx.db.patch(found._id, { status: "done", downloadTokenCipher: undefined });
  if (upload.status === "ready") return;
  await ctx.db.patch(upload._id, { status: "ready" });
  await addUploadToLibrary(ctx, { ...upload, status: "ready" });
  await ctx.scheduler.runAfter(0, internal.storage.readDetails, { uploadId: upload._id });
}

/** The connection a member made on a team, for the actions below. */
export const mine = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const row = await ctx.db
      .query("zoomConnections")
      .withIndex("by_member", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", userId),
      )
      .unique();
    if (!row) throw new ConvexError({ code: "not_connected", message: "Connect your Zoom first." });
    const imports = await ctx.db
      .query("zoomImports")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(500);
    return {
      connectionId: row._id,
      brought: imports.filter((one) => one.status !== "failed").map((one) => one.recordingFileId),
    };
  },
});

/** The caller's cloud recordings from the last 30 days, newest first. */
async function pastMeetings(
  ctx: ActionCtx,
  connectionId: Id<"zoomConnections">,
): Promise<ZoomMeeting[]> {
  let token: string;
  try {
    token = await accessTokenFor(ctx, connectionId);
  } catch (error) {
    throw new ConvexError({ code: "zoom_sign_in", message: (error as Error).message });
  }
  const to = new Date();
  const from = new Date(to.getTime() - PAST_DAYS * 24 * 60 * 60 * 1000);
  const url = new URL(`${apiBase()}/users/me/recordings`);
  url.searchParams.set("from", from.toISOString().slice(0, 10));
  url.searchParams.set("to", to.toISOString().slice(0, 10));
  url.searchParams.set("page_size", "100");
  let response: Response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new ConvexError({
      code: "unreachable",
      message: "Zoom could not be reached. Try again.",
    });
  }
  if (!response.ok) {
    throw new ConvexError({
      code: "zoom_refused",
      message: `Zoom did not list your recordings (HTTP ${response.status}).`,
    });
  }
  const body = (await response.json()) as { meetings?: ZoomMeeting[] };
  return (body.meetings ?? []).sort(
    (a, b) => Date.parse(b.start_time ?? "") - Date.parse(a.start_time ?? ""),
  );
}

export interface PastRecording {
  meetingUuid: string;
  topic: string;
  startTime: number;
  minutes: number | null;
  size: number;
  brought: boolean;
}

type Mine = { connectionId: Id<"zoomConnections">; brought: string[] };

/** The caller's recent Zoom recordings, saying which have been brought in already. */
export const pastRecordings = action({
  args: { organizationId: v.string() },
  handler: async (ctx, args): Promise<PastRecording[]> => {
    const found: Mine = await ctx.runQuery(internal.zoom.mine, args);
    const meetings = await pastMeetings(ctx, found.connectionId);
    const shown: PastRecording[] = [];
    for (const meeting of meetings) {
      const file = pickRecordingFile(meeting.recording_files);
      if (!meeting.uuid || !file) continue;
      shown.push({
        meetingUuid: meeting.uuid,
        topic: meeting.topic || "Zoom meeting",
        startTime: startOf(meeting, Date.now()),
        minutes: meeting.duration ?? null,
        size: file.size,
        brought: found.brought.includes(file.id),
      });
    }
    return shown;
  },
});

/** Brings in one of the caller's recent recordings, by the meeting Zoom listed. */
export const bringIn = action({
  args: { organizationId: v.string(), meetingUuid: v.string() },
  handler: async (ctx, args): Promise<StartOutcome> => {
    const found: Mine = await ctx.runQuery(internal.zoom.mine, {
      organizationId: args.organizationId,
    });
    // Looked up again rather than taken from the browser: Zoom's list is the truth.
    const meeting = (await pastMeetings(ctx, found.connectionId)).find(
      (one) => one.uuid === args.meetingUuid,
    );
    const file = meeting ? pickRecordingFile(meeting.recording_files) : null;
    if (!meeting || !file) {
      throw new ConvexError({ code: "not_found", message: "Zoom no longer has that recording." });
    }
    const outcome = await ctx.runMutation(internal.zoom.startImport, {
      connectionId: found.connectionId,
      meeting: {
        uuid: meeting.uuid!,
        topic: meeting.topic || "Zoom meeting",
        startTime: startOf(meeting, Date.now()),
        file,
      },
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

// Zoom's events.

export const connectionsOf = internalQuery({
  args: { zoomUserId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("zoomConnections")
      .withIndex("by_zoom_user", (q) => q.eq("zoomUserId", args.zoomUserId))
      .take(10),
});

export const forgetZoomUser = internalMutation({
  args: { zoomUserId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("zoomConnections")
      .withIndex("by_zoom_user", (q) => q.eq("zoomUserId", args.zoomUserId))
      .take(10);
    for (const row of rows) await ctx.db.delete(row._id);
  },
});

type EventAnswer = { status: number; json?: Record<string, string> };

/**
 * One event from Zoom, checked against the app's secret token: the check Zoom makes when
 * the address is saved, a finished recording, or someone removing the app.
 */
export const takeEvent = internalAction({
  args: { body: v.string(), timestamp: v.string(), signature: v.string() },
  handler: async (ctx, args): Promise<EventAnswer> => {
    const secret = process.env.ZOOM_WEBHOOK_SECRET ?? "";
    if (!secret) return { status: 503 };
    let event: {
      event?: string;
      download_token?: string;
      payload?: {
        plainToken?: string;
        user_id?: string;
        object?: ZoomMeeting;
      };
    };
    try {
      event = JSON.parse(args.body);
    } catch {
      return { status: 400 };
    }
    // Zoom checks the address is ours when it is saved, and every few days after.
    if (event.event === "endpoint.url_validation") {
      const plainToken = event.payload?.plainToken;
      if (typeof plainToken !== "string" || !plainToken) return { status: 400 };
      return {
        status: 200,
        json: { plainToken, encryptedToken: await hmacHex(secret, plainToken) },
      };
    }
    if (!(await isFromZoom(secret, args.timestamp, args.body, args.signature, Date.now()))) {
      return { status: 401 };
    }

    if (event.event === "app_deauthorized") {
      if (event.payload?.user_id) {
        await ctx.runMutation(internal.zoom.forgetZoomUser, { zoomUserId: event.payload.user_id });
      }
      return { status: 204 };
    }

    if (event.event === "recording.completed") {
      const meeting = event.payload?.object;
      const file = pickRecordingFile(meeting?.recording_files);
      if (!meeting?.host_id || !meeting.uuid || !file) return { status: 204 };
      const connections = await ctx.runQuery(internal.zoom.connectionsOf, {
        zoomUserId: meeting.host_id,
      });
      for (const connection of connections) {
        if (!connection.autoImport) continue;
        await ctx.runMutation(internal.zoom.startImport, {
          connectionId: connection._id,
          meeting: {
            uuid: meeting.uuid,
            topic: meeting.topic || "Zoom meeting",
            startTime: startOf(meeting, Date.now()),
            file,
          },
          ...(event.download_token
            ? { downloadTokenCipher: await encryptSecret(event.download_token) }
            : {}),
        });
      }
    }
    // Events the app does not use are still answered, so Zoom does not send them again.
    return { status: 204 };
  },
});
