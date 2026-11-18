import { type CaptionSetup, NO_CAPTION_SETUP } from "@ncat-dash/automation-core";
import type { QueryCtx } from "../_generated/server";

/**
 * The team's captions from Settings: word fixes, saved styles and the style for each
 * shape. Every caption step reads them through here.
 */
export async function captionSetupOf(ctx: QueryCtx, organizationId: string): Promise<CaptionSetup> {
  const settings = await ctx.db
    .query("teamSettings")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .first();
  return (settings?.captions as CaptionSetup | undefined) ?? NO_CAPTION_SETUP;
}
