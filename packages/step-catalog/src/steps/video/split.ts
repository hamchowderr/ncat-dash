import { z } from "zod";
import { defineStep } from "../../define";

export const videoSplit = defineStep({
  id: "video-split",
  category: "video",
  title: "Split video",
  description:
    "Splits a video into multiple segments at specified timestamps. Output URLs open inline in browser.",
  endpoint: "/v1/video/split",
  method: "POST",
  output: "files",
  primaryInput: "video_url",
  input: z.object({
    video_url: z.string().url().describe("URL of the video to split"),
    timestamps: z
      .array(z.string())
      .optional()
      .describe("Timestamps to split at (e.g. ['00:01:00', '00:02:30'])"),
    webhook_url: z.string().url().optional().describe("Webhook URL for async notification"),
    id: z.string().optional().describe("Custom job ID"),
  }),
});
