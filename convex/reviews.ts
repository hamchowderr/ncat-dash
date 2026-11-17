import { AGENT, asksAgent, COMMENT_LIMIT, mentionedIn } from "@ncat-dash/review-core";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { authComponent } from "./auth";
import { notify } from "./lib/alerts";
import { isMember, requireMember } from "./lib/authz";
import { CLIP_LIMIT, openReview, shareOf, VERSION_LIMIT } from "./lib/reviews";
import { decideApproval } from "./lib/runner";

// A review shows this many comments at most; a room is for one round of notes.
const COMMENTS_SHOWN = 500;

const gone = () => new ConvexError({ code: "not_found", message: "This review is gone." });

async function commentsOf(ctx: QueryCtx | MutationCtx, reviewId: Id<"reviews">) {
  return await ctx.db
    .query("reviewComments")
    .withIndex("by_review", (q) => q.eq("reviewId", reviewId))
    .take(COMMENTS_SHOWN);
}

function openThreads(comments: Doc<"reviewComments">[]) {
  return comments.filter((comment) => !comment.parentId && !comment.resolved).length;
}

/** The team's reviews, newest first, with what is left to do on each. */
export const list = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(60);
    return await Promise.all(
      reviews.map(async (review) => {
        const clips = await ctx.db
          .query("reviewClips")
          .withIndex("by_review", (q) => q.eq("reviewId", review._id))
          .take(CLIP_LIMIT);
        const comments = await commentsOf(ctx, review._id);
        const first = clips[0];
        return {
          _id: review._id,
          title: review.title,
          status: review.status,
          createdAt: review._creationTime,
          fromRun: review.runStepId !== undefined,
          clips: clips.length,
          cover: first ? first.versions[first.versions.length - 1].url : null,
          comments: comments.length,
          open: openThreads(comments),
        };
      }),
    );
  },
});

/** One review with its clips. Null when it is gone or belongs to another team. */
export const get = query({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review || !(await isMember(ctx, review.organizationId))) return null;
    const clips = await ctx.db
      .query("reviewClips")
      .withIndex("by_review", (q) => q.eq("reviewId", review._id))
      .take(CLIP_LIMIT);
    const comments = await commentsOf(ctx, review._id);
    const step = review.runStepId ? await ctx.db.get(review.runStepId) : null;
    return {
      _id: review._id,
      organizationId: review.organizationId,
      title: review.title,
      status: review.status,
      createdAt: review._creationTime,
      decidedBy: review.decidedBy ?? null,
      decidedAt: review.decidedAt ?? null,
      // What the client said through the share link, if they have.
      clientVerdict: review.clientVerdict ?? null,
      // An automation is paused on this room and carries on when it is approved.
      holdsRun: step?.status === "waiting_approval",
      fromRun: review.runStepId !== undefined,
      clips: clips.map((clip) => {
        const own = comments.filter((comment) => comment.clipId === clip._id);
        return {
          _id: clip._id,
          title: clip.title,
          versions: clip.versions.map((version) => ({
            url: version.url,
            addedAt: version.addedAt,
          })),
          comments: own.length,
          open: openThreads(own),
        };
      }),
    };
  },
});

/** The room an approval step opened, so the run's page can point to it. */
export const forStep = query({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const review = await ctx.db
      .query("reviews")
      .withIndex("by_runStep", (q) => q.eq("runStepId", args.runStepId))
      .first();
    if (!review || !(await isMember(ctx, review.organizationId))) return null;
    return review._id;
  },
});

/** The comments on one clip, oldest first. */
export const comments = query({
  args: { clipId: v.id("reviewClips") },
  handler: async (ctx, args) => {
    const clip = await ctx.db.get(args.clipId);
    if (!clip || !(await isMember(ctx, clip.organizationId))) return [];
    const { userId } = await requireMember(ctx, clip.organizationId);
    const rows = await ctx.db
      .query("reviewComments")
      .withIndex("by_clip", (q) => q.eq("clipId", args.clipId))
      .take(COMMENTS_SHOWN);
    return rows.map((comment) => ({
      id: comment._id,
      parentId: comment.parentId ?? null,
      version: comment.version,
      time: comment.time,
      body: comment.body,
      authorId: comment.authorId,
      authorName: comment.authorName,
      createdAt: comment._creationTime,
      resolved: comment.resolved,
      client: comment.client === true,
      mine: (comment.agent ? comment.agent.askedBy : comment.authorId) === userId,
      agent: comment.agent ?? null,
    }));
  },
});

