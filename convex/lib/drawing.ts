import { v } from "convex/values";

/** A drawing on the paused frame, as @takewon/review-core describes it. */
export const drawingValidator = v.array(
  v.object({
    tool: v.union(v.literal("pen"), v.literal("arrow"), v.literal("box")),
    color: v.union(
      v.literal("red"),
      v.literal("yellow"),
      v.literal("green"),
      v.literal("blue"),
      v.literal("white"),
    ),
    points: v.array(v.number()),
  }),
);
