import { baseName, followedName, librarySearchText, plainName } from "@takewon/automation-core";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// When an upload is renamed, what was made from it follows: the library titles of its
// clips, captions and thumbnails, the names on the runs that made them, and the copies kept
// in Finished. A made file a person renamed keeps their name, because only names that
// still start with the old one change.

const MAX_MADE = 500;

/** "clip.mp4" gives ".mp4"; a name without one gives "". */
function endingOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

const sameStem = (a: string | null, b: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Renames what was made from a library file after its title went from `oldTitle` to
 * `newTitle`. Returns how many made files were renamed.
 */
export async function followStartRename(
  ctx: MutationCtx,
  item: Doc<"libraryItems">,
  oldTitle: string,
  newTitle: string,
): Promise<number> {
  const oldStem = plainName(oldTitle);
  const newStem = plainName(newTitle);
  if (!oldStem || !newStem || sameStem(oldStem, newStem)) return 0;

  const made = await ctx.db
    .query("libraryItems")
    .withIndex("by_parent", (q) => q.eq("parentId", item._id))
    .take(MAX_MADE);

  // The runs that made them name their files after the file they started from.
  const runs = new Set<Id<"runs">>();
  for (const one of made) if (one.runId) runs.add(one.runId);
  for (const runId of runs) await followRunName(ctx, runId, oldStem, newTitle);

  const moves: { from: string; to: string }[] = [];
  let renamed = 0;
  for (const one of made) {
    if (one.source !== "automation") continue;
    const title = followedName(one.title, oldStem, newStem);
    if (title) {
      await ctx.db.patch(one._id, {
        title,
        searchText: librarySearchText({ ...one, title }),
      });
      renamed++;
    }
    // Its copy in the team's folder, such as Finished/Weekly clips/IMG 4521 captioned.mp4.
    if (one.key) {
      const name = baseName(one.key);
      const next = followedName(name, oldStem, newStem);
      if (next && !/[/\\]/.test(next)) {
        moves.push({ from: one.key, to: `${one.key.slice(0, -name.length)}${next}` });
      }
    }
  }
  if (moves.length > 0) {
    await ctx.scheduler.runAfter(0, internal.files.followRenamedFiles, {
      organizationId: item.organizationId,
      moves,
    });
  }
  return renamed;
}

/** Points a run's starting name at the new one, so its pages and steps use it. */
async function followRunName(
  ctx: MutationCtx,
  runId: Id<"runs">,
  oldStem: string,
  newTitle: string,
) {
  const run = await ctx.db.get(runId);
  if (!run) return;
  const trigger = (run.trigger ?? {}) as Record<string, unknown>;
  const name = trigger.file_name;
  if (typeof name !== "string") return;
  const stem = plainName(name);
  // A run another run started begins from that run's file, "IMG 4521 captioned.mp4".
  const next = sameStem(stem, oldStem)
    ? newTitle
    : followedName(stem ?? "", oldStem, plainName(newTitle) ?? newTitle);
  if (!next) return;
  await ctx.db.patch(run._id, { trigger: { ...trigger, file_name: `${next}${endingOf(name)}` } });
}
