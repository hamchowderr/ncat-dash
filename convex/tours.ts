import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { authComponent } from "./auth";
import { type TourId, tourIdValidator } from "./lib/tours";

// Whether someone has been through one of the guided tours: the dashboard's, which starts
// by itself once when setting up ends, or a page's, which starts on the first visit. Once
// finished or closed, a tour only starts when asked for.

const tourId = tourIdValidator;

async function requireUser(ctx: QueryCtx | MutationCtx) {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) throw new ConvexError({ code: "unauthenticated", message: "Sign in first." });
  return user._id as string;
}

function endOf(ctx: QueryCtx | MutationCtx, userId: string, tour: TourId) {
  return ctx.db
    .query("tourEnds")
    .withIndex("by_user_and_tour", (q) => q.eq("userId", userId).eq("tourId", tour))
    .unique();
}

/** Whether the person asking has finished or closed the tour. */
export const ended = query({
  args: { tourId },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return (await endOf(ctx, userId, args.tourId)) !== null;
  },
});

/** Notes that the person asking finished the tour or closed it part way. */
export const end = mutation({
  args: { tourId, how: v.union(v.literal("finished"), v.literal("closed")) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const existing = await endOf(ctx, userId, args.tourId);
    const fields = { how: args.how, endedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("tourEnds", { userId, tourId: args.tourId, ...fields });
  },
});
