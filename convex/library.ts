import {
  cleanTags,
  keyOfUrl,
  librarySearchText,
  readShortId,
  snippetAround,
  titleFromFileName,
  transcriptPieces,
} from "@ncat-dash/automation-core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server";
import { MANAGER_ROLES, requireMember } from "./lib/authz";
import { bucketOf, presign, storageConnection } from "./lib/bucket";
import { finishedFiles } from "./lib/exports";
import {
  addLibraryItem,
  addUploadToLibrary,
  deleteLibraryItem,
  deletePieces,
  kindOfMadeFile,
  librarySettingsOf,
  startingItemOf,
} from "./lib/library";
import { startingFiles } from "./lib/chain";
import { outputNamesOf } from "./lib/outputs";
import { enqueueJob, pump } from "./lib/queue";
import { startRun } from "./lib/runner";

// Links the library plays and shows files from: long enough for a working session.
const PREVIEW_LINK_SECONDS = 6 * 60 * 60;
// The longest a signed link may live, so a queued transcription can still fetch its file.
const READ_LINK_SECONDS = 7 * 24 * 60 * 60;
const MAX_AT_ONCE = 25;
const LIST_LIMIT = 500;
const FILL_UPLOADS = 500;
const FILL_RUNS = 200;
const MOMENTS_PER_FILE = 3;

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

type Summary = {
  _id: Id<"libraryItems">;
  _creationTime: number;
  shortId: string;
  kind: Doc<"libraryItems">["kind"];
  source: Doc<"libraryItems">["source"];
  title: string;
  tags: string[];
  rating: number | null;
  duration: number | null;
  automationName: string | null;
  parent: { _id: Id<"libraryItems">; shortId: string; title: string } | null;
  made: number;
  searchable: "no" | "working" | "ready" | "failed";
};

/** A library file as the page lists it. `byId` resolves its parent without another read. */
function summaryOf(
  item: Doc<"libraryItems">,
  byId: Map<string, Doc<"libraryItems">>,
  made: Map<string, number>,
): Summary {
  const parent = item.parentId ? byId.get(item.parentId) : undefined;
  return {
    _id: item._id,
    _creationTime: item._creationTime,
    shortId: item.shortId,
    kind: item.kind,
    source: item.source,
    title: item.title,
    tags: item.tags,
    rating: item.rating ?? null,
    duration: item.details?.duration ?? null,
    automationName: item.automationName ?? null,
    parent: parent ? { _id: parent._id, shortId: parent.shortId, title: parent.title } : null,
    made: made.get(item._id) ?? 0,
    searchable: item.transcript?.status ?? "no",
  };
}

async function loadItem(ctx: QueryCtx, itemId: Id<"libraryItems">) {
  const item = await ctx.db.get(itemId);
  if (!item) fail("not_found", "That file is no longer in the library.");
  const member = await requireMember(ctx, item.organizationId);
  return { item, ...member };
}

/** Every file in the team's library, newest first, with the team's library settings. */
export const list = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { role } = await requireMember(ctx, args.organizationId);
    const items = await ctx.db
      .query("libraryItems")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(LIST_LIMIT);
    const byId = new Map(items.map((item) => [item._id as string, item]));
    const made = new Map<string, number>();
    for (const item of items) {
      if (item.parentId) made.set(item.parentId, (made.get(item.parentId) ?? 0) + 1);
    }
    // A parent older than the newest LIST_LIMIT files is read on its own.
    for (const item of items) {
      if (item.parentId && !byId.has(item.parentId)) {
        const parent = await ctx.db.get(item.parentId);
        if (parent) byId.set(parent._id, parent);
      }
    }
    const settings = await librarySettingsOf(ctx, args.organizationId);
    return {
      items: items.map((item) => summaryOf(item, byId, made)),
      searchNewFiles: settings.searchNewFiles,
      filled: settings.filledAt !== null,
      canChangeSettings: MANAGER_ROLES.includes(role),
      tags: [...new Set(items.flatMap((item) => item.tags))].sort(),
    };
  },
});

