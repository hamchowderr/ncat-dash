import { z } from "zod";
import { defineStep } from "../../define";

/**
 * Only in Chowderr's toolkit fork (docs/video/cutout.md there). Not listed as a step: the
 * runner keeps one cut-out per video (convex/lib/masks.ts) for every effect that needs the
 * speaker cut out, and New Background and Add Motion Graphics make it when it is missing.
 */
export const videoCutout = defineStep({
  id: "video-cutout",
  category: "video",
  title: "Cut out the speaker",
  description:
    "Finds the speaker in every frame, with no green screen, and makes their cut-out, kept with the video for New Background and pieces behind the speaker.",
  endpoint: "/v1/video/cutout",
  method: "POST",
  output: "json",
  primaryInput: "video_url",
  input: z.object({
    video_url: z.string().url(),
    webhook_url: z.string().url().optional(),
    id: z.string().optional(),
  }),
});
