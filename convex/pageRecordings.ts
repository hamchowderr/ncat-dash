// Page recordings: a storyboard take marked "Page recording" made into a video of a web
// page by the agent. Someone gives the page and, if they like, what to show and a saved
// sign-in; the recording waits its turn in recordingPool (one at a time), the agent server
// works out the clicks and records them (packages/agent/src/mastra/ncat/page-recording.ts),
// the toolkit turns the video into MP4, and it is kept in the team's folder like an upload
// and put into the take. The clicks are kept, so the take can be recorded again the same
// way after the page changes, with no AI.
//
// Saved sign-ins (recordingSignIns): a site someone signed in to once in a Firecrawl
// browser they drove themselves, kept as a Firecrawl profile that recordings open.

import { vOnCompleteArgs } from "@convex-dev/workpool";
import { freeName, keyOfUrl, uploadRef } from "@takewon/automation-core";
import { callStep, getStep } from "@takewon/step-catalog";
import type { FunctionReturnType } from "convex/server";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireMember } from "./lib/authz";
import {
  type Bucket,
  bucketOf,
  copyObject,
  deleteObject,
  listObjects,
  presign,
  storageConnection,
} from "./lib/bucket";
import { addUploadToLibrary } from "./lib/library";
import {
  cleanPageUrl,
  isUnderWay,
  profileName,
  RECORDING_LIMITS,
  RECORDINGS_FOLDER,
  recordingFileName,
  type WalkStep,
} from "./lib/pageRecording";
import { recordingPool } from "./lib/pools";
import { signAgentToken } from "./reviewAgent";
import { walkStepValidator } from "./schema";

const fail = (code: string, message: string): never => {
  throw new ConvexError({ code, message });
};

/** A take's recording can run this long at the agent server: work out the clicks, then record up to two minutes. */
const TAKE_TIMEOUT_MS = 7 * 60 * 1000;
const CONVERT_TIMEOUT_MS = 2 * 60 * 1000;
const SIGN_IN_TIMEOUT_MS = 60 * 1000;
const LINK_SECONDS = 60 * 60;

const NOT_SET_UP =
  "The agent is not set up on this dashboard yet, and it is what records pages. Whoever runs the dashboard sets AGENT_URL and MASTRA_JWT_SECRET for Convex.";

const aspectOf = (aspect: Doc<"storyboards">["aspect"]) => aspect;

// ---------------------------------------------------------------------------------------
// Reading

const recordingView = v.object({
  _id: v.id("takeRecordings"),
  takeId: v.id("storyboardTakes"),
  url: v.string(),
  notes: v.string(),
  signInId: v.union(v.null(), v.id("recordingSignIns")),
  steps: v.array(walkStepValidator),
  status: v.union(
    v.literal("queued"),
    v.literal("finding"),
    v.literal("found"),
    v.literal("recording"),
    v.literal("saving"),
    v.literal("done"),
    v.literal("failed"),
  ),
  problem: v.union(v.null(), v.string()),
  uploadId: v.union(v.null(), v.id("uploads")),
  durationMs: v.union(v.null(), v.number()),
  /** For a page the agent found by searching: a picture of it, and its title. */
  previewUrl: v.union(v.null(), v.string()),
  pageTitle: v.union(v.null(), v.string()),
  /** Where it is in the line: 1 for next. Only while it waits. */
  place: v.union(v.null(), v.number()),
  updatedAt: v.number(),
});