/** One library file: where it came from, what was made from it, and what was said in it. */
export const get = query({
  args: { itemId: v.id("libraryItems") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;
    await requireMember(ctx, item.organizationId);
    const parent = item.parentId ? await ctx.db.get(item.parentId) : null;
    const children = await ctx.db
      .query("libraryItems")
      .withIndex("by_parent", (q) => q.eq("parentId", item._id))
      .take(200);
    const pieces = await ctx.db
      .query("transcriptPieces")
      .withIndex("by_item_and_start", (q) => q.eq("itemId", item._id))
      .take(2000);
    const byId = new Map<string, Doc<"libraryItems">>(parent ? [[parent._id, parent]] : []);
    byId.set(item._id, item);
    return {
      ...summaryOf(item, byId, new Map([[item._id as string, children.length]])),
      details: item.details ?? null,
      runId: item.runId ?? null,
      automationId: item.runId ? ((await ctx.db.get(item.runId))?.automationId ?? null) : null,
      transcriptError:
        item.transcript?.status === "failed" ? (item.transcript.error ?? null) : null,
      children: children
        .sort((a, b) => a._creationTime - b._creationTime)
        .map((child) => summaryOf(child, byId, new Map())),
      pieces: pieces.map((piece) => ({ start: piece.start, end: piece.end, text: piece.text })),
    };
  },
});

/**
 * Searches the team's library: what was said in each file (the moments it was said), and
 * each file's ID, title, tags and automation. A short ID on its own ("C99") finds that file.
 */
export const search = query({
  args: { organizationId: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const text = args.text.trim().slice(0, 200);
    if (!text) return [];

    const found = new Map<
      string,
      { item: Doc<"libraryItems">; moments: { start: number; text: string }[]; order: number }
    >();
    let order = 0;
    const note = (item: Doc<"libraryItems">) => {
      const known = found.get(item._id);
      if (known) return known;
      const entry = { item, moments: [], order: order++ };
      found.set(item._id, entry);
      return entry;
    };

    const shortId = readShortId(text);
    if (shortId) {
      const exact = await ctx.db
        .query("libraryItems")
        .withIndex("by_organization_and_shortId", (q) =>
          q.eq("organizationId", args.organizationId).eq("shortId", shortId),
        )
        .first();
      if (exact) note(exact);
    }

    const spoken = await ctx.db
      .query("transcriptPieces")
      .withSearchIndex("search_speech", (q) =>
        q.search("text", text).eq("organizationId", args.organizationId),
      )
      .take(80);
    for (const piece of spoken) {
      const item = found.get(piece.itemId)?.item ?? (await ctx.db.get(piece.itemId));
      if (!item) continue;
      const entry = note(item);
      if (entry.moments.length < MOMENTS_PER_FILE) {
        entry.moments.push({ start: piece.start, text: snippetAround(piece.text, text) });
      }
    }

    const named = await ctx.db
      .query("libraryItems")
      .withSearchIndex("search_text", (q) =>
        q.search("searchText", text).eq("organizationId", args.organizationId),
      )
      .take(50);
    for (const item of named) note(item);

    const byId = new Map([...found.values()].map(({ item }) => [item._id as string, item]));
    for (const { item } of found.values()) {
      if (item.parentId && !byId.has(item.parentId)) {
        const parent = await ctx.db.get(item.parentId);
        if (parent) byId.set(parent._id, parent);
      }
    }
    return [...found.values()]
      .sort((a, b) => a.order - b.order)
      .map(({ item, moments }) => ({
        ...summaryOf(item, byId, new Map()),
        moments: moments.sort((a, b) => a.start - b.start),
      }));
  },
});

/** The library file with this short ID ("C99"), or null. For people and the agent. */
export const byShortId = query({
  args: { organizationId: v.string(), shortId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const shortId = readShortId(args.shortId);
    if (!shortId) return null;
    const item = await ctx.db
      .query("libraryItems")
      .withIndex("by_organization_and_shortId", (q) =>
        q.eq("organizationId", args.organizationId).eq("shortId", shortId),
      )
      .first();
    return item ? { _id: item._id, shortId: item.shortId, title: item.title } : null;
  },
});

