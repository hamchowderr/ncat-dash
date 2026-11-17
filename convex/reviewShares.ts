import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { isMember, requireMember } from "./lib/authz";
import { shareOf } from "./lib/reviews";

// The team's side of a review's share link: switching it on and off, and what the
// client may do through it. The client's side is in convex/sharedReview.ts.

const gone = () => new ConvexError({ code: "not_found", message: "This review is gone." });

/** A long random secret for the link: 64 hex characters. */
function newToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

/** The review's share link and its settings, or null when it is switched off. */
export const forReview = query({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review || !(await isMember(ctx, review.organizationId))) return null;
    const share = await shareOf(ctx, review._id);
    if (!share) return null;
    return {
      token: share.token,
      allowVerdict: share.allowVerdict,
      showTeamComments: share.showTeamComments,
    };
  },
});

/**
 * Switches the link on, or changes what the client may do through it. Turning it on
 * makes a new secret, so a link that was switched off earlier never works again.
 */
export const set = mutation({
  args: {
    reviewId: v.id("reviews"),
    allowVerdict: v.boolean(),
    showTeamComments: v.boolean(),
  },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw gone();
    const { userId } = await requireMember(ctx, review.organizationId);
    const settings = { allowVerdict: args.allowVerdict, showTeamComments: args.showTeamComments };
    const existing = await shareOf(ctx, review._id);
    if (existing) {
      await ctx.db.patch(existing._id, settings);
      return existing.token;
    }
    const token = newToken();
    await ctx.db.insert("reviewShares", {
      reviewId: review._id,
      organizationId: review.organizationId,
      token,
      createdBy: userId,
      ...settings,
    });
    return token;
  },
});

/** Switches the link off. Anyone who has it sees that the review is no longer shared. */
export const stop = mutation({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) return;
    await requireMember(ctx, review.organizationId);
    const share = await shareOf(ctx, review._id);
    if (share) await ctx.db.delete(share._id);
  },
});