/** The people on the team, to show who is here and to offer names after "@". */
export const people = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const people = await ctx.runQuery(components.betterAuth.members.people, {
      organizationId: args.organizationId,
    });
    return { me: userId, people };
  },
});

/** Opens a review of some files, one clip each. */
export const create = mutation({
  args: { organizationId: v.string(), title: v.optional(v.string()), urls: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const urls = args.urls.filter((url) => /^https?:\/\//i.test(url));
    const reviewId = await openReview(ctx, {
      organizationId: args.organizationId,
      title: args.title ?? "",
      urls,
      createdBy: userId,
    });
    if (!reviewId) {
      throw new ConvexError({ code: "invalid", message: "Pick at least one file to review." });
    }
    return reviewId;
  },
});

/** Adds a changed clip as its next version. Earlier versions and their comments stay. */
export const addVersion = mutation({
  args: { clipId: v.id("reviewClips"), url: v.string() },
  handler: async (ctx, args) => {
    const clip = await ctx.db.get(args.clipId);
    if (!clip) throw gone();
    const { userId } = await requireMember(ctx, clip.organizationId);
    if (!/^https?:\/\//i.test(args.url)) {
      throw new ConvexError({ code: "invalid", message: "That is not a file address." });
    }
    if (clip.versions.length >= VERSION_LIMIT) {
      throw new ConvexError({ code: "limit", message: "This clip has too many versions." });
    }
    await ctx.db.patch(clip._id, {
      versions: [...clip.versions, { url: args.url, addedBy: userId, addedAt: Date.now() }],
    });
  },
});

/**
 * Approves the review or asks for changes. When an automation is paused on this room,
 * this is also the decision on its approval step: approving lets the run carry on.
 */
export const decide = mutation({
  args: { reviewId: v.id("reviews"), approved: v.boolean() },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw gone();
    const { userId } = await requireMember(ctx, review.organizationId);
    if (review.status !== "open") {
      throw new ConvexError({ code: "conflict", message: "Someone has already decided this." });
    }
    const step = review.runStepId ? await ctx.db.get(review.runStepId) : null;
    if (step && step.status === "waiting_approval") {
      // This marks the review as decided too.
      await decideApproval(ctx, step, args.approved, userId);
      return;
    }
    await ctx.db.patch(review._id, {
      status: args.approved ? "approved" : "rejected",
      decidedBy: userId,
      decidedAt: Date.now(),
    });
  },
});

/** Puts a decided review back in review. A run that has already moved on is not undone. */
export const reopen = mutation({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw gone();
    await requireMember(ctx, review.organizationId);
    // A client with the link can give a fresh verdict on the new round.
    await ctx.db.patch(review._id, {
      status: "open",
      decidedBy: undefined,
      decidedAt: undefined,
      clientVerdict: undefined,
    });
  },
});

/** Deletes a review with its clips and comments. The files themselves are not touched. */
export const remove = mutation({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) return;
    await requireMember(ctx, review.organizationId);
    const step = review.runStepId ? await ctx.db.get(review.runStepId) : null;
    if (step?.status === "waiting_approval") {
      throw new ConvexError({
        code: "conflict",
        message: "An automation is waiting on this review. Approve it or ask for changes first.",
      });
    }
    for (const comment of await commentsOf(ctx, review._id)) await ctx.db.delete(comment._id);
    const clips = await ctx.db
      .query("reviewClips")
      .withIndex("by_review", (q) => q.eq("reviewId", review._id))
      .take(CLIP_LIMIT);
    for (const clip of clips) await ctx.db.delete(clip._id);
    const share = await shareOf(ctx, review._id);
    if (share) await ctx.db.delete(share._id);
    await ctx.db.delete(review._id);
  },
});