/** Renames a library file. The file in storage keeps its name. */
export const rename = mutation({
  args: { itemId: v.id("libraryItems"), title: v.string() },
  handler: async (ctx, args) => {
    const { item } = await loadItem(ctx, args.itemId);
    const title = args.title.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!title) fail("invalid_input", "Give the file a name.");
    await ctx.db.patch(item._id, {
      title,
      searchText: librarySearchText({ ...item, title }),
    });
  },
});

/** Sets a library file's tags. */
export const setTags = mutation({
  args: { itemId: v.id("libraryItems"), tags: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { item } = await loadItem(ctx, args.itemId);
    const tags = cleanTags(args.tags);
    await ctx.db.patch(item._id, { tags, searchText: librarySearchText({ ...item, tags }) });
  },
});

/** Gives a library file one to five stars, or takes them away with null. */
export const setRating = mutation({
  args: { itemId: v.id("libraryItems"), rating: v.union(v.null(), v.number()) },
  handler: async (ctx, args) => {
    const { item } = await loadItem(ctx, args.itemId);
    if (
      args.rating !== null &&
      (!Number.isInteger(args.rating) || args.rating < 1 || args.rating > 5)
    ) {
      fail("invalid_input", "A rating is one to five stars.");
    }
    await ctx.db.patch(item._id, { rating: args.rating ?? undefined });
  },
});

/** Takes a file out of the library. The file itself stays in storage. */
export const remove = mutation({
  args: { itemId: v.id("libraryItems") },
  handler: async (ctx, args) => {
    const { item } = await loadItem(ctx, args.itemId);
    await deleteLibraryItem(ctx, item._id);
  },
});

/** Whether each new video and sound is transcribed so it can be searched. Owners and admins. */
export const setSearchNewFiles = mutation({
  args: { organizationId: v.string(), on: v.boolean() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const { row } = await librarySettingsOf(ctx, args.organizationId);
    if (row) await ctx.db.patch(row._id, { searchNewFiles: args.on });
    else {
      await ctx.db.insert("librarySettings", {
        organizationId: args.organizationId,
        searchNewFiles: args.on,
      });
    }
  },
});

/**
 * Adds the files a team had before the library existed: its uploads and the finished files
 * of its recent runs, oldest first so the numbers run in order. Done once per team.
 */
export const fill = mutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const settings = await librarySettingsOf(ctx, args.organizationId);
    if (settings.filledAt !== null) return;
    // Marked first, so a second open of the page while this runs adds nothing twice.
    if (settings.row) await ctx.db.patch(settings.row._id, { filledAt: Date.now() });
    else {
      await ctx.db.insert("librarySettings", {
        organizationId: args.organizationId,
        searchNewFiles: false,
        filledAt: Date.now(),
      });
    }

    const uploads = await ctx.db
      .query("uploads")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(FILL_UPLOADS);
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_organization_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "done"),
      )
      .order("desc")
      .take(FILL_RUNS);
    type Entry = { at: number; upload?: Doc<"uploads">; run?: Doc<"runs"> };
    const entries: Entry[] = [
      ...uploads.map((upload) => ({ at: upload._creationTime, upload })),
      ...runs
        .filter((run) => !run.test)
        .map((run) => ({ at: run.finishedAt ?? run._creationTime, run })),
    ].sort((a, b) => a.at - b.at);
    for (const entry of entries) {
      if (entry.upload) await addUploadToLibrary(ctx, entry.upload);
      else if (entry.run) await addRunFiles(ctx, entry.run, new Map());
    }
  },
});

/**
 * Adds a finished run's last files to the library, each made from the file the run
 * started from. `kept` gives the key a file was copied to in the team's folder, by link.
 */
