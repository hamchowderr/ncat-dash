import { type Infer, v } from "convex/values";

/**
 * What happened in a review that the team's Slack channel hears about. A comment's
 * `commentId` is always the first comment of its thread, which is what a Slack thread
 * stands for.
 */
export const reviewPostValidator = v.union(
  v.object({ kind: v.literal("review_opened"), reviewId: v.id("reviews") }),
  v.object({
    kind: v.literal("client_feedback"),
    reviewId: v.id("reviews"),
    commentId: v.optional(v.id("reviewComments")),
    from: v.string(),
    body: v.string(),
  }),
  v.object({
    kind: v.literal("mention"),
    reviewId: v.id("reviews"),
    commentId: v.id("reviewComments"),
    from: v.string(),
    // The teammate who wrote it, so chat apps can show their name and picture.
    fromUserId: v.optional(v.string()),
    body: v.string(),
    mentioned: v.array(v.string()),
  }),
  v.object({
    kind: v.literal("team_reply"),
    reviewId: v.id("reviews"),
    commentId: v.id("reviewComments"),
    from: v.string(),
    fromUserId: v.optional(v.string()),
    body: v.string(),
  }),
);

export type ReviewPost = Infer<typeof reviewPostValidator>;
