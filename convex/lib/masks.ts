import { sourceKey } from "@takewon/automation-core";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * The speaker's cut-out (the toolkit's /v1/video/cutout mask), kept per video so it is
 * made once: New Background and Add Motion Graphics with pieces behind the speaker hand it
 * to the toolkit, and the toolkit hands back a new one when it had to make it.
 */

/** Steps that take the kept cut-out as `mask_url`. */
export const MASK_STEPS = new Set(["video-background", "video-motion"]);

/** The cut-out kept for this video, if it was made before. */
export async function maskFor(
  ctx: QueryCtx,
  organizationId: string,
  url: string,
): Promise<string | null> {
  const found = await ctx.db
    .query("speakerMasks")
    .withIndex("by_source", (q) =>
      q.eq("organizationId", organizationId).eq("source", sourceKey(url)),
    )
    .first();
  return found?.mask ?? null;
}

/** The step input with the kept cut-out filled in, when the step takes one and none is set. */
export async function withKeptMask(
  ctx: QueryCtx,
  organizationId: string,
  stepId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!MASK_STEPS.has(stepId) || input.mask_url || typeof input.video_url !== "string") {
    return input;
  }
  const mask = await maskFor(ctx, organizationId, input.video_url);
  return mask ? { ...input, mask_url: mask } : input;
}

/**
 * A finished job's result with any new cut-out taken out of it (kept for its video, and
 * left out of the job's files so it is never handed on as a finished video).
 */
export async function keepMaskFrom(
  ctx: MutationCtx,
  organizationId: string,
  input: unknown,
  result: unknown,
): Promise<unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const { mask_url: mask, ...rest } = result as Record<string, unknown>;
  if (typeof mask !== "string") return result;
  const video = (input as { video_url?: unknown } | null)?.video_url;
  if (typeof video === "string") {
    const source = sourceKey(video);
    const old = await ctx.db
      .query("speakerMasks")
      .withIndex("by_source", (q) => q.eq("organizationId", organizationId).eq("source", source))
      .first();
    if (old) await ctx.db.patch(old._id, { mask, savedAt: Date.now() });
    else await ctx.db.insert("speakerMasks", { organizationId, source, mask, savedAt: Date.now() });
  }
  return rest;
}
