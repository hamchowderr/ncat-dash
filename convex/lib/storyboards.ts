import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Deletes a storyboard with its chapters and its takes. */
export async function deleteBoard(ctx: MutationCtx, board: Doc<"storyboards">) {
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

/** Deletes a project's storyboard, its chapters and its takes, when it has one. */
export async function removeStoryboard(ctx: MutationCtx, projectId: Id<"projects">) {
  const board = await ctx.db
    .query("storyboards")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .unique();
  if (board) await deleteBoard(ctx, board);
}

/** Deletes the storyboard drafted from an upload, when it has one. */
export async function removeUploadDraft(ctx: MutationCtx, libraryItemId: Id<"libraryItems">) {
  const board = await ctx.db
    .query("storyboards")
    .withIndex("by_library_item", (q) => q.eq("libraryItemId", libraryItemId))
    .unique();
  if (board) await deleteBoard(ctx, board);
}
