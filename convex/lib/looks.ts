import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** The team's saved looks, oldest first: the first is the one a blank step uses. */
export async function teamLooksOf(
  ctx: Pick<QueryCtx, "db">,
  organizationId: string,
): Promise<Doc<"teamLooks">[]> {
  return await ctx.db
    .query("teamLooks")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(100);
}

/**
 * What the Match A Saved Look step's `look` setting becomes for a run: the named look as
 * JSON (the team's first one when left blank). A name no look has is left as it is, so
 * the step says plainly that there is no look by that name.
 */
export function lookSettingFor(looks: Doc<"teamLooks">[], setting: unknown): string {
  const name = typeof setting === "string" ? setting.trim() : "";
  if (name.startsWith("{")) return name;
  const look = name ? looks.find((one) => one.name.toLowerCase() === name.toLowerCase()) : looks[0];
  return look ? JSON.stringify(look.frame) : name;
}
