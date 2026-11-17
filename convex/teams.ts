import { v } from "convex/values";
import { components } from "./_generated/api";
import { query } from "./_generated/server";
import { authComponent } from "./auth";
import { requireMember } from "./lib/authz";

/** The signed-in user's teams. Null when nobody is signed in. */
export const mine = query({
  args: {},
  returns: v.union(
    v.null(),
    v.array(v.object({ id: v.string(), name: v.string(), role: v.string() })),
  ),
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
    return await ctx.runQuery(components.betterAuth.members.teamsFor, { userId: user._id });
  },
});

/** Everyone on a team with their role, and its open invitations. For any member. */
export const people = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    return await ctx.runQuery(components.betterAuth.members.peopleFor, {
      organizationId: args.organizationId,
    });
  },
});
