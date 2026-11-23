import { Presence } from "@convex-dev/presence";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { type RoomData, type Typing, typingValidator } from "./lib/typing";
import { findShare, guestAuthor, guestName, requireShare } from "./sharedReview";

// A client's place in the review room, through the share link: they show up for the team
// as "here now", see which teammates are here, and see who is typing where they could see
// the result. The team's side is in convex/presence.ts; both share one room, the review.

const presence = new Presence(components.presence);

/** Says "I am still here" for a client, with the name they gave. */
export const heartbeat = mutation({
  args: {
    token: v.string(),
    guestId: v.string(),
    name: v.string(),
    sessionId: v.string(),
    interval: v.number(),
  },
  handler: async (ctx, args) => {
    const { review } = await requireShare(ctx, args.token);
    const userId = guestAuthor(args.guestId);
    const tokens = await presence.heartbeat(
      ctx,
      review._id,
      userId,
      args.sessionId,
      Math.min(60_000, Math.max(5_000, args.interval)),
    );
    const data: RoomData = { name: guestName(args.name), client: true, typing: null };
    await presence.updateRoomUser(ctx, review._id, userId, data);
    return tokens;
  },
});

/** Says what the client is writing, or that they stopped. */
export const typing = mutation({
  args: { token: v.string(), guestId: v.string(), name: v.string(), typing: typingValidator },
  handler: async (ctx, args) => {
    const { review } = await requireShare(ctx, args.token);
    const data: RoomData = { name: guestName(args.name), client: true, typing: args.typing };
    await presence.updateRoomUser(ctx, review._id, guestAuthor(args.guestId), data);
    return null;
  },
});

/** Leaves the room at once, as the tab closes. */
export const disconnect = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    return await presence.disconnect(ctx, args.sessionToken);
  },
});

/** Whether a client may see what is being written in this thread (or as a new comment). */
async function canSee(
  ctx: QueryCtx | MutationCtx,
  share: Doc<"reviewShares">,
  typing: NonNullable<Typing>,
  writerIsClient: boolean,
): Promise<boolean> {
  if (writerIsClient || share.showTeamComments) return true;
  if (!typing.threadId) return false;
  const id = ctx.db.normalizeId("reviewComments", typing.threadId);
  const root = id ? await ctx.db.get(id) : null;
  return root?.client === true;
}

/**
 * Who has the review open, as the client sees it: teammates by name, other clients, and
 * where each is typing when the client could see what they write.
 */
export const here = query({
  args: { token: v.string(), guestId: v.string(), roomToken: v.string() },
  handler: async (ctx, args) => {
    // A link that stopped working shows nobody, so the page can say why instead of failing.
    const found = await findShare(ctx, args.token);
    if (!found) return [];
    const { share, review } = found;
    const me = guestAuthor(args.guestId);
    const states = await presence.list(ctx, args.roomToken, 50);
    // The room token must be this review's: the client's own heartbeat put them in it.
    if (!states.some((state) => state.userId === me)) return [];
    const team = await ctx.runQuery(components.betterAuth.members.people, {
      organizationId: review.organizationId,
    });
    const people = [];
    for (const state of states) {
      if (!state.online) continue;
      const data = (state.data ?? {}) as RoomData;
      const client = state.userId.startsWith("guest:");
      const member = client ? undefined : team.find((person) => person.id === state.userId);
      const name = client ? data.name : member?.name;
      if (!name) continue;
      const typing =
        data.typing && (await canSee(ctx, share, data.typing, client)) ? data.typing : null;
      people.push({
        id: state.userId,
        name,
        image: member?.image ?? null,
        client,
        me: state.userId === me,
        typing,
      });
    }
    return people;
  },
});
