import { readClipRef, readUploadRef, timeRangeOf } from "@takewon/automation-core";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fileKindOf } from "./packages";
import { enqueueJob } from "./queue";
import { type Part, type Scene, secondsFor, type TakeFiles } from "./storyboard";
import { type Segment, SHOWN_WITH_YOU, type Source } from "./storyboardRender";

/**
 * A take's file as something to make a video from, or null when it cannot be used: a
 * pointer to one of the team's uploads (all of it, or a stretch), or a link.
 */
export async function sourceOf(
  ctx: QueryCtx,
  organizationId: string,
  file: string | undefined,
): Promise<Source | null> {
  if (!file) return null;
  const clip = readClipRef(file);
  const uploadId = clip?.uploadId ?? readUploadRef(file);
  if (uploadId) {
    const id = ctx.db.normalizeId("uploads", uploadId);
    const upload = id ? await ctx.db.get(id) : null;
    if (!upload || upload.organizationId !== organizationId || upload.status !== "ready") {
      return null;
    }
    const kind = upload.contentType.startsWith("image/") ? "image" : "video";
    const details = upload.details;
    const range = clip ?? (details?.duration ? { start: 0, end: details.duration } : null);
    return {
      url: `upload:${uploadId}`,
      kind,
      ...(range && kind === "video" ? { start: range.start, end: range.end } : {}),
      ...(details?.hasAudio === false ? { audio: false } : {}),
    };
  }
  if (!/^https?:\/\/\S+$/.test(file)) return null;
  const range = timeRangeOf(file);
  const url = range ? file.replace(/#t=[^#]*$/, "") : file;
  const kind = fileKindOf(url) === "image" ? "image" : "video";
  return {
    url,
    kind,
    ...(range && kind === "video" ? { start: range.start, end: range.end } : {}),
  };
}

export type PlannedTake =
  { number: number; segment: Segment; plain: boolean } | { number: number; skipped: true };

/**
 * What a take is made from: you saying the line, and what is shown with you in its scene.
 * A take that needs you is left out until your take is in; one shown with a graphic that is
 * not in yet is made Full Screen, so the video can be watched before every graphic is done.
 */
export async function planTake(
  ctx: QueryCtx,
  organizationId: string,
  take: { line: string; scene: Scene; parts: Part[]; files: TakeFiles },
  number: number,
  accent: string | undefined,
): Promise<PlannedTake> {
  let you = await sourceOf(ctx, organizationId, take.files.you);
  let shown: Source | null = null;
  for (const part of SHOWN_WITH_YOU) {
    if (!take.parts.includes(part)) continue;
    shown = await sourceOf(ctx, organizationId, take.files[part]);
    if (shown) break;
  }
  // A picture given as your take is shown, not spoken over.
  if (you?.kind === "image") {
    shown = shown ?? you;
    you = null;
  }
  if (take.parts.includes("you") && !you) return { number, skipped: true };
  if (!you && !shown) return { number, skipped: true };
  const hold = Math.max(2, secondsFor([take.line]));
  const plain = take.scene !== "full" && !!you && !shown;
  return {
    number,
    plain,
    segment: {
      scene: take.scene,
      ...(you ? { you } : {}),
      ...(shown ? { shown } : {}),
      hold,
      ...(accent ? { accent } : {}),
    },
  };
}

/** The video a job made: the first .mp4 it gave back, else its first file. */
const outputOf = (job: Doc<"jobs"> | null) =>
  job?.outputs.find((url) => /\.mp4(\?|$)/i.test(url)) ?? job?.outputs[0];

/**
 * Moves a storyboard's video on when one of its jobs finishes: once every take is made they
 * are joined, and once they are joined the video is kept in Files. A take that could not be
 * made stops the video, naming the take.
 */
export async function onStoryboardVideoJob(ctx: MutationCtx, job: Doc<"jobs">): Promise<void> {
  if (!job.storyboardVideoId) return;
  const video = await ctx.db.get(job.storyboardVideoId);
  if (!video || video.status !== "working") return;

  if (video.joinJobId === job._id) {
    const url = job.status === "done" ? outputOf(job) : undefined;
    if (!url) {
      await ctx.db.patch(video._id, {
        status: "failed",
        error: `The takes could not be joined. ${job.error ?? ""}`.trim(),
        finishedAt: Date.now(),
      });
      return;
    }
    await ctx.db.patch(video._id, { url });
    await ctx.scheduler.runAfter(0, internal.storyboardVideos.keep, { videoId: video._id });
    return;
  }

  const entry = video.takes.find((take) => take.jobId === job._id);
  if (!entry) return;
  if (job.status === "failed") {
    await ctx.db.patch(video._id, {
      status: "failed",
      error: /matches no streams/i.test(job.error ?? "")
        ? `Take ${entry.number} could not be made: its file has no sound. Use a recording with sound in it.`
        : `Take ${entry.number} could not be made. ${job.error ?? ""}`.trim(),
      finishedAt: Date.now(),
    });
    return;
  }
  const jobs = await Promise.all(video.takes.map((take) => ctx.db.get(take.jobId)));
  if (jobs.some((one) => one?.status !== "done")) return;
  const urls = jobs.map(outputOf);
  if (urls.some((url) => !url)) {
    await ctx.db.patch(video._id, {
      status: "failed",
      error: "A take was made but its file did not come back. Make the video again.",
      finishedAt: Date.now(),
    });
    return;
  }
  if (urls.length === 1) {
    await ctx.db.patch(video._id, { url: urls[0]! });
    await ctx.scheduler.runAfter(0, internal.storyboardVideos.keep, { videoId: video._id });
    return;
  }
  // Every take is made the same way, so they are joined end to end as they are.
  const queued = await enqueueJob(ctx, {
    organizationId: video.organizationId,
    stepId: "video-concatenate",
    input: { video_urls: urls.map((url) => ({ video_url: url! })) },
    createdBy: video.startedBy,
  });
  if (!queued.ok) {
    await ctx.db.patch(video._id, {
      status: "failed",
      error: queued.message,
      finishedAt: Date.now(),
    });
    return;
  }
  await ctx.db.patch(queued.jobId, { storyboardVideoId: video._id });
  await ctx.db.patch(video._id, { joinJobId: queued.jobId });
}

/** Deletes the videos made from a storyboard. Their files stay in Files. */
export async function deleteBoardVideos(ctx: MutationCtx, storyboardId: Id<"storyboards">) {
  const videos = await ctx.db
    .query("storyboardVideos")
    .withIndex("by_storyboard", (q) => q.eq("storyboardId", storyboardId))
    .collect();
  for (const video of videos) await ctx.db.delete(video._id);
}
