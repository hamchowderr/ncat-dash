import { v } from "convex/values";

/**
 * What someone in a review room is writing right now: a new comment (no thread) or a
 * reply in a thread, on one clip at one version. Null when they are not writing.
 */
export const typingValidator = v.union(
  v.null(),
  v.object({
    clipId: v.string(),
    version: v.number(),
    threadId: v.union(v.string(), v.null()),
  }),
);

export type Typing = { clipId: string; version: number; threadId: string | null } | null;

/** The presence data each person carries in a review room. */
export type RoomData = { name?: string; client?: boolean; typing?: Typing };
