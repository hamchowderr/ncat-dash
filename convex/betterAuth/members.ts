import { paginationOptsValidator } from "convex/server";
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

/** Everyone on a team with their email address, and the team's name. For sending email. */
export const contactsFor = query({
  args: { organizationId: v.string() },
  returns: v.object({
    teamName: v.union(v.null(), v.string()),
    members: v.array(
      v.object({ userId: v.string(), email: v.string(), name: v.string(), role: v.string() }),
    ),
  }),
  handler: async (ctx, args) => {
    const organizationId = ctx.db.normalizeId("organization", args.organizationId);
    const organization = organizationId ? await ctx.db.get(organizationId) : null;
    const memberships = await ctx.db
      .query("member")
      .withIndex("organizationId", (q) => q.eq("organizationId", args.organizationId))
      .take(200);
    const members = [];
    for (const membership of memberships) {
      const userId = ctx.db.normalizeId("user", membership.userId);
      const user = userId ? await ctx.db.get(userId) : null;
      if (user) {
        members.push({
          userId: user._id,
          email: user.email,
          name: user.name,
          role: membership.role,
        });
      }
    }
    return { teamName: organization?.name ?? null, members };
  },
});

/** A user's email address and name, or null. */
export const contact = query({
  args: { userId: v.string() },
  returns: v.union(v.null(), v.object({ email: v.string(), name: v.string() })),
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId("user", args.userId);
    const user = userId ? await ctx.db.get(userId) : null;
    return user ? { email: user.email, name: user.name } : null;
  },
});

/** Everyone on a team with their role, and the invitations nobody has answered yet. */
export const peopleFor = query({
  args: { organizationId: v.string() },
  returns: v.object({
    members: v.array(
      v.object({
        id: v.string(),
        userId: v.string(),
        role: v.string(),
        name: v.string(),
        email: v.string(),
        image: v.union(v.string(), v.null()),
      }),
    ),
    invitations: v.array(v.object({ id: v.string(), email: v.string(), role: v.string() })),
  }),
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("member")
      .withIndex("organizationId", (q) => q.eq("organizationId", args.organizationId))
      .take(200);
    const members = [];
    for (const membership of memberships) {
      const userId = ctx.db.normalizeId("user", membership.userId);
      const user = userId ? await ctx.db.get(userId) : null;
      if (user) {
        members.push({
          id: membership._id,
          userId: user._id,
          role: membership.role,
          name: user.name,
          email: user.email,
          image: user.image ?? null,
        });
      }
    }
    const invitations = await ctx.db
      .query("invitation")
      .withIndex("organizationId", (q) => q.eq("organizationId", args.organizationId))
      .take(200);
    const now = Date.now();
    return {
      members,
      invitations: invitations
        .filter((invitation) => invitation.status === "pending" && invitation.expiresAt > now)
        .map((invitation) => ({
          id: invitation._id,
          email: invitation.email,
          role: invitation.role ?? "member",
        })),
    };
  },
});

/** The people on a team, with the name and picture to show for each. */
export const people = query({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({ id: v.string(), name: v.string(), image: v.union(v.null(), v.string()) }),
  ),
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("member")
      .withIndex("organizationId", (q) => q.eq("organizationId", args.organizationId))
      .take(200);
    const people = [];
    for (const membership of memberships) {
      const id = ctx.db.normalizeId("user", membership.userId);
      const user = id ? await ctx.db.get(id) : null;
      if (user) people.push({ id: user._id, name: user.name, image: user.image ?? null });
    }
    return people;
  },
});

/**
 * The person behind a signed-in session, or null when the session is missing, has
 * expired or belongs to someone else. Same checks as Better Auth's safeGetAuthUser.
 * It lives here rather than going through adapter.findOne because adapter.ts loads
 * all of Better Auth on every call; this file stays small so each call stays fast.
 */
export const caller = query({
  args: { sessionId: v.string(), userId: v.string() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const sessionId = ctx.db.normalizeId("session", args.sessionId);
    const session = sessionId ? await ctx.db.get(sessionId) : null;
    if (!session || session.expiresAt <= Date.now() || session.userId !== args.userId) return null;
    const userId = ctx.db.normalizeId("user", args.userId);
    return userId ? await ctx.db.get(userId) : null;
  },
});

/**
 * What an invite-only copy needs to know before someone signs up: whether anyone has an
 * account yet (the first person, the owner, always may), and whether this address has an
 * invitation to a team that is still open.
 */
export const signUpCheck = query({
  args: { email: v.string() },
  returns: v.object({ hasAccounts: v.boolean(), invited: v.boolean() }),
  handler: async (ctx, args) => {
    const someone = await ctx.db.query("user").first();
    const email = args.email.trim().toLowerCase();
    const invitations = await ctx.db
      .query("invitation")
      .withIndex("email", (q) => q.eq("email", email))
      .take(50);
    const now = Date.now();
    const invited = invitations.some((i) => i.status === "pending" && i.expiresAt > now);
    return { hasAccounts: someone !== null, invited };
  },
});

/**
 * Every account, a page at a time, for announcements about the service (the operator's
 * Send An Email page). Only the fields an email needs.
 */
export const accountsPage = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(
      v.object({
        userId: v.string(),
        email: v.string(),
        name: v.string(),
        emailVerified: v.boolean(),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query("user").paginate(args.paginationOpts);
    return {
      page: result.page.map((user) => ({
        userId: user._id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified === true,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** How many accounts there are, counted up to 10,000, for the Send An Email page. */
export const accountCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => (await ctx.db.query("user").take(10_000)).length,
});

/** The account with this address, or null. Used to tell whether a beta tester joined. */
export const userByEmail = query({
  args: { email: v.string() },
  returns: v.union(v.null(), v.object({ id: v.string() })),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("user")
      .withIndex("email_name", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .first();
    return user ? { id: user._id } : null;
  },
});