async function addRunFiles(
  ctx: Parameters<typeof addLibraryItem>[0],
  run: Doc<"runs">,
  kept: Map<string, string>,
) {
  if (run.status !== "done" || run.test) return;
  const already = await ctx.db
    .query("libraryItems")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .first();
  if (already) return;
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .take(200);
  const names = outputNamesOf(run, steps);
  const parentId = await startingItemOf(ctx, run);
  const parent = parentId ? await ctx.db.get(parentId) : null;
  // A file the run handed straight back (an approval of the upload) is not a new file.
  const started = new Set(startingFiles(run.trigger));
  for (const link of finishedFiles(run, steps)) {
    if (started.has(link)) continue;
    const key = kept.get(link);
    if (key && (key === parent?.key || (await itemAtKey(ctx, run.organizationId, key)))) continue;
    const name = names[link] ?? fileNameOf(link);
    await addLibraryItem(ctx, {
      organizationId: run.organizationId,
      kind: kindOfMadeFile(name, link),
      source: "automation",
      title: titleFromFileName(name),
      ...(key ? { key } : { url: link }),
      runId: run._id,
      automationName: run.automationName,
      ...(parentId ? { parentId } : {}),
      createdBy: null,
    });
  }
}

async function itemAtKey(ctx: QueryCtx, organizationId: string, key: string) {
  return await ctx.db
    .query("libraryItems")
    .withIndex("by_organization_and_key", (q) =>
      q.eq("organizationId", organizationId).eq("key", key),
    )
    .first();
}

function fileNameOf(link: string): string {
  try {
    return decodeURIComponent(new URL(link).pathname.split("/").pop() ?? "") || "File";
  } catch {
    return "File";
  }
}

/** After a run's finished files are kept in the team's folder: adds them to the library. */
export const addFinished = internalMutation({
  args: {
    runId: v.id("runs"),
    kept: v.array(v.object({ link: v.string(), key: v.string() })),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;
    await addRunFiles(ctx, run, new Map(args.kept.map(({ link, key }) => [link, key])));
  },
});

/** Where the given library files are, for signing links. Members of the team only. */
export const locate = internalQuery({
  args: { organizationId: v.string(), itemIds: v.array(v.id("libraryItems")) },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const found: { itemId: Id<"libraryItems">; key: string | null; url: string | null }[] = [];
    for (const itemId of new Set(args.itemIds)) {
      const item = await ctx.db.get(itemId);
      if (!item || item.organizationId !== args.organizationId) continue;
      found.push({ itemId, key: item.key ?? null, url: item.url ?? null });
    }
    return found;
  },
});

async function linksFor(
  ctx: ActionCtx,
  organizationId: string,
  itemIds: Id<"libraryItems">[],
  seconds: number,
): Promise<{ itemId: Id<"libraryItems">; url: string }[]> {
  const targets: { itemId: Id<"libraryItems">; key: string | null; url: string | null }[] =
    await ctx.runQuery(internal.library.locate, { organizationId, itemIds });
  const needsSigning = targets.some((target) => target.key !== null);
  const connection = needsSigning
    ? await ctx.runQuery(internal.storage.load, { organizationId })
    : null;
  const bucket = connection ? await bucketOf(connection) : null;
  const links = await Promise.all(
    targets.map(async (target) => {
      if (target.key === null)
        return target.url ? { itemId: target.itemId, url: target.url } : null;
      if (!bucket) return null;
      try {
        return { itemId: target.itemId, url: await presign(bucket, "GET", target.key, seconds) };
      } catch {
        return null;
      }
    }),
  );
  return links.filter((link) => link !== null);
}

/** Links to show and play the library files on screen, signed for six hours. */
export const previewLinks = action({
  args: { organizationId: v.string(), itemIds: v.array(v.id("libraryItems")) },
  returns: v.array(v.object({ itemId: v.id("libraryItems"), url: v.string() })),
  handler: async (ctx, args): Promise<{ itemId: Id<"libraryItems">; url: string }[]> => {
    if (args.itemIds.length > MAX_AT_ONCE) {
      fail("too_many", `Ask for up to ${MAX_AT_ONCE} files at a time.`);
    }
    return await linksFor(ctx, args.organizationId, args.itemIds, PREVIEW_LINK_SECONDS);
  },
});

/** The automation and file to start a run with, checked against the caller's team. */
export const runTarget = internalQuery({
  args: { itemId: v.id("libraryItems"), automationId: v.id("automations") },
  handler: async (ctx, args) => {
    const { item } = await loadItem(ctx, args.itemId);
    const automation = await ctx.db.get(args.automationId);
    if (!automation || automation.organizationId !== item.organizationId) {
      fail("not_found", "That automation is not on your team.");
    }
    return { item };
  },
});

