import { ConvexError } from "convex/values";
import { components } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getCaller } from "./caller";
import { withTeamSteps } from "./teamSteps";

export type TeamRole = "owner" | "admin" | "member";

/** Roles that may change a team's connections and settings. */
export const MANAGER_ROLES: TeamRole[] = ["owner", "admin"];

/**
 * Identifies the caller and checks they belong to the team. Throws otherwise.
 * Every function that touches a team's data starts here: the organization id comes
 * from the client, so it is never trusted on its own.
 */
export async function requireMember(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  allowedRoles?: TeamRole[],
): Promise<{ userId: string; role: TeamRole }> {
  const user = await getCaller(ctx);
  if (!user) throw new ConvexError({ code: "unauthenticated", message: "Sign in first." });

  const role = (await ctx.runQuery(components.betterAuth.members.roleFor, {
    userId: user._id,
    organizationId,
  })) as TeamRole | null;
  if (!role) throw new ConvexError({ code: "forbidden", message: "You are not on this team." });
  if (allowedRoles && !allowedRoles.includes(role)) {
    throw new ConvexError({
      code: "forbidden",
      message: "Only a team owner or admin can do this.",
    });
  }
  // Whatever this call does next with the team's automations knows the team's own steps.
  await withTeamSteps(ctx, organizationId);
  return { userId: user._id, role };
}

/** Whether the caller is on the team, for queries that would rather show "not found". */
export async function isMember(ctx: QueryCtx | MutationCtx, organizationId: string) {
  try {
    await requireMember(ctx, organizationId);
    return true;
  } catch (error) {
    if (error instanceof ConvexError) return false;
    throw error;
  }
}

/** A caller identified another way, such as an MCP client signed in for its team. */
export type TeamCaller = { organizationId: string; userId: string };

/**
 * `requireMember` for functions both the dashboard and an MCP client call: the person
 * from their sign-in, or the MCP caller, who must still be on the team that owns the thing.
 */
export async function memberOrCaller(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  as?: TeamCaller,
): Promise<{ userId: string; role: TeamRole }> {
  if (!as) return requireMember(ctx, organizationId);
  if (as.organizationId !== organizationId) {
    throw new ConvexError({ code: "not_found", message: "That is not on this team." });
  }
  const role = (await ctx.runQuery(components.betterAuth.members.roleFor, {
    userId: as.userId,
    organizationId,
  })) as TeamRole | null;
  if (!role) throw new ConvexError({ code: "forbidden", message: "You are not on this team." });
  await withTeamSteps(ctx, organizationId);
  return { userId: as.userId, role };
}
