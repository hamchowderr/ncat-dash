import { Presence } from "@convex-dev/presence";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireMember } from "./lib/authz";
import { type RoomData, typingValidator } from "./lib/typing";

// Who is in a review room right now. The room's id is the review's id.
const presence = new Presence(components.presence);

/** Says "I am still here". Only a member of the review's team can be in its room. */
export const heartbeat = mutation({
  args: { roomId: v.string(), userId: v.string(), sessionId: v.string(), interval: v.number() },
  handler: async (ctx, args) => {
    const reviewId = ctx.db.normalizeId("reviews", args.roomId);
    const review = reviewId ? await ctx.db.get(reviewId) : null;
    if (!review) throw new ConvexError({ code: "not_found", message: "This review is gone." });
    // The id to show comes from the session, never from the browser.
    const { userId } = await requireMember(ctx, review.organizationId);
    return await presence.heartbeat(ctx, args.roomId, userId, args.sessionId, args.interval);
  },
});

/** The people in a room. The room token is only handed out by `heartbeat`. */
export const list = query({
  args: { roomToken: v.string() },
  handler: async (ctx, args) => {
    return await presence.list(ctx, args.roomToken);
  },
});

/** Leaves the room at once. Sent as the tab closes, so it cannot carry a sign-in. */
export const disconnect = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    return await presence.disconnect(ctx, args.sessionToken);
  },
});

/** Says what a teammate is writing in the room, or that they stopped. */
export const typing = mutation({
  args: { roomId: v.string(), typing: typingValidator },
  handler: async (ctx, args) => {
    const reviewId = ctx.db.normalizeId("reviews", args.roomId);
    const review = reviewId ? await ctx.db.get(reviewId) : null;
    if (!review) return null;
    const { userId } = await requireMember(ctx, review.organizationId);
    const data: RoomData = { typing: args.typing };
    await presence.updateRoomUser(ctx, args.roomId, userId, data);
    return null;
  },
});
