import { teamFolder } from "@takewon/automation-core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, mutation, query } from "./_generated/server";
import { MANAGER_ROLES, requireMember } from "./lib/authz";
import { addUploadToLibrary } from "./lib/library";
import { enqueueJob, pump } from "./lib/queue";
import { beginStudy } from "./looks";

/**
 * # Videos from a pasted link
 *
 * A link to a post on TikTok, Instagram, YouTube, X, Facebook, LinkedIn or most other video
 * sites, or to a plain video file. The toolkit downloads it (yt-dlp) straight into the
 * team's folder, and it becomes an upload like any other: in Uploads, in the library, with
 * its details read and upload automations started. Pasted to copy its look, its look is
 * studied by itself once its size and length are known.
 *
 * Sites that want a sign-in get the team's cookies (Settings → Video Links), added as the
 * job is sent (jobs.ts).
 */

const MOST_URL_CHARACTERS = 2_000;

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

/** The link, tidied, or null when it is not a web address. */
export function readLink(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MOST_URL_CHARACTERS) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The site a link is on, as people say it: "tiktok.com", not "www.tiktok.com". */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^(www|m|mobile)\./, "");
  } catch {
    return "the link";
  }
}

const TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  ogg: "audio/ogg",
  wav: "audio/wav",
};

/** What a downloaded file is, by its ending. */
export function typeOf(name: string): string {
  return TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "video/mp4";
}

/**
 * The words a failed download is shown with. A sign-in wall says where to add cookies; the
 * rest keep the toolkit's own reason, which is already plain (no video, private, removed).
 */
export function failureWords(error: string, hasCookies: boolean): string {
  const said = error.replace(/\s+/g, " ").trim();
  if (/no video or sound/i.test(said)) {
    return "There is no video or sound at this link. It may be a post of photos.";
  }
  if (/too many requests|\b429\b/i.test(said)) {
    return "The site is turning away downloads from your toolkit for now. Try again later, or add your browser's cookies in Settings, Video Links.";
  }
  if (/sign in|log ?in|login|cookies|confirm you.?re not a bot|private|rate.?limit/i.test(said)) {
    return hasCookies
      ? "The site asked for a sign-in, even with your cookies. They may have run out: export them again in Settings, Video Links."
      : "The site asks for a sign-in before it shares this video. Add your browser's cookies in Settings, Video Links, then try again.";
  }
  if (/unsupported url/i.test(said)) {
    return "There is no video at this link the toolkit knows how to download.";
  }
  if (/never reported a result/i.test(said)) return said;
  return `The video could not be downloaded from this link. ${said.slice(0, 240)}`.trim();
}

/** yt-dlp's choice of file: the best MP4 with its sound, so it plays everywhere. */
const BEST_MP4 = "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b";

/**
 * Brings in the video at a link. Any member can; bringing one in to copy its look is for
 * owners and admins, as copying a look from an upload is.
 */
export const bringIn = mutation({
  args: {
    organizationId: v.string(),
    url: v.string(),
    forLook: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Id<"linkImports">> => {
    const { userId } = await requireMember(
      ctx,
      args.organizationId,
      args.forLook ? MANAGER_ROLES : undefined,
    );
    const url = readLink(args.url);
    if (!url) fail("invalid_input", "Paste a link to a video, starting with https://.");
    if (args.forLook) {
      const waiting = await ctx.db
        .query("linkImports")
        .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
        .order("desc")
        .take(20);
      if (waiting.some((one) => one.forLook === "waiting" && one.status !== "failed")) {
        fail("busy", "A video is already on its way in to copy its look. Wait for it first.");
      }
    }

    // The key ends as the downloaded file does; the toolkit says which it was (onLinkJobFinished).
    const key = `uploads/${crypto.randomUUID()}/video.mp4`;
    const queued = await enqueueJob(ctx, {
      organizationId: args.organizationId,
      stepId: "media-download",
      input: {
        media_url: url,
        cloud_upload: true,
        // The toolkit names files by their key in the bucket: the team's own folder.
        filename: `${teamFolder(args.organizationId)}${key}`,
        format: { quality: BEST_MP4 },
      },
      createdBy: userId,
    });
    if (!queued.ok) {
      fail(
        queued.code,
        queued.code === "no_toolkit"
          ? "Connect your toolkit first, so there is somewhere for the video to go."
          : queued.message,
      );
    }
    const uploadId = await ctx.db.insert("uploads", {
      organizationId: args.organizationId,
      key,
      fileName: `Video from ${siteOf(url)}`,
      contentType: "video/mp4",
      size: 0,
      status: "uploading",
      createdBy: userId,
      source: "link",
      sourceUrl: url,
    });
    const importId = await ctx.db.insert("linkImports", {
      organizationId: args.organizationId,
      url,
      status: "importing",
      uploadId,
      jobId: queued.jobId,
      ...(args.forLook ? { forLook: "waiting" as const } : {}),
      createdBy: userId,
      at: Date.now(),
    });
    await ctx.db.patch(queued.jobId, { linkImportId: importId });
    await pump(ctx, args.organizationId);
    return importId;
  },
});

/** Links being brought in, or that could not be, newest first. Put-away ones are left out. */
export const recent = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const rows = await ctx.db
      .query("linkImports")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(30);
    return rows
      .filter(
        (row) =>
          !row.dismissed &&
          (row.status !== "done" ||
            row.forLook === "waiting" ||
            (row.forLook === "failed" && !!row.error)),
      )
      .slice(0, 10)
      .map((row) => ({
        _id: row._id,
        url: row.url,
        site: siteOf(row.url),
        status: row.status,
        error: row.error ?? null,
        forLook: row.forLook ?? null,
        uploadId: row.uploadId ?? null,
        at: row.at,
      }));
  },
});

