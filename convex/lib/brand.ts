import { BRAND_KEYS, brandProblem, readUploadRef } from "@ncat-dash/automation-core";
import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

const MAX_TRACKS = 100;

const invalid = (message: string) => new ConvexError({ code: "invalid_input", message });

/** Checks a logo or music file: a link that looks right, or one of the team's ready uploads. */
async function checkFile(
  ctx: MutationCtx,
  organizationId: string,
  key: "logo" | "music",
  value: string,
): Promise<void> {
  const problem = brandProblem(key, value);
  if (problem) throw invalid(problem);
  const uploadId = readUploadRef(value);
  if (!uploadId) return;
  const id = ctx.db.normalizeId("uploads", uploadId);
  const upload = id ? await ctx.db.get(id) : null;
  if (!upload || upload.organizationId !== organizationId || upload.status !== "ready") {
    throw new ConvexError({ code: "not_found", message: "That upload is no longer there." });
  }
}

/**
 * A brand as it is saved: its logo, colour and font, trimmed and checked, with empty ones
 * left out. Music is a library of its own (`checkedMusic`). The same rules hold for a
 * team's brand and a client's.
 */
export async function checkedBrand(
  ctx: MutationCtx,
  organizationId: string,
  input: Partial<Record<(typeof BRAND_KEYS)[number], string>>,
): Promise<Record<string, string>> {
  const brand: Record<string, string> = {};
  for (const key of BRAND_KEYS) {
    if (key === "music") continue;
    const value = input[key]?.trim();
    if (!value) continue;
    if (key === "logo") await checkFile(ctx, organizationId, key, value);
    else {
      const problem = brandProblem(key, value);
      if (problem) throw invalid(problem);
    }
    brand[key] = value;
  }
  return brand;
}

/** A music library as it is saved: each track named once, each file checked. */
export async function checkedMusic(
  ctx: MutationCtx,
  organizationId: string,
  tracks: { name: string; file: string }[],
): Promise<{ name: string; file: string }[]> {
  if (tracks.length > MAX_TRACKS) throw invalid(`Keep up to ${MAX_TRACKS} tracks.`);
  const music: { name: string; file: string }[] = [];
  for (const track of tracks) {
    const name = track.name.trim();
    if (!name || name.length > 60) throw invalid("Give each track a name of up to 60 letters.");
    if (music.some((other) => other.name.toLowerCase() === name.toLowerCase())) {
      throw invalid(`Two tracks are called "${name}". Give each its own name.`);
    }
    await checkFile(ctx, organizationId, "music", track.file.trim());
    music.push({ name, file: track.file.trim() });
  }
  return music;
}
