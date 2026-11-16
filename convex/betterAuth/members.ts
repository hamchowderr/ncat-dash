import { v } from "convex/values";
import { query } from "./_generated/server";

/**
 * The role a user holds in an organization, or null when they are not a member.
 * Component functions are never exposed to the internet; the app calls this through
 * components.betterAuth.members.roleFor after it has identified the caller.
 */
export const roleFor = query({
  args: { userId: v.string(), organizationId: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const member = await ctx.db
      .query("member")
      .withIndex("userId_organizationId", (q) =>
        q.eq("userId", args.userId).eq("organizationId", args.organizationId),
      )
      .unique();
    return member?.role ?? null;
  },
});

/** The organizations a user belongs to, with their role in each. */
export const teamsFor = query({
  args: { userId: v.string() },
  returns: v.array(v.object({ id: v.string(), name: v.string(), role: v.string() })),
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("member")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .take(100);
    const teams = [];
    for (const membership of memberships) {
      const id = ctx.db.normalizeId("organization", membership.organizationId);
      const organization = id ? await ctx.db.get(id) : null;
      if (organization) {
        teams.push({ id: organization._id, name: organization.name, role: membership.role });
      }
    }
    return teams;
  },
});
