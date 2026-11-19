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
import { safeName } from "./lib/bucket";
import { decryptSecret, encryptSecret } from "./lib/crypto";
import {
  type ConferenceRecord,
  DRIVE_FILE_FIELDS,
  DRIVE_RECORDINGS_QUERY,
  type DriveFile,
  finishedFile,
  GOOGLE_MEET_SCOPES,
  googleUrls,
  grantedAll,
  isDriveFileId,
  meetingTitle,
  type MeetRecording,
  minutesOf,
  minutesOfFile,
  timeOf,
} from "./lib/googleMeet";
import { addUploadToLibrary } from "./lib/library";
import { enqueueJob, pump } from "./lib/queue";
import { recordingFileName } from "./lib/zoom";

/**
 * Google Meet recordings, brought in by themselves. The dashboard has ONE Google Cloud
 * app, set up once by whoever runs it (GOOGLE_MEET_CLIENT_ID and GOOGLE_MEET_CLIENT_SECRET).
 * Each team member who organizes meetings connects their own Google account from Settings.
 * Meet saves a recording to the organizer's Drive; every few minutes the dashboard asks
 * Meet for recordings that have finished saving, and the team's toolkit streams each one
 * straight from Drive into the team's folder. It then becomes an upload like any other: it
 * joins the library and starts the automations set to run on an upload. Files never pass
 * through this app, whatever their size.
 *
 * Asking every few minutes, rather than having Google push events, keeps the setup to one
 * sign-in app: Google's push needs a Pub/Sub topic and subscriptions renewed each week.
 *
 * Past recordings are listed from Drive rather than from Meet: Meet forgets a meeting after
 * 30 days, while the recording stays in Drive (the "Meet Recordings" folder) for good.
 *
 * Nothing comes in twice: a recording already brought in (by anyone on the team) is left
 * alone, and so is one whose file is already in Uploads some other way, such as uploaded by
 * hand (the same size in bytes).
 */

/** A Google sign-in started from Settings must come back within this long. */
const START_TTL_MS = 15 * 60 * 1000;
/** An access token with less than this left is renewed before it is used. */
const RENEW_MS = 5 * 60 * 1000;
/**
 * The toolkit may hold a job in its queue before it fetches the file, so the sign-in it is
 * handed must have most of Google's hour left.
 */
const DOWNLOAD_FRESH_MS = 50 * 60 * 1000;
/** How many recordings "Past recordings" shows at a time, newest first. */
const PAST_PAGE = 25;
/** How far back each automatic check looks; Meet can take a while to save a recording. */
const CHECK_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

const FALLBACK_TOPIC = "Google Meet meeting";