/** Every take's latest page recording on a storyboard. */
export const forStoryboard = query({
  args: { storyboardId: v.id("storyboards") },
  returns: v.array(recordingView),
  handler: async (ctx, args) => {
    const board = await ctx.db.get(args.storyboardId);
    if (!board) return [];
    await requireMember(ctx, board.organizationId);
    const rows = await ctx.db
      .query("takeRecordings")
      .withIndex("by_storyboard", (q) => q.eq("storyboardId", args.storyboardId))
      .take(500);
    // Recordings wait in one line for the whole dashboard; a place in it helps the wait.
    const waiting = rows.some((row) => row.status === "queued")
      ? await ctx.db
          .query("takeRecordings")
          .withIndex("by_organization", (q) => q.eq("organizationId", board.organizationId))
          .take(500)
      : [];
    const line = waiting
      .filter((row) => row.status === "queued")
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .map((row) => row._id);
    return await Promise.all(
      rows.map(async (row) => ({
        _id: row._id,
        takeId: row.takeId,
        url: row.url,
        notes: row.notes,
        signInId: row.signInId ?? null,
        steps: row.steps ?? [],
        status: row.status,
        problem: row.problem ?? null,
        uploadId: row.uploadId ?? null,
        durationMs: row.durationMs ?? null,
        previewUrl: row.previewId ? await ctx.storage.getUrl(row.previewId) : null,
        pageTitle: row.pageTitle ?? null,
        place: row.status === "queued" ? line.indexOf(row._id) + 1 || null : null,
        updatedAt: row.updatedAt,
      })),
    );
  },
});

// ---------------------------------------------------------------------------------------
// Recording a take

/**
 * Puts a take's page recording in line. `again` plays the clicks the last recording kept;
 * otherwise the agent works out new ones from the line, the page and the notes. With no
 * page address the agent finds the page itself and stops at "found", for the person to
 * check it; `again` then records it. `findAnother` searches again, leaving that page out.
 */
export const record = mutation({
  args: {
    takeId: v.id("storyboardTakes"),
    url: v.optional(v.string()),
    notes: v.optional(v.string()),
    signInId: v.optional(v.union(v.null(), v.id("recordingSignIns"))),
    again: v.optional(v.boolean()),
    findAnother: v.optional(v.boolean()),
  },
  returns: v.id("takeRecordings"),
  handler: async (ctx, args): Promise<Id<"takeRecordings">> => {
    const take = await ctx.db.get(args.takeId);
    if (!take) return fail("not_found", "That take is gone.");
    const { userId } = await requireMember(ctx, take.organizationId);
    if (!take.parts.includes("recording")) {
      return fail("invalid_input", "This take has no page recording. Add one to the take first.");
    }
    const given = (args.url ?? "").trim();
    // Left empty, the agent finds the page.
    const url = given ? cleanPageUrl(given) : "";
    if (url === null) {
      return fail("invalid_input", "Give the page's web address, starting https://.");
    }
    const notes = (args.notes ?? "").trim().slice(0, RECORDING_LIMITS.notes);
    let signInId: Id<"recordingSignIns"> | undefined;
    if (args.signInId) {
      const signIn = await ctx.db.get(args.signInId);
      if (!signIn || signIn.organizationId !== take.organizationId) {
        return fail("not_found", "That saved sign-in is gone.");
      }
      if (!canUseSignIn(signIn, userId)) {
        return fail(
          "forbidden",
          `${signIn.name} is a teammate's own sign-in. Pick your own, or ask them to share it with the team.`,
        );
      }
      if (signIn.status !== "saved") {
        return fail("invalid_input", `Finish signing in to ${signIn.name} first.`);
      }
      signInId = signIn._id;
    }
    const before = await ctx.db
      .query("takeRecordings")
      .withIndex("by_take", (q) => q.eq("takeId", take._id))
      .unique();
    if (before && isUnderWay(before.status)) {
      return fail("busy", "This take is already being recorded.");
    }
    const again = args.again === true;
    if (again && !before?.steps?.length) {
      return fail("invalid_input", "This take has no saved clicks yet. Record it first.");
    }
    const findAnother = !again && args.findAnother === true && Boolean(before?.url);
    const avoid =
      findAnother && before ? [...(before.avoid ?? []), before.url].slice(-10) : undefined;
    // A new page or a new search makes the picture of the old one out of date.
    if (!again && before?.previewId) await ctx.storage.delete(before.previewId);
    const fields = {
      url: again && before ? before.url : findAnother ? "" : url,
      notes,
      signInId,
      status: "queued" as const,
      problem: undefined,
      again,
      requestedBy: userId,
      updatedAt: Date.now(),
    };
    let recordingId: Id<"takeRecordings">;
    if (before) {
      // A new path is worked out from the page given now; recording again keeps the old one.
      await ctx.db.patch(before._id, {
        ...fields,
        ...(again ? {} : { steps: undefined, previewId: undefined, pageTitle: undefined, avoid }),
      });
      recordingId = before._id;
    } else {
      recordingId = await ctx.db.insert("takeRecordings", {
        ...fields,
        organizationId: take.organizationId,
        storyboardId: take.storyboardId,
        takeId: take._id,
      });
    }
    await recordingPool.enqueueAction(
      ctx,
      internal.pageRecordings.make,
      { recordingId },
      { onComplete: internal.pageRecordings.ended, context: { recordingId } },
    );
    return recordingId;
  },
});

