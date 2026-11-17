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

/**
 * Everyone on a team as an Approval step names them: user id, name and role. For the
 * reviewer picker and the agent.
 */
export const members = query({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({ userId: v.string(), name: v.string(), email: v.string(), role: v.string() }),
  ),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: args.organizationId,
    });
    return team.members;
  },
});
