import { TITLE_LIMIT } from "@ncat-dash/review-core";
import { ConvexError } from "convex/values";
import { components } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { notify } from "./alerts";
import { slotProblem } from "./packages";
import { CLIP_LIMIT, VERSION_LIMIT } from "./reviews";
import { toSlack } from "./slackPosts";

/** The project's review room, opened the first time a slot gets a version. */
async function roomFor(ctx: MutationCtx, project: Doc<"projects">): Promise<Doc<"reviews">> {
  const existing = project.reviewId ? await ctx.db.get(project.reviewId) : null;
  if (existing) return existing;
  const reviewId = await ctx.db.insert("reviews", {
    organizationId: project.organizationId,
    title: project.name.slice(0, TITLE_LIMIT),
    status: "open",
    createdBy: null,
  });
  await ctx.db.patch(project._id, { reviewId });
  await toSlack(ctx, project.organizationId, { kind: "review_opened", reviewId });
  return (await ctx.db.get(reviewId))!;
}

/**
 * Puts a file in a slot as its next version. The slot moves to In review, the file goes to
 * the project's review room as a new version of the slot's clip (a new clip the first
 * time), a decided room opens again for the new round, and the team hears about it.
 */
export async function putInSlot(
  ctx: MutationCtx,
  deliverable: Doc<"deliverables">,
  url: string,
  by: { userId: string | null; name: string },
): Promise<void> {
  if (!/^https?:\/\//i.test(url)) {
    throw new ConvexError({ code: "invalid_input", message: "That is not a file address." });
  }
  const problem = slotProblem(deliverable.kind, url);
  if (problem) throw new ConvexError({ code: "invalid_input", message: problem });
  if (deliverable.versions.length >= VERSION_LIMIT) {
    throw new ConvexError({ code: "limit", message: "This slot has too many versions." });
  }
  const project = await ctx.db.get(deliverable.projectId);
  if (!project) throw new ConvexError({ code: "not_found", message: "That project is gone." });

  const now = Date.now();
  const version = { url, addedBy: by.userId, addedAt: now };
  const room = await roomFor(ctx, project);
  let clipId = deliverable.clipId;
  const clip = clipId ? await ctx.db.get(clipId) : null;
  if (clip && clip.reviewId === room._id) {
    await ctx.db.patch(clip._id, { versions: [...clip.versions, version].slice(-VERSION_LIMIT) });
  } else {
    const clips = await ctx.db
      .query("reviewClips")
      .withIndex("by_review", (q) => q.eq("reviewId", room._id))
      .take(CLIP_LIMIT);
    if (clips.length >= CLIP_LIMIT) {
      throw new ConvexError({
        code: "limit",
        message: "This project's review room is full. Approve or delete some clips first.",
      });
    }
    // The room's clip starts with every version the slot already had, so nothing is lost.
    clipId = await ctx.db.insert("reviewClips", {
      reviewId: room._id,
      organizationId: project.organizationId,
      title: deliverable.label.slice(0, TITLE_LIMIT),
      versions: [...deliverable.versions, version].slice(-VERSION_LIMIT),
    });
  }
  if (room.status !== "open") {
    await ctx.db.patch(room._id, {
      status: "open",
      decidedBy: undefined,
      decidedAt: undefined,
      clientVerdict: undefined,
    });
  }
  await ctx.db.patch(deliverable._id, {
    versions: [...deliverable.versions, version],
    status: "review",
    clipId,
    updatedAt: now,
  });
  await ctx.db.patch(project._id, { updatedAt: now });

  const count = deliverable.versions.length + 1;
  await notify(ctx, {
    organizationId: project.organizationId,
    kind: "ready_for_review",
    // Everyone but the person who added it.
    ...(by.userId ? { recipients: await othersOn(ctx, project.organizationId, by.userId) } : {}),
    automationName: project.name,
    stepName: deliverable.label,
    message: `Version ${count}, added by ${by.name}`,
    retries: 0,
    reviewId: room._id,
    clipId,
    from: by.name,
  });
}

async function othersOn(ctx: MutationCtx, organizationId: string, userId: string) {
  const people = await ctx.runQuery(components.betterAuth.members.people, { organizationId });
  return people.map((person) => person.id).filter((id) => id !== userId);
}

/**
 * A new version added to a project's clip in the review room itself goes into its slot
 * too, so the slot and the room always show the same versions.
 */
export async function mirrorClipVersion(
  ctx: MutationCtx,
  clipId: Id<"reviewClips">,
  version: { url: string; addedBy: string | null; addedAt: number },
): Promise<void> {
  const deliverable = await ctx.db
    .query("deliverables")
    .withIndex("by_clip", (q) => q.eq("clipId", clipId))
    .first();
  if (!deliverable) return;
  await ctx.db.patch(deliverable._id, {
    versions: [...deliverable.versions, version],
    status: "review",
    updatedAt: version.addedAt,
  });
}

/**
 * Deciding a project's review room moves its slots that were in review: approving makes
 * them Approved, asking for changes puts them back In progress.
 */
export async function decideProjectSlots(
  ctx: MutationCtx,
  reviewId: Id<"reviews">,
  approved: boolean,
): Promise<void> {
  const project = await ctx.db
    .query("projects")
    .withIndex("by_review", (q) => q.eq("reviewId", reviewId))
    .first();
  if (!project) return;
  const slots = await ctx.db
    .query("deliverables")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .take(200);
  const now = Date.now();
  for (const slot of slots) {
    if (slot.status !== "review") continue;
    await ctx.db.patch(slot._id, { status: approved ? "approved" : "in_progress", updatedAt: now });
  }
}

/** A deleted review room lets go of its project, which opens a new one next time. */
export async function forgetProjectRoom(ctx: MutationCtx, reviewId: Id<"reviews">) {
  const project = await ctx.db
    .query("projects")
    .withIndex("by_review", (q) => q.eq("reviewId", reviewId))
    .first();
  if (!project) return;
  await ctx.db.patch(project._id, { reviewId: undefined });
  const slots = await ctx.db
    .query("deliverables")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .take(200);
  for (const slot of slots) if (slot.clipId) await ctx.db.patch(slot._id, { clipId: undefined });
}