/** Everything making a recording needs, read in one go. */
export const forMaking = internalQuery({
  args: { recordingId: v.id("takeRecordings") },
  handler: async (ctx, args) => {
    const recording = await ctx.db.get(args.recordingId);
    if (!recording) return null;
    const take = await ctx.db.get(recording.takeId);
    const board = await ctx.db.get(recording.storyboardId);
    if (!take || !board) return null;
    // The take's number through the whole video, for the file's name.
    const chapters = await ctx.db
      .query("storyboardChapters")
      .withIndex("by_storyboard", (q) => q.eq("storyboardId", board._id))
      .take(100);
    const takes = await ctx.db
      .query("storyboardTakes")
      .withIndex("by_storyboard", (q) => q.eq("storyboardId", board._id))
      .take(500);
    const order = new Map(chapters.map((chapter) => [chapter._id, chapter.order]));
    takes.sort(
      (a, b) => (order.get(a.chapterId) ?? 0) - (order.get(b.chapterId) ?? 0) || a.order - b.order,
    );
    const signIn = recording.signInId ? await ctx.db.get(recording.signInId) : null;
    return {
      recording,
      line: take.line,
      number: takes.findIndex((one) => one._id === take._id) + 1,
      aspect: aspectOf(board.aspect),
      // Only a sign-in the person who asked may use: their own, or one shared with the team.
      profile:
        signIn?.status === "saved" && canUseSignIn(signIn, recording.requestedBy)
          ? signIn.profile
          : null,
      connection: await storageConnection(ctx, recording.organizationId),
    };
  },
});

export const setStatus = internalMutation({
  args: {
    recordingId: v.id("takeRecordings"),
    status: v.union(v.literal("finding"), v.literal("recording"), v.literal("saving")),
    steps: v.optional(v.array(walkStepValidator)),
  },
  handler: async (ctx, args) => {
    const recording = await ctx.db.get(args.recordingId);
    if (!recording) return;
    await ctx.db.patch(recording._id, {
      status: args.status,
      updatedAt: Date.now(),
      ...(args.steps ? { steps: args.steps } : {}),
    });
  },
});

export const failed = internalMutation({
  args: { recordingId: v.id("takeRecordings"), problem: v.string() },
  handler: async (ctx, args) => {
    const recording = await ctx.db.get(args.recordingId);
    if (!recording || !isUnderWay(recording.status)) return;
    await ctx.db.patch(recording._id, {
      status: "failed",
      problem: args.problem.slice(0, 500),
      updatedAt: Date.now(),
    });
  },
});

/** Called by the pool when making a recording ended: one that crashed says so. */
export const ended = internalMutation({
  args: vOnCompleteArgs(v.object({ recordingId: v.id("takeRecordings") })),
  handler: async (ctx, { context, result }) => {
    if (result.kind === "success") return;
    const recording = await ctx.db.get(context.recordingId);
    if (!recording || !isUnderWay(recording.status)) return;
    await ctx.db.patch(recording._id, {
      status: "failed",
      problem:
        result.kind === "canceled"
          ? "The recording was stopped."
          : "The recording stopped part-way. Record it again.",
      updatedAt: Date.now(),
    });
  },
});