export const startRunOn = internalMutation({
  args: {
    itemId: v.id("libraryItems"),
    automationId: v.id("automations"),
    fileUrl: v.string(),
  },
  returns: v.id("runs"),
  handler: async (ctx, args) => {
    const { item, userId } = await loadItem(ctx, args.itemId);
    const automation = await ctx.db.get(args.automationId);
    if (!automation || automation.organizationId !== item.organizationId) {
      fail("not_found", "That automation is not on your team.");
    }
    const started = await startRun(
      ctx,
      automation,
      "manual",
      {
        file_url: args.fileUrl,
        file_name: item.title,
        details: item.details ?? null,
        library_item: item._id,
        ...(item.uploadId ? { upload_id: item.uploadId } : {}),
      },
      userId,
    );
    if (!started.ok) fail("invalid_input", started.message);
    return started.runId;
  },
});

/**
 * Runs one of the team's automations, as it is published, on a library file: old content
 * through a new automation. What it makes joins the library as made from this file.
 */
export const runAutomation = action({
  args: { itemId: v.id("libraryItems"), automationId: v.id("automations") },
  returns: v.id("runs"),
  handler: async (ctx, args): Promise<Id<"runs">> => {
    const { item } = await ctx.runQuery(internal.library.runTarget, args);
    const [link] = await linksFor(ctx, item.organizationId, [item._id], READ_LINK_SECONDS);
    if (!link) fail("no_storage", "This file cannot be reached. Check your toolkit connection.");
    return await ctx.runMutation(internal.library.startRunOn, { ...args, fileUrl: link.url });
  },
});

// Making files searchable: each is transcribed on the team's own toolkit (Whisper, no AI
// tokens), and the timed words are kept in pieces.

/** Sends library files to be transcribed. Videos and sounds only; others are skipped. */
export const makeSearchable = action({
  args: { organizationId: v.string(), itemIds: v.array(v.id("libraryItems")) },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    if (args.itemIds.length > MAX_AT_ONCE) {
      fail("too_many", `Send up to ${MAX_AT_ONCE} files at a time.`);
    }
    const links = await linksFor(ctx, args.organizationId, args.itemIds, READ_LINK_SECONDS);
    let sent = 0;
    for (const link of links) {
      const started = await ctx.runMutation(internal.library.startTranscript, {
        itemId: link.itemId,
        mediaUrl: link.url,
        asMember: true,
      });
      if (started) sent++;
    }
    return sent;
  },
});

/** Transcribes a new library file, when the team has asked for every new file to be. */
export const transcribe = internalAction({
  args: { itemId: v.id("libraryItems") },
  handler: async (ctx, args) => {
    const item = await ctx.runQuery(internal.library.loadInternal, args);
    if (!item) return;
    const connection = await ctx.runQuery(internal.storage.load, {
      organizationId: item.organizationId,
    });
    let url = item.url ?? null;
    if (item.key && connection) {
      try {
        url = await presign(await bucketOf(connection), "GET", item.key, READ_LINK_SECONDS);
      } catch {
        url = null;
      }
    }
    if (!url) return;
    await ctx.runMutation(internal.library.startTranscript, {
      itemId: item._id,
      mediaUrl: url,
      asMember: false,
    });
  },
});

export const loadInternal = internalQuery({
  args: { itemId: v.id("libraryItems") },
  handler: async (ctx, args) => await ctx.db.get(args.itemId),
});