/** Writes a comment at a moment in a clip, or a reply to one. */
export const comment = mutation({
  args: {
    clipId: v.id("reviewClips"),
    body: v.string(),
    time: v.number(),
    version: v.number(),
    parentId: v.optional(v.id("reviewComments")),
  },
  handler: async (ctx, args) => {
    const clip = await ctx.db.get(args.clipId);
    if (!clip) throw gone();
    const { userId } = await requireMember(ctx, clip.organizationId);
    const body = args.body.trim();
    if (body === "") {
      throw new ConvexError({ code: "invalid", message: "Write something first." });
    }
    if (body.length > COMMENT_LIMIT) {
      throw new ConvexError({ code: "invalid", message: "That comment is too long." });
    }
    const existing = await ctx.db
      .query("reviewComments")
      .withIndex("by_review", (q) => q.eq("reviewId", clip.reviewId))
      .take(COMMENTS_SHOWN);
    if (existing.length >= COMMENTS_SHOWN) {
      throw new ConvexError({ code: "limit", message: "This review has too many comments." });
    }

    let time = Math.max(0, Number.isFinite(args.time) ? args.time : 0);
    let version = Math.min(clip.versions.length, Math.max(1, Math.round(args.version)));
    let parentId: Id<"reviewComments"> | undefined;
    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.clipId !== clip._id) {
        throw new ConvexError({ code: "not_found", message: "That comment is gone." });
      }
      // Threads are one level deep: a reply to a reply joins the same thread.
      parentId = parent.parentId ?? parent._id;
      time = parent.time;
      version = parent.version;
      // A reply brings a resolved thread back.
      const root = parent.parentId ? await ctx.db.get(parent.parentId) : parent;
      if (root?.resolved) await ctx.db.patch(root._id, { resolved: false });
    }

    const user = await authComponent.safeGetAuthUser(ctx);
    const id = await ctx.db.insert("reviewComments", {
      reviewId: clip.reviewId,
      clipId: clip._id,
      organizationId: clip.organizationId,
      version,
      time,
      body,
      authorId: userId,
      authorName: user?.name?.trim() || "Someone",
      parentId,
      resolved: false,
    });

    // Teammates named after "@" hear about it, under the bell and by email as they chose.
    const team = await ctx.runQuery(components.betterAuth.members.people, {
      organizationId: clip.organizationId,
    });
    const mentioned = mentionedIn(body, team).filter((id) => id !== userId);
    if (mentioned.length > 0) {
      const review = await ctx.db.get(clip.reviewId);
      await notify(ctx, {
        organizationId: clip.organizationId,
        kind: "mention",
        recipients: mentioned,
        automationName: review?.title || clip.title,
        message: body,
        retries: 0,
        reviewId: clip.reviewId,
        clipId: clip._id,
        commentId: parentId ?? id,
        from: user?.name?.trim() || "Someone",
      });
    }

    // "@Agent" asks for an answer in the same thread. It shows as thinking at once, and
    // the agent server fills it in (convex/reviewAgent.ts).
    if (asksAgent(body)) {
      const root = parentId ?? id;
      const thinking = existing.some(
        (other) => other.agent?.state === "thinking" && (other.parentId ?? other._id) === root,
      );
      if (!thinking) {
        const answerId = await ctx.db.insert("reviewComments", {
          reviewId: clip.reviewId,
          clipId: clip._id,
          organizationId: clip.organizationId,
          version,
          time,
          body: "",
          authorId: AGENT.id,
          authorName: AGENT.name,
          parentId: root,
          resolved: false,
          agent: { askedBy: userId, state: "thinking" },
        });
        await ctx.scheduler.runAfter(0, internal.reviewAgent.answer, { answerId });
      }
    }
    return id;
  },
});

/** Asks the agent again after an answer that did not come. Only the person who asked can. */
export const askAgentAgain = mutation({
  args: { commentId: v.id("reviewComments") },
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.commentId);
    if (!found?.agent)
      throw new ConvexError({ code: "not_found", message: "That answer is gone." });
    const { userId } = await requireMember(ctx, found.organizationId);
    if (found.agent.askedBy !== userId) {
      throw new ConvexError({
        code: "forbidden",
        message: "Only the person who asked can ask again.",
      });
    }
    if (found.agent.state !== "failed") return;
    await ctx.db.patch(found._id, { body: "", agent: { askedBy: userId, state: "thinking" } });
    await ctx.scheduler.runAfter(0, internal.reviewAgent.answer, { answerId: found._id });
  },
});

/** Marks a thread as dealt with, or brings it back. */
export const resolve = mutation({
  args: { commentId: v.id("reviewComments"), resolved: v.boolean() },
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.commentId);
    if (!found) return;
    await requireMember(ctx, found.organizationId);
    await ctx.db.patch(found.parentId ?? found._id, { resolved: args.resolved });
  },
});

/** Deletes your own comment. Deleting the first comment of a thread deletes its replies. */
export const removeComment = mutation({
  args: { commentId: v.id("reviewComments") },
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.commentId);
    if (!found) return;
    const { userId } = await requireMember(ctx, found.organizationId);
    // The agent's answer belongs to whoever asked for it.
    const owner = found.agent ? found.agent.askedBy : found.authorId;
    if (owner !== userId) {
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
