import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Deletes a project's storyboard, its chapters and its takes, when it has one. */
export async function removeStoryboard(ctx: MutationCtx, projectId: Id<"projects">) {
  const board = await ctx.db
    .query("storyboards")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .unique();
  if (!board) return;
  const takes = await ctx.db
    .query("storyboardTakes")
    .withIndex("by_storyboard", (q) => q.eq("storyboardId", board._id))
    .collect();
  for (const take of takes) await ctx.db.delete(take._id);
  const chapters = await ctx.db
    .query("storyboardChapters")
    .withIndex("by_storyboard", (q) => q.eq("storyboardId", board._id))
    .collect();
  for (const chapter of chapters) await ctx.db.delete(chapter._id);
  await ctx.db.delete(board._id);
}
