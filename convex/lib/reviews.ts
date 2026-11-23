import { fileNameOfLink, isMachineName } from "@ncat-dash/automation-core";
import { clipTitleFrom, TITLE_LIMIT } from "@ncat-dash/review-core";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { outputNamesOf } from "./outputs";
import { toReviewChannels } from "./reviewChannels";

/**
 * A clip's title: its readable name when one is known ("Space interviews clip 1"), else
 * its file name said plainly, else "Clip 2" for a file named after a toolkit job id.
 */
export function clipTitle(url: string, at: number, names: Record<string, string> = {}): string {
  // A name a person gave the file reads best as it is ("opening-hello.mp4" is "Opening hello").
  if (!isMachineName(fileNameOfLink(url))) return clipTitleFrom(url);
  const known = names[url]?.trim();
  if (known) return known.replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, TITLE_LIMIT);
  return `Clip ${at + 1}`;
}

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
    /** Readable names for the files, by link. */
    names?: Record<string, string>;
  },
): Promise<Id<"reviews"> | null> {
  const urls = [...new Set(review.urls)].slice(0, CLIP_LIMIT);
  if (urls.length === 0) return null;
  const reviewId = await ctx.db.insert("reviews", {
    organizationId: review.organizationId,
    title: review.title.trim().slice(0, TITLE_LIMIT) || clipTitle(urls[0], 0, review.names),
    status: "open",
    runId: review.runId,
    runStepId: review.runStepId,
    createdBy: review.createdBy,
  });
  const now = Date.now();
  for (const [at, url] of urls.entries()) {
    await ctx.db.insert("reviewClips", {
      reviewId,
      organizationId: review.organizationId,
      title: clipTitle(url, at, review.names),
      versions: [{ url, addedBy: review.createdBy, addedAt: now }],
    });
  }
  await toReviewChannels(ctx, review.organizationId, { kind: "review_opened", reviewId });
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
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .take(200);
  await openReview(ctx, {
    organizationId: run.organizationId,
    title: reviewTitle(run, step),
    urls: files,
    createdBy: null,
    runId: run._id,
    runStepId: step._id,
    names: outputNamesOf(run, steps),
  });
}

/** A workflow's review is named after the workflow; any other after its automation. */
function reviewTitle(run: Doc<"runs">, step: Doc<"runSteps">): string {
  const node = (run.nodes as { id: string; input?: Record<string, unknown> }[]).find(
    (candidate) => candidate.id === step.nodeId,
  );
  const name = node?.input?.workflowName;
  return typeof name === "string" && name !== "" ? name : run.automationName;
}

/** Marks the room an approval step opened as decided, wherever the decision was made. */
export async function closeReviewForStep(
  ctx: MutationCtx,
  runStepId: Id<"runSteps">,
  approved: boolean,
  /** Null when the step decided by itself because its time ran out. */
  userId: string | null,
): Promise<void> {
  const review = await ctx.db
    .query("reviews")
    .withIndex("by_runStep", (q) => q.eq("runStepId", runStepId))
    .first();
  if (!review || review.status !== "open") return;
  await ctx.db.patch(review._id, {
    status: approved ? "approved" : "rejected",
    decidedBy: userId ?? undefined,
    decidedAt: Date.now(),
  });
}

/** How long a link the team shares by hand works before someone renews it. */
export const SHARE_DAYS = 30;
const SHARE_MS = SHARE_DAYS * 24 * 60 * 60 * 1000;

/** When a share link made or renewed at `from` stops working. */
export function shareExpiryFrom(from: number): number {
  return from + SHARE_MS;
}

/** When a share link stops working, or null for one a client's portal opened. */
export function shareExpiry(share: Doc<"reviewShares">): number | null {
  if (share.portalId !== undefined) return null;
  return share.expiresAt ?? shareExpiryFrom(share._creationTime);
}

/**
 * Why a share link no longer opens its review, or null while it works. A link the team
 * shared by hand ends 30 days after it was made or renewed, and while the review stands
 * approved; reopening the review brings it back. A portal's links follow the portal.
 */
export function shareEnded(
  share: Doc<"reviewShares">,
  review: Doc<"reviews">,
  now: number,
): "expired" | "approved" | null {
  const expiry = shareExpiry(share);
  if (expiry === null) return null;
  if (review.status === "approved") return "approved";
  return now >= expiry ? "expired" : null;
}

/** A review's share link, if it has one switched on. */
export async function shareOf(ctx: QueryCtx | MutationCtx, reviewId: Id<"reviews">) {
  return (await sharesOf(ctx, reviewId)).find((share) => share.portalId === undefined) ?? null;
}

/** Every share link of a review: the team's own and the ones clients' portals opened. */
export async function sharesOf(ctx: QueryCtx | MutationCtx, reviewId: Id<"reviews">) {
  return await ctx.db
    .query("reviewShares")
    .withIndex("by_review", (q) => q.eq("reviewId", reviewId))
    .take(50);
}
