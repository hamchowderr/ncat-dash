import { z } from "zod";
import { defineStep } from "../../define";

export const videoThumbnail = defineStep({
  id: "video-thumbnail",
  category: "video",
  title: "Video thumbnail",
  description: "Extracts a thumbnail image from a specific timestamp in a video.",
  endpoint: "/v1/video/thumbnail",
  method: "POST",
  output: "file",
  primaryInput: "video_url",
  input: z.object({
    video_url: z.string().url().describe("URL of the video to extract thumbnail from"),
    timestamp: z
      .string()
      .optional()
      .describe("Timestamp to extract thumbnail at (e.g. '00:00:10')"),
    webhook_url: z.string().url().optional().describe("Webhook URL for async notification"),
    id: z.string().optional().describe("Custom job ID"),
  }),
});