/** Puts away a link that could not be brought in, or stops waiting on one. */
export const dismiss = mutation({
  args: { organizationId: v.string(), importId: v.id("linkImports") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const row = await ctx.db.get(args.importId);
    if (!row || row.organizationId !== args.organizationId) return;
    await ctx.db.patch(row._id, {
      dismissed: true,
      ...(row.forLook === "waiting" ? { forLook: "failed" as const } : {}),
    });
  },
});

/** The key the toolkit put the file under, read from its link: the ending may have changed. */
export function keyFromLink(link: string, folder: string, planned: string): string {
  const folderOf = planned.slice(0, planned.lastIndexOf("/") + 1);
  try {
    const path = decodeURIComponent(new URL(link).pathname);
    const at = path.indexOf(`${folder}${folderOf}`);
    if (at >= 0) return path.slice(at + folder.length);
  } catch {
    // Not a link: the key planned stays.
  }
  return planned;
}

/** The name the video is shown by: its title on the site, with its ending. */
function nameOf(title: unknown, key: string, url: string): string {
  const ending = key.split(".").pop() ?? "mp4";
  const words =
    typeof title === "string" && title.trim()
      ? title
          .replace(/[\\/:*?"<>|#\n\r\t]+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 100)
      : `Video from ${siteOf(url)}`;
  return `${words}.${ending}`;
}

/**
 * The toolkit finished (or gave up on) a link's download. A finished one becomes a ready
 * upload under the name it has on the site: it joins the library, its details are read,
 * and upload automations start. A failed one says why, in words people can act on.
 */
export async function onLinkJobFinished(
  ctx: MutationCtx,
  job: Doc<"jobs">,
  result: unknown,
  error: string | null,
): Promise<void> {
  if (!job.linkImportId) return;
  const found = await ctx.db.get(job.linkImportId);
  if (!found || found.jobId !== job._id) return;
  const upload = found.uploadId ? await ctx.db.get(found.uploadId) : null;
  const media = (result as { media?: Record<string, unknown> } | null)?.media;
  const link = typeof media?.media_url === "string" ? media.media_url : null;
  if (error !== null || !upload || !link) {
    const settings = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", job.organizationId))
      .first();
    await ctx.db.patch(found._id, {
      status: "failed",
      error: failureWords(error ?? "The toolkit gave no file back.", !!settings?.videoCookies),
      ...(found.forLook === "waiting" ? { forLook: "failed" as const } : {}),
    });
    if (upload && upload.status === "uploading") await ctx.db.delete(upload._id);
    return;
  }
  const key = keyFromLink(link, teamFolder(job.organizationId), upload.key);
  const ready = {
    ...upload,
    key,
    fileName: nameOf(media?.title, key, found.url),
    contentType: typeOf(key),
    size: typeof media?.filesize === "number" ? media.filesize : upload.size,
    status: "ready" as const,
  };
  await ctx.db.patch(found._id, { status: "done", error: undefined });
  await ctx.db.patch(upload._id, {
    key: ready.key,
    fileName: ready.fileName,
    contentType: ready.contentType,
    size: ready.size,
    status: "ready",
  });
  await addUploadToLibrary(ctx, ready);
  await ctx.scheduler.runAfter(0, internal.storage.readDetails, { uploadId: upload._id });
}

/**
 * Once a video brought in to copy its look has had its size and length read (storage.ts
 * readDetails), its look is studied, as "Copy its look" would.
 */
export const detailsRead = internalMutation({
  args: { uploadId: v.id("uploads") },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (upload?.status === "ready") await studyIfAsked(ctx, upload);
  },
});

async function studyIfAsked(ctx: MutationCtx, upload: Doc<"uploads">): Promise<void> {
  if (upload.source !== "link") return;
  const found = await ctx.db
    .query("linkImports")
    .withIndex("by_upload", (q) => q.eq("uploadId", upload._id))
    .first();
  if (!found || found.forLook !== "waiting") return;
  try {
    await beginStudy(ctx, upload, found.createdBy);
    await ctx.db.patch(found._id, { forLook: "started" });
  } catch (caught) {
    const said =
      caught instanceof ConvexError && typeof caught.data?.message === "string"
        ? caught.data.message
        : "Its look could not be studied.";
    await ctx.db.patch(found._id, { forLook: "failed", error: said });
  }
}