/** The page the agent found by searching, waiting for the person to check it. */
export const found = internalMutation({
  args: {
    recordingId: v.id("takeRecordings"),
    url: v.string(),
    title: v.string(),
    steps: v.array(walkStepValidator),
    previewId: v.union(v.null(), v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const recording = await ctx.db.get(args.recordingId);
    if (!recording || recording.status !== "finding") {
      if (args.previewId) await ctx.storage.delete(args.previewId);
      return;
    }
    await ctx.db.patch(recording._id, {
      status: "found",
      url: args.url,
      pageTitle: args.title || undefined,
      steps: args.steps,
      previewId: args.previewId ?? undefined,
      problem: undefined,
      updatedAt: Date.now(),
    });
  },
});

/** Keeps the finished video as one of the team's uploads and puts it into the take. */
export const saved = internalMutation({
  args: {
    recordingId: v.id("takeRecordings"),
    key: v.string(),
    fileName: v.string(),
    size: v.number(),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    const recording = await ctx.db.get(args.recordingId);
    if (!recording) return;
    const uploadId = await ctx.db.insert("uploads", {
      organizationId: recording.organizationId,
      key: args.key,
      fileName: args.fileName,
      contentType: "video/mp4",
      size: args.size,
      status: "ready",
      createdBy: recording.requestedBy,
      purpose: "recording",
    });
    const upload = (await ctx.db.get(uploadId))!;
    await addUploadToLibrary(ctx, upload);
    // Its length and picture size, read by the toolkit like any upload's.
    await ctx.scheduler.runAfter(0, internal.storage.readDetails, { uploadId });
    const take = await ctx.db.get(recording.takeId);
    if (take?.parts.includes("recording")) {
      await ctx.db.patch(take._id, { files: { ...take.files, recording: uploadRef(uploadId) } });
      await ctx.db.patch(take.storyboardId, { updatedAt: Date.now() });
    }
    if (recording.previewId) await ctx.storage.delete(recording.previewId);
    await ctx.db.patch(recording._id, {
      status: "done",
      problem: undefined,
      previewId: undefined,
      uploadId,
      durationMs: args.durationMs,
      updatedAt: Date.now(),
    });
  },
});

type FoundAnswer = {
  steps?: WalkStep[];
  url?: string;
  title?: string;
  preview?: string | null;
  error?: string;
};

type AgentAnswer = {
  steps?: WalkStep[];
  durationMs?: number;
  error?: string;
  code?: string;
};

/** A problem a person can act on: kept on the recording, and the pool told it ended. */
class Stop extends Error {}

async function stop(ctx: ActionCtx, recordingId: Id<"takeRecordings">, problem: string) {
  await ctx.runMutation(internal.pageRecordings.failed, { recordingId, problem });
  throw new Stop(problem);
}

/** The toolkit's link for a converted file, from its answer. */
function linkOf(answer: unknown): string | null {
  const response = (answer as { response?: unknown } | null)?.response;
  if (typeof response === "string") return response;
  const url = (response as { file_url?: unknown; url?: unknown } | null) ?? null;
  if (typeof url?.file_url === "string") return url.file_url;
  if (typeof url?.url === "string") return url.url;
  return null;
}

type Making = NonNullable<FunctionReturnType<typeof internal.pageRecordings.forMaking>>;

/** A take with no address: the agent finds the page itself, and nothing is recorded yet. */
async function findThePage(ctx: ActionCtx, found: Making, agentUrl: string, secret: string) {
  const { recording } = found;
  const recordingId = recording._id;
  await ctx.runMutation(internal.pageRecordings.setStatus, { recordingId, status: "finding" });
  let answer: FoundAnswer | null = null;
  let status = 0;
  try {
    const response = await fetch(new URL("/ncat/find-page", agentUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await signAgentToken(secret, recording.requestedBy)}`,
      },
      body: JSON.stringify({
        organizationId: recording.organizationId,
        line: found.line,
        notes: recording.notes,
        aspect: found.aspect,
        profile: found.profile,
        avoid: recording.avoid ?? [],
      }),
      signal: AbortSignal.timeout(TAKE_TIMEOUT_MS),
    });
    status = response.status;
    answer = (await response.json().catch(() => null)) as FoundAnswer | null;
  } catch {
    return await stop(ctx, recordingId, "The agent could not be reached. Try again in a moment.");
  }
  const url = answer?.url ? cleanPageUrl(answer.url) : null;
  if (status !== 200 || !answer?.steps?.length || !url) {
    return await stop(ctx, recordingId, answer?.error ?? "The agent did not find a page.");
  }
  let previewId: Id<"_storage"> | null = null;
  if (answer.preview) {
    const bytes = Uint8Array.from(atob(answer.preview.slice(0, 4_000_000)), (c) => c.charCodeAt(0));
    previewId = await ctx.storage.store(new Blob([bytes], { type: "image/jpeg" }));
  }
  await ctx.runMutation(internal.pageRecordings.found, {
    recordingId,
    url,
    title: (answer.title ?? "").slice(0, 300),
    steps: answer.steps.slice(0, RECORDING_LIMITS.steps),
    previewId,
  });
}

/**
 * Makes one recording, from recordingPool: the agent server records the take and sends
 * the video into the bucket, the toolkit turns it into MP4, and the MP4 is kept in the
 * team's "Page Recordings" folder.
 */
export const make = internalAction({
  args: { recordingId: v.id("takeRecordings") },
  handler: async (ctx, args): Promise<void> => {
    const { recordingId } = args;
    try {
      const found = await ctx.runQuery(internal.pageRecordings.forMaking, args);
      if (!found || found.recording.status !== "queued") return;
      const { recording, connection } = found;
      const agentUrl = process.env.AGENT_URL;
      const secret = process.env.MASTRA_JWT_SECRET;
      if (!agentUrl || !secret) return await stop(ctx, recordingId, NOT_SET_UP);
      if (!connection?.storage) {
        return await stop(
          ctx,
          recordingId,
          "This team has no storage for files yet, so there is nowhere to keep the video.",
        );
      }
      if (recording.signInId && !found.profile) {
        return await stop(
          ctx,
          recordingId,
          "The sign-in picked for this take is not saved, or is no longer shared with you. Pick a sign-in and record it again.",
        );
      }
      if (!recording.again && !recording.url) {
        return await findThePage(ctx, found, agentUrl, secret);
      }
      await ctx.runMutation(internal.pageRecordings.setStatus, {
        recordingId,
        status: "recording",
      });

      const bucket = await bucketOf(connection);
      // The raw recording waits outside the team's folder until it is converted, so Files
      // never shows the .avi.
      const whole: Bucket = { ...bucket, root: "" };
      const rawKey = `page-recordings/${recording.organizationId}/${recordingId}-${Date.now()}.avi`;
      const uploadUrl = await presign(whole, "PUT", rawKey, LINK_SECONDS);

      let answer: AgentAnswer | null = null;
      let status = 0;
      try {
        const response = await fetch(new URL("/ncat/record", agentUrl), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${await signAgentToken(secret, recording.requestedBy)}`,
          },
          body: JSON.stringify({
            organizationId: recording.organizationId,
            line: found.line,
            url: recording.url,
            notes: recording.notes,
            aspect: found.aspect,
            profile: found.profile,
            steps: recording.again && recording.steps?.length ? recording.steps : null,
            uploadUrl,
          }),
          signal: AbortSignal.timeout(TAKE_TIMEOUT_MS),
        });
        status = response.status;
        answer = (await response.json().catch(() => null)) as AgentAnswer | null;
      } catch {
        return await stop(
          ctx,
          recordingId,
          "The agent could not be reached. Record it again in a moment.",
        );
      }
      if (status !== 200 || !answer?.steps?.length) {
        const why =
          status === 409
            ? "Another page recording was being made on the agent server. Record it again in a moment."
            : (answer?.error ?? "The agent did not finish the recording.");
        return await stop(ctx, recordingId, why);
      }
      await ctx.runMutation(internal.pageRecordings.setStatus, {
        recordingId,
        status: "saving",
        steps: answer.steps.slice(0, RECORDING_LIMITS.steps),
      });

      // The toolkit turns the Motion-JPEG .avi into an MP4 that plays everywhere.
      const step = getStep("media-convert");
      if (!step) return await stop(ctx, recordingId, "This toolkit cannot convert videos.");
      let converted: string | null = null;
      try {
        converted = linkOf(
          await callStep(
            bucket,
            step,
            {
              media_url: await presign(whole, "GET", rawKey, LINK_SECONDS),
              format: "mp4",
              video_codec: "libx264",
              video_crf: 23,
            },
            { signal: AbortSignal.timeout(CONVERT_TIMEOUT_MS) },
          ),
        );
      } catch {
        converted = null;
      }
      if (!converted) {
        return await stop(
          ctx,
          recordingId,
          "The toolkit could not turn the recording into a video.",
        );
      }

      const folder = RECORDINGS_FOLDER;
      const wanted = recordingFileName(found.number, found.line);
      const taken = new Set(
        (await listObjects(bucket, folder, 1)).map((object) => object.key.slice(folder.length)),
      );
      const fileName = freeName(wanted, (candidate) => taken.has(candidate));
      const key = `${folder}${fileName}`;
      const from = connection.storage.endpoint
        ? keyOfUrl(
            {
              endpoint: connection.storage.endpoint,
              bucket: connection.storage.bucket,
              ...(connection.storage.publicUrl ? { publicUrl: connection.storage.publicUrl } : {}),
            },
            converted,
          )
        : null;
      let size = 0;
      if (from !== null) {
        await copyObject(whole, from, `${bucket.root}${key}`);
        await deleteObject(whole, from).catch(() => undefined);
      } else {
        // The toolkit's link does not name a key in the bucket: copy the bytes over.
        const video = await fetch(converted, { signal: AbortSignal.timeout(CONVERT_TIMEOUT_MS) });
        if (!video.ok) {
          return await stop(ctx, recordingId, "The converted video could not be fetched.");
        }
        const bytes = await video.arrayBuffer();
        size = bytes.byteLength;
        const put = await fetch(await presign(bucket, "PUT", key, LINK_SECONDS), {
          method: "PUT",
          headers: { "content-type": "video/mp4" },
          body: bytes,
        });
        if (!put.ok)
          return await stop(ctx, recordingId, "The video could not be kept in your storage.");
      }
      await deleteObject(whole, rawKey).catch(() => undefined);
      if (!size) {
        const listed = await listObjects(bucket, key, 1);
        size = listed.find((object) => object.key === key)?.size ?? 0;
      }
      await ctx.runMutation(internal.pageRecordings.saved, {
        recordingId,
        key,
        fileName,
        size,
        durationMs: answer.durationMs ?? 0,
      });
    } catch (caught) {
      if (caught instanceof Stop) return;
      await ctx.runMutation(internal.pageRecordings.failed, {
        recordingId,
        problem: "The recording stopped part-way. Record it again.",
      });
    }
  },
});