function site(): string {
  return (process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
}

/** Where Google sends people back to after they sign in. */
export function redirectUri(): string {
  return `${site()}/google-meet/callback`;
}

/** Whether this dashboard has a Google app set up. */
function ready(): boolean {
  return Boolean(process.env.GOOGLE_MEET_CLIENT_ID && process.env.GOOGLE_MEET_CLIENT_SECRET);
}

/** Back to Settings, saying how the Google sign-in went. */
export function settingsUrl(result: string): string {
  const base = (process.env.SITE_URL ?? "").replace(/\/+$/, "");
  return `${base}/settings/google-meet?meet=${encodeURIComponent(result)}`;
}

function clientFields() {
  return {
    client_id: process.env.GOOGLE_MEET_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_MEET_CLIENT_SECRET ?? "",
  };
}

/** What Settings shows about Google Meet: the viewer's account, the team's, what came in. */
export const forTeam = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    if (!(await isMember(ctx, args.organizationId))) return null;
    const { userId } = await requireMember(ctx, args.organizationId);
    const connections = await ctx.db
      .query("googleMeetConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(50);
    const mine = connections.find((one) => one.userId === userId) ?? null;
    const others = [];
    for (const one of connections) {
      if (one.userId === userId) continue;
      const by = await ctx.runQuery(components.betterAuth.members.contact, { userId: one.userId });
      others.push({ googleName: one.googleName, memberName: by?.name ?? null });
    }
    const imports = await ctx.db
      .query("googleMeetImports")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(20);
    return {
      ready: ready(),
      me: mine
        ? {
            googleName: mine.googleName,
            googleEmail: mine.googleEmail,
            connectedAt: mine.connectedAt,
            autoImport: mine.autoImport,
            signInLost: mine.signInLostAt !== undefined,
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

/** Starts a Google sign-in from Settings and returns the address to open. */
export const startLink = mutation({
  args: { organizationId: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    if (!ready()) {
      throw new ConvexError({
        code: "not_ready",
        message: "Google Meet is not set up on this dashboard yet.",
      });
    }
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await ctx.db.insert("googleMeetLinkStarts", {
      nonce,
      organizationId: args.organizationId,
      userId,
      createdAt: Date.now(),
    });
    const url = new URL(googleUrls().authorize);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", process.env.GOOGLE_MEET_CLIENT_ID!);
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("scope", GOOGLE_MEET_SCOPES.join(" "));
    // A refresh token, so recordings keep coming in after the first hour.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", nonce);
    return url.toString();
  },
});

async function myConnection(
  ctx: MutationCtx,
  organizationId: string,
): Promise<Doc<"googleMeetConnections"> | null> {
  const { userId } = await requireMember(ctx, organizationId);
  return await ctx.db
    .query("googleMeetConnections")
    .withIndex("by_member", (q) => q.eq("organizationId", organizationId).eq("userId", userId))
    .unique();
}

/** Whether new recordings of the caller's meetings come in by themselves. */
export const setAutoImport = mutation({
  args: { organizationId: v.string(), autoImport: v.boolean() },
  handler: async (ctx, args) => {
    const mine = await myConnection(ctx, args.organizationId);
    if (!mine) {
      throw new ConvexError({
        code: "not_connected",
        message: "Connect your Google account first.",
      });
    }
    // Switched back on: from now, not every recording made while it was off.
    await ctx.db.patch(mine._id, {
      autoImport: args.autoImport,
      ...(args.autoImport && !mine.autoImport ? { watchFrom: Date.now() } : {}),
    });
  },
});

/** Forgets the caller's Google account on this team. Recordings already brought in stay. */
export const disconnect = mutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const mine = await myConnection(ctx, args.organizationId);
    if (!mine) return;
    await ctx.db.delete(mine._id);
    // Google is told too, so the app no longer has the account's sign-in.
    await ctx.scheduler.runAfter(0, internal.googleMeet.revoke, {
      tokenCipher: mine.refreshTokenCipher,
    });
  },
});

export const revoke = internalAction({
  args: { tokenCipher: v.string() },
  handler: async (_ctx, args) => {
    try {
      const token = await decryptSecret(args.tokenCipher);
      await fetch(googleUrls().revoke, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      });
    } catch {
      // The person can also remove the app from their Google account's settings.
    }
  },
});

// Signing in.

/** Uses up a started sign-in. Null when it is unknown or too old. */
export const takeStart = internalMutation({
  args: { nonce: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("googleMeetLinkStarts")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (Date.now() - row.createdAt > START_TTL_MS) return null;
    return { organizationId: row.organizationId, userId: row.userId };
  },
});

/** Saves a Google account a member connected. Returns how it went, for the Settings page. */
export const saveConnection = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    googleUserId: v.string(),
    googleEmail: v.string(),
    googleName: v.string(),
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
    // One Google account belongs to one team, so each recording has one home.
    const elsewhere = await ctx.db
      .query("googleMeetConnections")
      .withIndex("by_google_user", (q) => q.eq("googleUserId", args.googleUserId))
      .take(10);
    for (const one of elsewhere) {
      if (one.organizationId !== args.organizationId) return "taken";
      if (one.userId !== args.userId) return "taken_here";
    }
    const mine = await ctx.db
      .query("googleMeetConnections")
      .withIndex("by_member", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", args.userId),
      )
      .unique();
    const now = Date.now();
    const fields = {
      ...args,
      connectedAt: now,
      autoImport: mine?.autoImport ?? true,
      // Recordings from meetings that end after connecting come in by themselves.
      watchFrom: mine?.watchFrom ?? now,
    };
    if (mine) await ctx.db.replace(mine._id, fields);
    else await ctx.db.insert("googleMeetConnections", fields);
    return "connected";
  },
});

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

