import { cleanDrawing, COMMENT_LIMIT } from "@ncat-dash/review-core";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { notify } from "./lib/alerts";
import { drawingValidator } from "./lib/drawing";
import { CLIP_LIMIT } from "./lib/reviews";
import { toSlack } from "./lib/slackPosts";

// The client's side of a review's share link (/share/<token>). Nobody here is signed in:
// the secret in the link is the only key, and every function checks it first. A client
// can watch the clips, comment, reply, delete what they wrote, and, when the team allows
// it, say whether they approve. They cannot resolve threads, tag anyone or ask the agent,
// and their verdict tells the team rather than deciding the review.

const COMMENTS_SHOWN = 500;
export const GUEST_NAME_LIMIT = 60;

const closed = () =>
  new ConvexError({ code: "not_found", message: "This review is no longer shared." });

async function shareFor(ctx: QueryCtx | MutationCtx, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const share = await ctx.db
    .query("reviewShares")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
  if (!share) return null;
  const review = await ctx.db.get(share.reviewId);
  return review ? { share, review } : null;
}

export async function requireShare(ctx: QueryCtx | MutationCtx, token: string) {
  const found = await shareFor(ctx, token);
  if (!found) throw closed();
  return found;
}

/** The id a client's browser keeps for them, so they can delete what they wrote. */
export function guestAuthor(guestId: string): string {
  if (!/^[A-Za-z0-9-]{16,64}$/.test(guestId)) {
    throw new ConvexError({ code: "invalid", message: "Open the link again to comment." });
  }
  return `guest:${guestId}`;
}

export function guestName(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean === "") throw new ConvexError({ code: "invalid", message: "Say who you are first." });
  return clean.slice(0, GUEST_NAME_LIMIT);
}

/** Whether a client may see this comment: their own threads, or every thread if allowed. */
function visible(
  comment: Doc<"reviewComments">,
  roots: Map<string, Doc<"reviewComments">>,
  share: Doc<"reviewShares">,
): boolean {
  if (share.showTeamComments) return true;
  const root = comment.parentId ? roots.get(comment.parentId) : comment;
  return root?.client === true;
}

/** The shared review: its title, clips and what the client may do. Null when not shared. */
export const room = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const found = await shareFor(ctx, args.token);
    if (!found) return null;
    const { share, review } = found;
    const clips = await ctx.db
      .query("reviewClips")
      .withIndex("by_review", (q) => q.eq("reviewId", review._id))
      .take(CLIP_LIMIT);
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: review.organizationId,
    });
    return {
      title: review.title,
      teamName: team.teamName,
      status: review.status,
      allowVerdict: share.allowVerdict,
      verdict: review.clientVerdict ?? null,
      clips: clips.map((clip) => ({
        _id: clip._id,
        title: clip.title,
        versions: clip.versions.map((version) => ({
          url: version.url,
          addedAt: version.addedAt,
        })),
      })),
    };
  },
});

/** The comments on one clip that the client may see, oldest first. */
export const comments = query({
  args: { token: v.string(), clipId: v.id("reviewClips"), guestId: v.string() },
  handler: async (ctx, args) => {
    const found = await shareFor(ctx, args.token);
    if (!found) return [];
    const clip = await ctx.db.get(args.clipId);
    if (!clip || clip.reviewId !== found.review._id) return [];
    const rows = await ctx.db
      .query("reviewComments")
      .withIndex("by_clip", (q) => q.eq("clipId", clip._id))
      .take(COMMENTS_SHOWN);
    const roots = new Map(rows.map((row) => [row._id as string, row]));
    const me = `guest:${args.guestId}`;
    return rows
      .filter((row) => visible(row, roots, found.share))
      .filter((row) => !(row.agent && row.agent.state !== "answered"))
      .map((row) => ({
        id: row._id,
        parentId: row.parentId ?? null,
        version: row.version,
        time: row.time,
        body: row.body,
        authorId: row.authorId,
        authorName: row.authorName,
        createdAt: row._creationTime,
        resolved: row.resolved,
        client: row.client === true,
        drawing: row.drawing ?? null,
        mine: row.authorId === me,
        agent: row.agent ?? null,
      }));
  },
});

async function tellTeam(
  ctx: MutationCtx,
  review: Doc<"reviews">,
  from: string,
  message: string,
  at: { clipId?: Id<"reviewClips">; commentId?: Id<"reviewComments"> },
) {
  await notify(ctx, {
    organizationId: review.organizationId,
    kind: "client_feedback",
    automationName: review.title,
    message,
    retries: 0,
    reviewId: review._id,
    clipId: at.clipId,
    commentId: at.commentId,
    from,
  });
  await toSlack(ctx, review.organizationId, {
    kind: "client_feedback",
    reviewId: review._id,
    commentId: at.commentId,
    from,
    body: message,
  });
}

