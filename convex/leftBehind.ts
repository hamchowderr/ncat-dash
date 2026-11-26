import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { sameStorage } from "./lib/bucket";
import { storedOnValidator } from "./schema";

/**
 * When a team switches servers, its uploads and library files stay on the storage of the
 * server it left. Their keys only say where a file is inside "the team's storage", so
 * without a note they would be looked for on the new one and not found, while still
 * listed. This marks each of them with the storage it is on (storedOn), a page at a time;
 * a file marked with the storage the team now uses (it switched back) loses its mark.
 */

const PAGE = 200;

const storageArg = v.object({ bucket: v.string(), endpoint: v.union(v.null(), v.string()) });

export const mark = internalMutation({
  args: {
    organizationId: v.string(),
    // The storage the team left.
    left: storedOnValidator,
    // The storage it uses now.
    now: storageArg,
    table: v.union(v.literal("uploads"), v.literal("libraryItems")),
    cursor: v.union(v.null(), v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query(args.table)
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .paginate({ cursor: args.cursor, numItems: PAGE });
    for (const file of page.page) {
      if (!file.key) continue;
      if (file.storedOn) {
        if (sameStorage(file.storedOn, args.now))
          await ctx.db.patch(file._id, { storedOn: undefined });
      } else if (!sameStorage(args.left, args.now)) {
        await ctx.db.patch(file._id, { storedOn: args.left });
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.leftBehind.mark, {
        ...args,
        cursor: page.continueCursor,
      });
    } else if (args.table === "uploads") {
      await ctx.scheduler.runAfter(0, internal.leftBehind.mark, {
        ...args,
        table: "libraryItems",
        cursor: null,
      });
    }
    return null;
  },
});