/** Finishes a Google sign-in: trades the code for tokens, finds the account, saves it. */
export const finishLink = internalAction({
  args: { code: v.string(), state: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const start = await ctx.runMutation(internal.googleMeet.takeStart, { nonce: args.state });
    if (!start) return settingsUrl("expired");
    if (!ready()) return settingsUrl("not_ready");
    try {
      const urls = googleUrls();
      const tokenResponse = await fetch(urls.token, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          ...clientFields(),
          grant_type: "authorization_code",
          code: args.code,
          redirect_uri: redirectUri(),
        }).toString(),
      });
      if (!tokenResponse.ok) return settingsUrl("refused");
      const token = (await tokenResponse.json()) as Partial<GoogleTokens>;
      if (!token.access_token || !token.refresh_token) return settingsUrl("refused");
      // Google lets people untick what the app asks for; without these it cannot work.
      if (!grantedAll(token.scope)) {
        await ctx.runAction(internal.googleMeet.revoke, {
          tokenCipher: await encryptSecret(token.refresh_token),
        });
        return settingsUrl("missing_access");
      }
      const meResponse = await fetch(urls.userinfo, {
        headers: { authorization: `Bearer ${token.access_token}` },
      });
      if (!meResponse.ok) return settingsUrl("refused");
      const me = (await meResponse.json()) as { sub?: string; email?: string; name?: string };
      if (!me.sub) return settingsUrl("refused");
      const result = await ctx.runMutation(internal.googleMeet.saveConnection, {
        organizationId: start.organizationId,
        userId: start.userId,
        googleUserId: me.sub,
        googleEmail: me.email ?? "",
        googleName: me.name || me.email || "Google account",
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
  args: { connectionId: v.id("googleMeetConnections") },
  handler: async (ctx, args) => await ctx.db.get(args.connectionId),
});

export const saveTokens = internalMutation({
  args: {
    connectionId: v.id("googleMeetConnections"),
    accessTokenCipher: v.string(),
    refreshTokenCipher: v.optional(v.string()),
    expiresAt: v.number(),
  },
  handler: async (ctx, { connectionId, refreshTokenCipher, ...tokens }) => {
    if (!(await ctx.db.get(connectionId))) return;
    await ctx.db.patch(connectionId, {
      ...tokens,
      ...(refreshTokenCipher ? { refreshTokenCipher } : {}),
      signInLostAt: undefined,
    });
  },
});

/** Google no longer accepts the account's sign-in: stop asking, and say so in Settings. */
export const markSignInLost = internalMutation({
  args: { connectionId: v.id("googleMeetConnections") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.connectionId);
    if (row && row.signInLostAt === undefined) {
      await ctx.db.patch(row._id, { signInLostAt: Date.now() });
    }
  },
});

export class GoogleSignInError extends Error {}

/**
 * A working access token for a connected Google account, renewed when it has less than
 * `freshFor` left. Google keeps the same refresh token unless it sends a new one.
 */
export async function accessTokenFor(
  ctx: ActionCtx,
  connectionId: Id<"googleMeetConnections">,
  freshFor = RENEW_MS,
): Promise<string> {
  const row: Doc<"googleMeetConnections"> | null = await ctx.runQuery(
    internal.googleMeet.connection,
    { connectionId },
  );
  if (!row) throw new GoogleSignInError("This Google account is no longer connected.");
  if (row.expiresAt - Date.now() > freshFor) return await decryptSecret(row.accessTokenCipher);
  const response = await fetch(googleUrls().token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...clientFields(),
      grant_type: "refresh_token",
      refresh_token: await decryptSecret(row.refreshTokenCipher),
    }).toString(),
  });
  const token = (response.ok ? await response.json() : {}) as Partial<GoogleTokens>;
  if (!token.access_token) {
    // A 400 or 401 means the sign-in was taken back (or ran out); anything else may pass.
    if (response.status === 400 || response.status === 401) {
      await ctx.runMutation(internal.googleMeet.markSignInLost, { connectionId });
    }
    throw new GoogleSignInError(
      "Google no longer accepts this account's sign-in. Connect Google Meet again in Settings.",
    );
  }
  await ctx.runMutation(internal.googleMeet.saveTokens, {
    connectionId,
    accessTokenCipher: await encryptSecret(token.access_token),
    ...(token.refresh_token
      ? { refreshTokenCipher: await encryptSecret(token.refresh_token) }
      : {}),
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
  });
  return token.access_token;
}