// ---------------------------------------------------------------------------------------
// Saved sign-ins

const signInView = v.object({
  _id: v.id("recordingSignIns"),
  name: v.string(),
  url: v.string(),
  status: v.union(v.literal("signing_in"), v.literal("saved")),
  savedAt: v.union(v.null(), v.number()),
  /** Whether it is the person's own (only they may change, share or remove it). */
  mine: v.boolean(),
  shared: v.boolean(),
});

/** Whether a person may record with a sign-in: their own, or one shared with the team. */
export const canUseSignIn = (signIn: Doc<"recordingSignIns">, userId: string) =>
  signIn.createdBy === userId || signIn.shared === true;

async function teamSignIns(ctx: QueryCtx, organizationId: string) {
  return await ctx.db
    .query("recordingSignIns")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(500);
}

/**
 * The sign-ins a person may record with: their own, and the ones teammates shared with
 * the team. A teammate's own sign-in is never listed: it is theirs.
 */
export const signIns = query({
  args: { organizationId: v.string() },
  returns: v.array(signInView),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const rows = (await teamSignIns(ctx, args.organizationId)).filter((row) =>
      canUseSignIn(row, userId),
    );
    return rows
      .map((row) => ({
        _id: row._id,
        name: row.name,
        url: row.url,
        status: row.status,
        savedAt: row.savedAt ?? null,
        mine: row.createdBy === userId,
        shared: row.shared === true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const addSignIn = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    url: v.string(),
    shared: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ signInId: Id<"recordingSignIns">; profile: string }> => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const name = args.name.trim().replace(/\s+/g, " ");
    if (!name) return fail("invalid_input", "Give the sign-in a name, such as the site's.");
    if (name.length > RECORDING_LIMITS.signInName) {
      return fail("invalid_input", `Keep the name to ${RECORDING_LIMITS.signInName} letters.`);
    }
    const url = cleanPageUrl(args.url);
    if (!url)
      return fail("invalid_input", "Give the sign-in page's web address, starting https://.");
    const team = await teamSignIns(ctx, args.organizationId);
    if (team.filter((row) => row.createdBy === userId).length >= RECORDING_LIMITS.signIns) {
      return fail("limit", `You can keep up to ${RECORDING_LIMITS.signIns} sign-ins.`);
    }
    // Names are told apart among the sign-ins this person sees.
    const seen = team.filter((row) => canUseSignIn(row, userId));
    if (seen.some((row) => row.name.toLowerCase() === name.toLowerCase())) {
      return fail("exists", `There is already a sign-in called ${name}.`);
    }
    const signInId = await ctx.db.insert("recordingSignIns", {
      organizationId: args.organizationId,
      name,
      url,
      profile: "",
      status: "signing_in",
      createdBy: userId,
      shared: args.shared === true,
    });
    const profile = profileName(args.organizationId, signInId);
    await ctx.db.patch(signInId, { profile });
    return { signInId, profile };
  },
});

/** A sign-in its owner is changing: signing in to it again, or saving it. */
export const signInFor = internalQuery({
  args: { signInId: v.id("recordingSignIns") },
  handler: async (ctx, args) => {
    const signIn = await ctx.db.get(args.signInId);
    if (!signIn) return null;
    const { userId } = await requireMember(ctx, signIn.organizationId);
    if (signIn.createdBy !== userId) {
      return fail("forbidden", `Only the person who saved ${signIn.name} can change it.`);
    }
    return { signIn, userId };
  },
});

export const signInStarted = internalMutation({
  args: { signInId: v.id("recordingSignIns"), sessionId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.signInId, { sessionId: args.sessionId });
  },
});