/** Queues the transcription of one file. False when there is nothing to do. */
export const startTranscript = internalMutation({
  args: { itemId: v.id("libraryItems"), mediaUrl: v.string(), asMember: v.boolean() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return false;
    const createdBy = args.asMember
      ? (await requireMember(ctx, item.organizationId)).userId
      : (item.createdBy ?? "library");
    if (item.kind !== "video" && item.kind !== "audio") return false;
    if (item.transcript?.status === "working") return false;
    const queued = await enqueueJob(ctx, {
      organizationId: item.organizationId,
      stepId: "media-transcribe",
      input: {
        media_url: args.mediaUrl,
        include_text: false,
        include_segments: true,
        // Kept as a file at the toolkit: a long video's segments would not fit in a result.
        response_type: "cloud",
      },
      createdBy,
    });
    if (!queued.ok) {
      await ctx.db.patch(item._id, {
        transcript: { status: "failed", error: queued.message, at: Date.now() },
      });
      return false;
    }
    await ctx.db.patch(queued.jobId, { libraryItemId: item._id });
    await ctx.db.patch(item._id, {
      transcript: { status: "working", jobId: queued.jobId, at: Date.now() },
    });
    await pump(ctx, item.organizationId);
    return true;
  },
});

/** A finished transcription job and where to read its segments. */
export const transcriptJob = internalQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job?.libraryItemId) return null;
    const connection = await storageConnection(ctx, job.organizationId);
    return { job, connection };
  },
});

/**
 * Reads what a transcription job found and keeps it with the file, in pieces. Called when
 * the job finishes, whichever way.
 */
export const readTranscript = internalAction({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const found = await ctx.runQuery(internal.library.transcriptJob, args);
    if (!found) return;
    const { job, connection } = found;
    const itemId = job.libraryItemId!;
    if (job.status !== "done") {
      await ctx.runMutation(internal.library.saveTranscript, {
        itemId,
        jobId: job._id,
        ok: false,
        error: job.error ?? "The toolkit could not transcribe this file.",
      });
      return;
    }
    const result = (job.result ?? {}) as Record<string, unknown>;
    let segments: unknown = result.segments;
    try {
      if (!Array.isArray(segments) && typeof result.segments_url === "string") {
        segments = await fetchJson(result.segments_url, connection);
      }
    } catch {
      segments = null;
    }
    if (!Array.isArray(segments)) {
      await ctx.runMutation(internal.library.saveTranscript, {
        itemId,
        jobId: job._id,
        ok: false,
        error: "The toolkit's transcript could not be read.",
      });
      return;
    }
    await ctx.runMutation(internal.library.saveTranscript, {
      itemId,
      jobId: job._id,
      ok: true,
      pieces: transcriptPieces(segments),
    });
  },
});

/**
 * Fetches a JSON file the toolkit wrote. A file in a private bucket is fetched through a
 * link the toolkit signs.
 */
async function fetchJson(url: string, connection: Doc<"toolkitConnections"> | null) {
  const plain = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (plain.ok) return await plain.json();
  if (!connection?.storage?.endpoint) throw new Error(`HTTP ${plain.status}`);
  const key = keyOfUrl(
    {
      endpoint: connection.storage.endpoint,
      bucket: connection.storage.bucket,
      ...(connection.storage.publicUrl ? { publicUrl: connection.storage.publicUrl } : {}),
    },
    url,
  );
  if (key === null) throw new Error(`HTTP ${plain.status}`);
  const whole = { ...(await bucketOf(connection)), root: "" };
  const signed = await fetch(await presign(whole, "GET", key, 600), {
    signal: AbortSignal.timeout(60_000),
  });
  if (!signed.ok) throw new Error(`HTTP ${signed.status}`);
  return await signed.json();
}

export const saveTranscript = internalMutation({
  args: {
    itemId: v.id("libraryItems"),
    jobId: v.id("jobs"),
    ok: v.boolean(),
    error: v.optional(v.string()),
    pieces: v.optional(v.array(v.object({ start: v.number(), end: v.number(), text: v.string() }))),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    // A newer try has started since; its answer is the one that counts.
    if (!item || item.transcript?.jobId !== args.jobId) return;
    if (!args.ok) {
      await ctx.db.patch(item._id, {
        transcript: { status: "failed", jobId: args.jobId, error: args.error, at: Date.now() },
      });
      return;
    }
    await deletePieces(ctx, item._id);
    for (const piece of args.pieces ?? []) {
      await ctx.db.insert("transcriptPieces", {
        organizationId: item.organizationId,
        itemId: item._id,
        ...piece,
      });
    }
    await ctx.db.patch(item._id, {
      transcript: { status: "ready", jobId: args.jobId, at: Date.now() },
    });
  },
});
