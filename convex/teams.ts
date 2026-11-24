import { v } from "convex/values";
import { components } from "./_generated/api";
import { query } from "./_generated/server";
import { getCaller } from "./lib/caller";
import { requireMember } from "./lib/authz";
import { titlesOf } from "./profiles";

/** The signed-in user's teams. Null when nobody is signed in. */
export const mine = query({
  args: {},
  returns: v.union(
    v.null(),
    v.array(v.object({ id: v.string(), name: v.string(), role: v.string() })),
  ),
  handler: async (ctx) => {
    const user = await getCaller(ctx);
    if (!user) return null;
    return await ctx.runQuery(components.betterAuth.members.teamsFor, { userId: user._id });
  },
});

/**
 * Everyone on a team with their role, photo and what they do, and its open invitations.
 * For any member.
 */
export const people = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const people = await ctx.runQuery(components.betterAuth.members.peopleFor, {
      organizationId: args.organizationId,
    });
    const titles = await titlesOf(
      ctx,
      people.members.map((person) => person.userId),
    );
    return {
      ...people,
      members: people.members.map((person) => ({
        ...person,
        title: titles.get(person.userId) ?? null,
      })),
    };
  },
});

/**
 * Everyone on a team as an Approval step names them: user id, name, role and what they
 * do. For the reviewer picker and the agent.
 */
export const members = query({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      userId: v.string(),
      name: v.string(),
      email: v.string(),
      role: v.string(),
      title: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: args.organizationId,
    });
    const titles = await titlesOf(
      ctx,
      team.members.map((person) => person.userId),
    );
    return team.members.map((person) => ({ ...person, title: titles.get(person.userId) ?? null }));
  },
});