export const importForJob = internalQuery({
  args: { googleMeetImportId: v.id("googleMeetImports") },
  handler: async (ctx, args) => await ctx.db.get(args.googleMeetImportId),
});

/** The address the toolkit fetches a recording's file from, in the organizer's Drive. */
function downloadUrl(driveFileId: string): string {
  return `${googleUrls().drive}/files/${driveFileId}?alt=media`;
}

/**
 * The sign-in header the toolkit sends to Drive when it fetches a recording. Made when the
 * job is sent, so it is never kept with the job.
 */
export async function googleMeetDownloadHeaders(
  ctx: ActionCtx,
  googleMeetImportId: Id<"googleMeetImports">,
): Promise<{ Authorization: string }> {
  const found: Doc<"googleMeetImports"> | null = await ctx.runQuery(
    internal.googleMeet.importForJob,
    { googleMeetImportId },
  );
  if (!found) {
    throw new GoogleSignInError("This Google Meet recording is no longer being brought in.");
  }
  return {
    Authorization: `Bearer ${await accessTokenFor(ctx, found.connectionId, DOWNLOAD_FRESH_MS)}`,
  };
}

// Asking Google.

class GoogleRefused extends Error {
  constructor(readonly status: number) {
    super(`Google answered HTTP ${status}.`);
  }
}

async function getJson<T>(url: string | URL, token: string): Promise<T> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new GoogleRefused(response.status);
  return (await response.json()) as T;
}

/** One finished recording, ready to bring in: the meeting it came from and its file. */
export interface FoundRecording {
  /** Meet's name for it, when it was found through Meet rather than in Drive. */
  recordingName?: string;
  driveFileId: string;
  topic: string;
  startTime: number;
  minutes: number | null;
  size: number;
  contentType: string;
}

/** The Drive file of a finished recording, or null when it is gone or unusable. */
async function withFile(
  token: string,
  recording: MeetRecording,
  fallbackStart: number,
): Promise<FoundRecording | null> {
  const fileId = finishedFile(recording);
  if (!recording.name || !fileId) return null;
  let file: DriveFile;
  try {
    file = await getJson<DriveFile>(
      `${googleUrls().drive}/files/${fileId}?fields=id,name,size,mimeType,trashed`,
      token,
    );
  } catch (error) {
    // Someone deleted the recording from their Drive: nothing to bring in.
    if (error instanceof GoogleRefused && (error.status === 404 || error.status === 403)) {
      return null;
    }
    throw error;
  }
  if (file.trashed) return null;
  return {
    recordingName: recording.name,
    driveFileId: fileId,
    topic: meetingTitle(file.name) || FALLBACK_TOPIC,
    startTime: timeOf(recording.startTime, fallbackStart),
    minutes: minutesOf(recording),
    size: Number(file.size ?? 0) || 0,
    contentType: file.mimeType?.startsWith("video/") ? file.mimeType : "video/mp4",
  };
}

/** A Meet recording found in Drive, ready to bring in. */
function fromDriveFile(file: DriveFile): FoundRecording | null {
  if (!file.id || !isDriveFileId(file.id) || file.trashed) return null;
  if (!file.mimeType?.startsWith("video/")) return null;
  const minutes = minutesOfFile(file);
  // Drive has the file from when the recording finished saving: the meeting began about
  // its length before that.
  const saved = timeOf(file.createdTime, Date.now());
  return {
    driveFileId: file.id,
    topic: meetingTitle(file.name) || FALLBACK_TOPIC,
    startTime: minutes ? saved - minutes * 60_000 : saved,
    minutes,
    size: Number(file.size ?? 0) || 0,
    contentType: file.mimeType,
  };
}

