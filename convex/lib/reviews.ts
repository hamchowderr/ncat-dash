import { clipTitleFrom, TITLE_LIMIT } from "@ncat-dash/review-core";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** The most clips one review holds, and the most versions one clip keeps. */
export const CLIP_LIMIT = 50;
export const VERSION_LIMIT = 20;

/** Opens a review with one clip per file. Returns nothing when there are no files. */
export async function openReview(
  ctx: MutationCtx,
  review: {
    organizationId: string;
    title: string;
    urls: string[];
    createdBy: string | null;
    runId?: Id<"runs">;
    runStepId?: Id<"runSteps">;
  },
): Promise<Id<"reviews"> | null> {
  const urls = [...new Set(review.urls)].slice(0, CLIP_LIMIT);
  if (urls.length === 0) return null;
  const reviewId = await ctx.db.insert("reviews", {
    organizationId: review.organizationId,
    title: review.title.trim().slice(0, TITLE_LIMIT) || clipTitleFrom(urls[0]),
    status: "open",
    runId: review.runId,
    runStepId: review.runStepId,
    createdBy: review.createdBy,
  });
  const now = Date.now();
  for (const url of urls) {
    await ctx.db.insert("reviewClips", {
      reviewId,
      organizationId: review.organizationId,
      title: clipTitleFrom(url),
      versions: [{ url, addedBy: review.createdBy, addedAt: now }],
    });
  }
  return reviewId;
}

/**
 * Opens the room for an approval step that has just started waiting, so the team has
 * somewhere to look at the files and talk before deciding.
 */
export async function openReviewForApproval(
  ctx: MutationCtx,
  run: Doc<"runs">,
  step: Doc<"runSteps">,
  files: string[],
): Promise<void> {
  await openReview(ctx, {
    organizationId: run.organizationId,
    title: run.automationName,
    urls: files,
    createdBy: null,
    runId: run._id,
    runStepId: step._id,
  });
}

/** Marks the room an approval step opened as decided, wherever the decision was made. */
export async function closeReviewForStep(
  ctx: MutationCtx,
  runStepId: Id<"runSteps">,
  approved: boolean,
  userId: string,
): Promise<void> {
  const review = await ctx.db
    .query("reviews")
    .withIndex("by_runStep", (q) => q.eq("runStepId", runStepId))
    .first();
  if (!review || review.status !== "open") return;
  await ctx.db.patch(review._id, {
    status: approved ? "approved" : "rejected",
    decidedBy: userId,
    decidedAt: Date.now(),
  });
}
