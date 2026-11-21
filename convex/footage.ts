import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { bucketOf, putText, storageConnection } from "./lib/bucket";

/** The team's storage, for leaving the footage note. */
export const connection = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => await storageConnection(ctx, args.organizationId),
});

/**
 * Leaves what Check Footage found in the creator's folder, as "Footage check.txt", so the
 * person who filmed it sees what to film again where they upload. A problem writing it
 * never touches the run.
 */
export const writeNote = internalAction({
  args: { organizationId: v.string(), key: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    const storage = await ctx.runQuery(internal.footage.connection, {
      organizationId: args.organizationId,
    });
    if (!storage) return;
    try {
      await putText(await bucketOf(storage), args.key, args.text);
    } catch (error) {
      console.warn("Could not leave the footage note:", error);
    }
  },
});
