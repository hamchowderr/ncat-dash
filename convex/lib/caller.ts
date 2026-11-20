import { components } from "../_generated/api";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";

/** The signed-in person, as Better Auth stores them. */
export type Caller = {
  _id: string;
  name: string;
  email: string;
  image?: string | null;
  [field: string]: unknown;
};

/**
 * Who is calling, or undefined when nobody is signed in or the session has ended.
 *
 * This does the same checks as `authComponent.safeGetAuthUser`: the session in the
 * token must still exist and not have expired, and its person must exist. It talks to
 * a small Better Auth component function (`betterAuth/members.caller`) instead of going
 * through `../auth` or the component's `adapter`, because both load all of Better Auth
 * (about 2 MB of code). Convex loads a
 * function's imports on every call, so ordinary functions that only need to know who
 * is calling must not import it. `convex/lib/caller.test.ts` holds that line.
 */
export async function getCaller(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<Caller | undefined> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return undefined;
  const user = await ctx.runQuery(components.betterAuth.members.caller, {
    sessionId: identity.sessionId as string,
    userId: identity.subject,
  });
  return (user ?? undefined) as Caller | undefined;
}