/** Writes a client's comment at a moment in a clip, or their reply to a thread they see. */
export const comment = mutation({
  args: {
    token: v.string(),
    guestId: v.string(),
    name: v.string(),
    clipId: v.id("reviewClips"),
    body: v.string(),
    time: v.number(),
    version: v.number(),
    parentId: v.optional(v.id("reviewComments")),
    drawing: v.optional(drawingValidator),
  },
  handler: async (ctx, args) => {
    const { share, review } = await requireShare(ctx, args.token);
    const authorId = guestAuthor(args.guestId);
    const authorName = guestName(args.name);
    const clip = await ctx.db.get(args.clipId);
    if (!clip || clip.reviewId !== review._id) {
      throw new ConvexError({ code: "not_found", message: "That clip is gone." });
    }
    const body = args.body.trim();
    if (body === "") throw new ConvexError({ code: "invalid", message: "Write something first." });
    if (body.length > COMMENT_LIMIT) {
      throw new ConvexError({ code: "invalid", message: "That comment is too long." });
    }
    const existing = await ctx.db
      .query("reviewComments")
      .withIndex("by_review", (q) => q.eq("reviewId", review._id))
      .take(COMMENTS_SHOWN);
    if (existing.length >= COMMENTS_SHOWN) {
      throw new ConvexError({ code: "limit", message: "This review has too many comments." });
    }

    let time = Math.max(0, Number.isFinite(args.time) ? args.time : 0);
    let version = Math.min(clip.versions.length, Math.max(1, Math.round(args.version)));
    let parentId: Id<"reviewComments"> | undefined;
    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      const root = parent?.parentId ? await ctx.db.get(parent.parentId) : parent;
      if (!parent || !root || parent.clipId !== clip._id || !visible(root, new Map(), share)) {
        throw new ConvexError({ code: "not_found", message: "That comment is gone." });
      }
      parentId = root._id;
      time = root.time;
      version = root.version;
      if (root.resolved) await ctx.db.patch(root._id, { resolved: false });
    }

    const id = await ctx.db.insert("reviewComments", {
      reviewId: review._id,
      clipId: clip._id,
      organizationId: review.organizationId,
      version,
      time,
      body,
      authorId,
      authorName,
      parentId,
      resolved: false,
      client: true,
      drawing: parentId ? undefined : (cleanDrawing(args.drawing) ?? undefined),
    });
    await tellTeam(ctx, review, authorName, body, { clipId: clip._id, commentId: parentId ?? id });
    return id;
  },
});

/** Deletes a comment the client wrote. Deleting the first of a thread deletes its replies. */
export const removeComment = mutation({
  args: { token: v.string(), guestId: v.string(), commentId: v.id("reviewComments") },
  handler: async (ctx, args) => {
    const { review } = await requireShare(ctx, args.token);
    const found = await ctx.db.get(args.commentId);
    if (!found || found.reviewId !== review._id) return;
    if (found.authorId !== guestAuthor(args.guestId)) {
      throw new ConvexError({ code: "forbidden", message: "You can only delete your own." });
    }
    if (!found.parentId) {
      const all = await ctx.db
        .query("reviewComments")
        .withIndex("by_clip", (q) => q.eq("clipId", found.clipId))
        .take(COMMENTS_SHOWN);
      for (const reply of all) {
        if (reply.parentId === found._id) await ctx.db.delete(reply._id);
      }
    }
    await ctx.db.delete(found._id);
  },
});

/**
 * The client's verdict: they approve, or they want changes. The team hears about it and
 * sees it on the review; a teammate still makes the decision that counts.
 */
export const verdict = mutation({
  args: { token: v.string(), guestId: v.string(), name: v.string(), approved: v.boolean() },
  handler: async (ctx, args) => {
    const { share, review } = await requireShare(ctx, args.token);
    guestAuthor(args.guestId);
    if (!share.allowVerdict) {
      throw new ConvexError({
        code: "forbidden",
        message: "The team has not asked you to approve this review.",
      });
    }
    if (review.status !== "open") {
      throw new ConvexError({ code: "conflict", message: "The team has already decided this." });
    }
    const name = guestName(args.name);
    await ctx.db.patch(review._id, {
      clientVerdict: { name, approved: args.approved, at: Date.now() },
    });
    await tellTeam(
      ctx,
      review,
      name,
      args.approved ? "Approved the review." : "Asked for changes.",
      {},
    );
  },
});
