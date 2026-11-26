import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { TableNames } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { getCaller } from "./lib/caller";
import { forgetNews } from "./lib/news";
import { forgetProfile } from "./profiles";
import { support } from "./lib/support";

/**
 * Deleting your own account (Settings > Account > Password And Devices). Better Auth's
 * delete-user route checks the password, or that the sign-in is recent, then calls
 * `prepare` below just before it deletes the account, its sessions and its sign-ins.
 *
 * What happens to each team, the way Vercel and GitHub do it:
 * - a team nobody else is on is deleted with the account, everything in it;
 * - a team with other people on it, where you are its only owner, has to be handed to
 *   someone else or deleted first, so no team is left without an owner;
 * - any other team you simply leave.
 */

type Team = { id: string; name: string };
export type AccountPlan = { deleteWithYou: Team[]; leave: Team[]; handOverFirst: Team[] };

const teamValidator = v.object({ id: v.string(), name: v.string() });
const planValidator = v.object({
  deleteWithYou: v.array(teamValidator),
  leave: v.array(teamValidator),
  handOverFirst: v.array(teamValidator),
});

async function planFor(ctx: QueryCtx | MutationCtx, userId: string): Promise<AccountPlan> {
  const teams = await ctx.runQuery(components.betterAuth.deletion.teamsOf, { userId });
  const plan: AccountPlan = { deleteWithYou: [], leave: [], handOverFirst: [] };
  for (const team of teams) {
    const named = { id: team.id, name: team.name };
    if (team.people <= 1) plan.deleteWithYou.push(named);
    else if (team.role === "owner" && team.owners <= 1) plan.handOverFirst.push(named);
    else plan.leave.push(named);
  }
  return plan;
}

/** What deleting the caller's account would do to each of their teams. */
export const plan = query({
  args: {},
  returns: v.union(v.null(), planValidator),
  handler: async (ctx) => {
    const user = await getCaller(ctx);
    if (!user) return null;
    return await planFor(ctx, user._id);
  },
});

/** Why the account can't be deleted yet, in plain words. */
export function handOverMessage(teams: Team[]): string {
  const names = teams.map((team) => team.name);
  const list =
    names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return (
    `You are the only owner of ${list}. Make someone else an owner, or delete ` +
    `${names.length === 1 ? "the team" : "those teams"}, before deleting your account.`
  );
}

/**
 * Rows on a team that are one person's own: the chat and meeting accounts they linked,
 * and how they want to hear about things. They go when the person leaves with their
 * account. Each table's index starts with the team, then the person.
 */
const PERSONAL: { table: TableNames; index: string }[] = [
  { table: "notificationPreferences", index: "by_organization_and_user" },
  { table: "discordPeople", index: "by_member" },
  { table: "teamsPeople", index: "by_member" },
  { table: "telegramPeople", index: "by_member" },
  { table: "zoomConnections", index: "by_member" },
  { table: "googleMeetConnections", index: "by_member" },
  { table: "microsoftConnections", index: "by_member" },
  { table: "dropboxConnections", index: "by_member" },
];

interface ByMember {
  withIndex(
    index: string,
    range: (q: {
      eq(field: string, value: string): { eq(field: string, value: string): unknown };
    }) => unknown,
  ): { take(n: number): Promise<{ _id: never }[]> };
}

async function forgetOnTeam(ctx: MutationCtx, organizationId: string, userId: string) {
  for (const { table, index } of PERSONAL) {
    const rows = await (ctx.db.query(table) as unknown as ByMember)
      .withIndex(index, (q) => q.eq("organizationId", organizationId).eq("userId", userId))
      .take(100);
    for (const row of rows) await ctx.db.delete(row._id);
  }
}

/**
 * Runs just before Better Auth deletes the account. Returns why it can't be deleted yet,
 * or null once its teams are dealt with: teams only this person is on are deleted (their
 * data goes in the background, teamDeletion.ts), the others are left.
 */
export const prepare = internalMutation({
  args: { userId: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const plan = await planFor(ctx, args.userId);
    if (plan.handOverFirst.length > 0) return handOverMessage(plan.handOverFirst);
    for (const team of plan.deleteWithYou) {
      const name = await ctx.runMutation(components.betterAuth.deletion.removeTeam, {
        organizationId: team.id,
      });
      await ctx.runMutation(internal.teamDeletion.begin, {
        organizationId: team.id,
        name: name ?? team.name,
        by: args.userId,
        reason: "account",
      });
    }
    for (const team of plan.leave) {
      await forgetOnTeam(ctx, team.id, args.userId);
      await ctx.runMutation(components.betterAuth.deletion.leaveTeam, {
        userId: args.userId,
        organizationId: team.id,
      });
    }
    // Their product news subscription and its consent records.
    const contact = await ctx.runQuery(components.betterAuth.members.contact, {
      userId: args.userId,
    });
    await forgetNews(ctx, { userId: args.userId, email: contact?.email });
    await ctx.runMutation(components.betterAuth.deletion.forgetPerson, { userId: args.userId });
    const tours = await ctx.db
      .query("tourEnds")
      .withIndex("by_user_and_tour", (q) => q.eq("userId", args.userId))
      .take(100);
    for (const row of tours) await ctx.db.delete(row._id);
    // Their time zone, what they do, and the stored file of their photo.
    await forgetProfile(ctx, args.userId);
    // The help requests they asked, and the answers to them.
    await support.removeForRequester(ctx, args.userId);
    return null;
  },
});
