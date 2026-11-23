import { vOnCompleteArgs } from "@convex-dev/workpool";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { postDone } from "./lib/reviewChatQueue";

/**
 * The chat pool's word that a review post is done, however it went: the team's next post
 * to that app goes (lib/reviewChatQueue.ts).
 */
export const sent = internalMutation({
  args: vOnCompleteArgs(v.object({ postId: v.id("reviewChatPosts") })),
  handler: async (ctx, { context, result }) => {
    if (result.kind === "failed") {
      console.warn("A review post to a chat app failed", result.error);
    }
    await postDone(ctx, context.postId);
  },
});