/** One page of the person's Meet recordings in Drive, newest first. */
async function recordingsInDrive(
  token: string,
  pageToken: string | undefined,
): Promise<{ found: FoundRecording[]; nextPageToken: string | null }> {
  const url = new URL(`${googleUrls().drive}/files`);
  url.searchParams.set("q", DRIVE_RECORDINGS_QUERY);
  url.searchParams.set("orderBy", "createdTime desc");
  url.searchParams.set("pageSize", String(PAST_PAGE));
  url.searchParams.set("fields", `nextPageToken,files(${DRIVE_FILE_FIELDS})`);
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const body = await getJson<{ files?: DriveFile[]; nextPageToken?: string }>(url, token);
  const found: FoundRecording[] = [];
  for (const file of body.files ?? []) {
    const one = fromDriveFile(file);
    if (one) found.push(one);
  }
  return { found, nextPageToken: body.nextPageToken ?? null };
}

/** The finished recordings of meetings the person organized that ended since `since`. */
async function recordingsSince(token: string, since: number): Promise<FoundRecording[]> {
  const { meet } = googleUrls();
  const records: ConferenceRecord[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const url = new URL(`${meet}/conferenceRecords`);
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("filter", `end_time>="${new Date(since).toISOString()}"`);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const body = await getJson<{ conferenceRecords?: ConferenceRecord[]; nextPageToken?: string }>(
      url,
      token,
    );
    records.push(...(body.conferenceRecords ?? []));
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  const found: FoundRecording[] = [];
  for (const record of records) {
    // Meetings still going on have nothing finished yet.
    if (!record.name || !record.endTime) continue;
    const { recordings = [] } = await getJson<{ recordings?: MeetRecording[] }>(
      `${meet}/${record.name}/recordings`,
      token,
    );
    const start = timeOf(record.startTime, Date.now());
    const files = await Promise.all(recordings.map((one) => withFile(token, one, start)));
    for (const file of files) if (file) found.push(file);
  }
  return found.sort((a, b) => b.startTime - a.startTime);
}

/** Google's answer turned into something to tell the person. */
function asConvexError(error: unknown): ConvexError<{ code: string; message: string }> {
  if (error instanceof GoogleSignInError) {
    return new ConvexError({ code: "google_sign_in", message: error.message });
  }
  if (error instanceof GoogleRefused) {
    return new ConvexError({
      code: "google_refused",
      message:
        error.status === 403
          ? "Google did not let the dashboard see your meetings. Connect Google Meet again and allow everything it asks for."
          : `Google did not list your recordings (HTTP ${error.status}). Try again.`,
    });
  }
  return new ConvexError({
    code: "unreachable",
    message: "Google could not be reached. Try again.",
  });
}

// Bringing a recording in.

const recordingValidator = v.object({
  recordingName: v.optional(v.string()),
  driveFileId: v.string(),
  topic: v.string(),
  startTime: v.number(),
  minutes: v.union(v.number(), v.null()),
  size: v.number(),
  contentType: v.string(),
});

type StartOutcome = "started" | "already" | "duplicate" | "no_toolkit" | "gone";

/**
 * An upload the team already has with the very same file: the same size in bytes. A
 * recording's file is hundreds of megabytes, so two different ones do not share a size.
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
 * toolkit stream the file from Drive into the team's folder. A recording already brought
 * in, or on its way, is left alone; one that failed is tried again. One whose file is
 * already in Uploads is marked as such and not brought in again.
 */
export const startImport = internalMutation({
  args: { connectionId: v.id("googleMeetConnections"), recording: recordingValidator },
  handler: async (ctx, args): Promise<StartOutcome> => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return "gone";
    const { organizationId } = connection;
    const { recording } = args;
    const before = await ctx.db
      .query("googleMeetImports")
      .withIndex("by_file", (q) =>
        q.eq("organizationId", organizationId).eq("driveFileId", recording.driveFileId),
      )
      .first();
    if (before && (before.status === "importing" || before.status === "done")) return "already";
    const twin = await sameFileIn(ctx, organizationId, recording.size);
    if (twin) {
      const fields = {
        status: "duplicate" as const,
        uploadId: twin._id,
        connectionId: connection._id,
        error: undefined,
      };
      if (before) await ctx.db.patch(before._id, fields);
      else {
        await ctx.db.insert("googleMeetImports", {
          organizationId,
          recordingName: recording.recordingName,
          driveFileId: recording.driveFileId,
          topic: recording.topic,
          startTime: recording.startTime,
          ...fields,
        });
      }
      return "duplicate";
    }

    const fileName = recordingFileName(recording.topic, recording.startTime, "mp4", FALLBACK_TOPIC);
    const key = `uploads/${crypto.randomUUID()}/${safeName(fileName)}`;
    const importId =
      before?._id ??
      (await ctx.db.insert("googleMeetImports", {
        organizationId,
        connectionId: connection._id,
        recordingName: recording.recordingName,
        driveFileId: recording.driveFileId,
        topic: recording.topic,
        startTime: recording.startTime,
        status: "importing",
      }));
    const queued = await enqueueJob(ctx, {
      organizationId,
      stepId: "storage-upload-s3",
      input: {
        file_url: downloadUrl(recording.driveFileId),
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
      source: "google_meet",
    });
    await ctx.db.patch(queued.jobId, { googleMeetImportId: importId });
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

/**
 * The toolkit finished (or gave up on) a recording's job. A finished one becomes a ready
 * upload: it joins the library, its details are read, and upload automations start.
 */
export async function onGoogleMeetJobFinished(
  ctx: MutationCtx,
  job: Doc<"jobs">,
  ok: boolean,
  error: string | null,
): Promise<void> {
  if (!job.googleMeetImportId) return;
  const found = await ctx.db.get(job.googleMeetImportId);
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

/**
 * The Drive files a team has brought in already (or is bringing in). With `failed`, also
 * those that did not come in: the automatic check leaves those for a person to retry.
 */
async function broughtFiles(
  ctx: Pick<QueryCtx, "db">,
  organizationId: string,
  { failed = false } = {},
): Promise<string[]> {
  const imports = await ctx.db
    .query("googleMeetImports")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .order("desc")
    .take(500);
  return imports.filter((one) => failed || one.status !== "failed").map((one) => one.driveFileId);
}

/** The connection a member made on a team, for the actions below. */
export const mine = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const row = await ctx.db
      .query("googleMeetConnections")
      .withIndex("by_member", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", userId),
      )
      .unique();
    if (!row) {
      throw new ConvexError({
        code: "not_connected",
        message: "Connect your Google account first.",
      });
    }
    return row._id;
  },
});

/**
 * Where each recording stands for the team: "new" to bring in, "brought" in already (or on
 * its way), or "duplicate" when its file is already in Uploads some other way.
 */
export const standing = internalQuery({
  args: {
    organizationId: v.string(),
    files: v.array(v.object({ driveFileId: v.string(), size: v.number() })),
  },
  handler: async (ctx, args): Promise<Standing[]> => {
    const out: Standing[] = [];
    for (const file of args.files) {
      const before = await ctx.db
        .query("googleMeetImports")
        .withIndex("by_file", (q) =>
          q.eq("organizationId", args.organizationId).eq("driveFileId", file.driveFileId),
        )
        .first();
      if (before && (before.status === "importing" || before.status === "done")) {
        out.push("brought");
      } else if (await sameFileIn(ctx, args.organizationId, file.size)) {
        out.push("duplicate");
      } else {
        out.push("new");
      }
    }
    return out;
  },
});

type Standing = "new" | "brought" | "duplicate";

export interface PastRecording {
  driveFileId: string;
  topic: string;
  startTime: number;
  minutes: number | null;
  size: number;
  standing: Standing;
}

/**
 * The caller's Meet recordings in Drive, newest first, a page at a time, saying which are
 * in Uploads already. Goes back as far as Drive does, not just Meet's 30 days.
 */
export const pastRecordings = action({
  args: { organizationId: v.string(), pageToken: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ recordings: PastRecording[]; nextPageToken: string | null }> => {
    const connectionId: Id<"googleMeetConnections"> = await ctx.runQuery(internal.googleMeet.mine, {
      organizationId: args.organizationId,
    });
    let page: { found: FoundRecording[]; nextPageToken: string | null };
    try {
      const token = await accessTokenFor(ctx, connectionId);
      page = await recordingsInDrive(token, args.pageToken);
    } catch (error) {
      throw asConvexError(error);
    }
    const standings: Standing[] = await ctx.runQuery(internal.googleMeet.standing, {
      organizationId: args.organizationId,
      files: page.found.map((one) => ({ driveFileId: one.driveFileId, size: one.size })),
    });
    return {
      recordings: page.found.map((one, at) => ({
        driveFileId: one.driveFileId,
        topic: one.topic,
        startTime: one.startTime,
        minutes: one.minutes,
        size: one.size,
        standing: standings[at],
      })),
      nextPageToken: page.nextPageToken,
    };
  },
});

/** Brings in one of the caller's Meet recordings, by its file in Drive. */
export const bringIn = action({
  args: { organizationId: v.string(), driveFileId: v.string() },
  handler: async (ctx, args): Promise<StartOutcome> => {
    const connectionId: Id<"googleMeetConnections"> = await ctx.runQuery(internal.googleMeet.mine, {
      organizationId: args.organizationId,
    });
    if (!isDriveFileId(args.driveFileId)) {
      throw new ConvexError({ code: "not_found", message: "Google has no such recording." });
    }
    // Looked up again rather than taken from the browser: Google's answer is the truth.
    let recording: FoundRecording | null;
    try {
      const token = await accessTokenFor(ctx, connectionId);
      const file = await getJson<DriveFile>(
        `${googleUrls().drive}/files/${args.driveFileId}?fields=${DRIVE_FILE_FIELDS}&supportsAllDrives=true`,
        token,
      );
      recording = fromDriveFile(file);
    } catch (error) {
      if (error instanceof GoogleRefused && (error.status === 404 || error.status === 403)) {
        recording = null;
      } else throw asConvexError(error);
    }
    if (!recording) {
      throw new ConvexError({
        code: "not_found",
        message: "Google no longer has that recording in your Drive.",
      });
    }
    const outcome = await ctx.runMutation(internal.googleMeet.startImport, {
      connectionId,
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

// Checking for new recordings, every few minutes.

/** Every connected account that brings recordings in by itself gets a check of its own. */
export const checkAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("googleMeetConnections").take(2000);
    let at = 0;
    for (const row of rows) {
      if (!row.autoImport || row.signInLostAt !== undefined) continue;
      // Spread out a little, so many accounts do not all ask Google at once.
      await ctx.scheduler.runAfter(at, internal.googleMeet.checkOne, { connectionId: row._id });
      at += 250;
    }
  },
});

export const toCheck = internalQuery({
  args: { connectionId: v.id("googleMeetConnections") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.connectionId);
    if (!row || !row.autoImport || row.signInLostAt !== undefined) return null;
    return {
      watchFrom: row.watchFrom,
      seen: await broughtFiles(ctx, row.organizationId, { failed: true }),
    };
  },
});

/**
 * Asks Google about one account's meetings that ended recently, and brings in each
 * recording that has finished saving and is not in yet. Recordings of meetings that ended
 * before the account was connected stay for "Show the last 30 days".
 */
export const checkOne = internalAction({
  args: { connectionId: v.id("googleMeetConnections") },
  handler: async (ctx, args): Promise<number> => {
    const state = await ctx.runQuery(internal.googleMeet.toCheck, args);
    if (!state) return 0;
    let found: FoundRecording[];
    try {
      const token = await accessTokenFor(ctx, args.connectionId);
      found = await recordingsSince(token, Math.max(state.watchFrom, Date.now() - CHECK_WINDOW_MS));
    } catch {
      // A lost sign-in is marked on the account (Settings says so); anything else waits
      // for the next check.
      return 0;
    }
    let started = 0;
    for (const recording of found) {
      if (state.seen.includes(recording.driveFileId)) continue;
      const outcome = await ctx.runMutation(internal.googleMeet.startImport, {
        connectionId: args.connectionId,
        recording,
      });
      if (outcome === "started") started++;
    }
    return started;
  },
});