export const signInSaved = internalMutation({
  args: { signInId: v.id("recordingSignIns") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.signInId, {
      status: "saved",
      sessionId: undefined,
      savedAt: Date.now(),
    });
  },
});

async function askAgent(
  path: string,
  userId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const agentUrl = process.env.AGENT_URL;
  const secret = process.env.MASTRA_JWT_SECRET;
  if (!agentUrl || !secret) return fail("not_set_up", NOT_SET_UP);
  let response: Response;
  try {
    response = await fetch(new URL(path, agentUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await signAgentToken(secret, userId)}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SIGN_IN_TIMEOUT_MS),
    });
  } catch {
    return fail("unreachable", "The agent could not be reached. Try again in a moment.");
  }
  const answer = ((await response.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (!response.ok) {
    return fail(
      "agent",
      typeof answer.error === "string" ? answer.error : "The agent could not open a browser.",
    );
  }
  return answer;
}

/**
 * Opens a browser on a site for someone to sign in to, saving into the team's sign-in.
 * A new sign-in is made when no `signInId` is given; with one, its saved sign-in is done
 * again (after a password change, say). Answers the link they sign in from.
 */
export const startSignIn = action({
  args: {
    organizationId: v.string(),
    name: v.optional(v.string()),
    url: v.optional(v.string()),
    signInId: v.optional(v.id("recordingSignIns")),
    /** A team account everyone on the team may record with. Left out: theirs alone. */
    shared: v.optional(v.boolean()),
  },
  returns: v.object({ signInId: v.id("recordingSignIns"), liveViewUrl: v.string() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ signInId: Id<"recordingSignIns">; liveViewUrl: string }> => {
    let signInId = args.signInId;
    let profile: string;
    let url: string;
    if (signInId) {
      const found = await ctx.runQuery(internal.pageRecordings.signInFor, { signInId });
      if (!found || found.signIn.organizationId !== args.organizationId) {
        return fail("not_found", "That saved sign-in is gone.");
      }
      profile = found.signIn.profile;
      url = found.signIn.url;
    } else {
      const made = await ctx.runMutation(internal.pageRecordings.addSignIn, {
        organizationId: args.organizationId,
        name: args.name ?? "",
        url: args.url ?? "",
        shared: args.shared,
      });
      signInId = made.signInId;
      profile = made.profile;
      url = cleanPageUrl(args.url ?? "")!;
    }
    const found = await ctx.runQuery(internal.pageRecordings.signInFor, { signInId });
    let opened: { sessionId: string; liveViewUrl: string };
    try {
      const answer = await askAgent("/ncat/sign-in/start", found!.userId, {
        organizationId: args.organizationId,
        profile,
        url,
      });
      if (typeof answer.sessionId !== "string" || typeof answer.liveViewUrl !== "string") {
        return fail("agent", "The agent could not open a browser to sign in with.");
      }
      opened = { sessionId: answer.sessionId, liveViewUrl: answer.liveViewUrl };
    } catch (caught) {
      // A new sign-in that never opened is not kept, so the same name can be tried again.
      if (!args.signInId) await ctx.runMutation(internal.pageRecordings.dropSignIn, { signInId });
      throw caught;
    }
    await ctx.runMutation(internal.pageRecordings.signInStarted, {
      signInId,
      sessionId: opened.sessionId,
    });
    return { signInId, liveViewUrl: opened.liveViewUrl };
  },
});

/** A new sign-in whose browser never opened. */
export const dropSignIn = internalMutation({
  args: { signInId: v.id("recordingSignIns") },
  handler: async (ctx, args) => {
    const signIn = await ctx.db.get(args.signInId);
    if (signIn?.status === "signing_in") await ctx.db.delete(signIn._id);
  },
});

/** Someone says they are signed in: the browser is closed, which is when it is saved. */
export const finishSignIn = action({
  args: { signInId: v.id("recordingSignIns") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const found = await ctx.runQuery(internal.pageRecordings.signInFor, args);
    if (!found) return fail("not_found", "That saved sign-in is gone.");
    if (!found.signIn.sessionId) {
      return fail("invalid_input", "Open the sign-in browser first.");
    }
    await askAgent("/ncat/sign-in/finish", found.userId, { sessionId: found.signIn.sessionId });
    await ctx.runMutation(internal.pageRecordings.signInSaved, args);
    return null;
  },
});

/** Its owner shares a sign-in with the team, as a team account, or stops sharing it. */
export const shareSignIn = mutation({
  args: { signInId: v.id("recordingSignIns"), shared: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const signIn = await ctx.db.get(args.signInId);
    if (!signIn) return fail("not_found", "That saved sign-in is gone.");
    const { userId } = await requireMember(ctx, signIn.organizationId);
    if (signIn.createdBy !== userId) {
      return fail("forbidden", `Only the person who saved ${signIn.name} can share it.`);
    }
    await ctx.db.patch(signIn._id, { shared: args.shared });
    return null;
  },
});

/** Its owner forgets a saved sign-in. Recordings that used it record without signing in. */
export const removeSignIn = mutation({
  args: { signInId: v.id("recordingSignIns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const signIn = await ctx.db.get(args.signInId);
    if (!signIn) return null;
    const { userId } = await requireMember(ctx, signIn.organizationId);
    if (signIn.createdBy !== userId) {
      return fail("forbidden", `Only the person who saved ${signIn.name} can remove it.`);
    }
    const using = await ctx.db
      .query("takeRecordings")
      .withIndex("by_organization", (q) => q.eq("organizationId", signIn.organizationId))
      .take(500);
    for (const row of using) {
      if (row.signInId === signIn._id) await ctx.db.patch(row._id, { signInId: undefined });
    }
    await ctx.db.delete(signIn._id);
    return null;
  },
});

// Kept for the details read after a recording is saved (storage.readDetails reads them).
