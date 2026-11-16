import { z } from "zod";
import { defineStep } from "../../define";

export const videoConcatenate = defineStep({
  id: "video-concatenate",
  category: "video",
  title: "Join videos",
  description:
    "Joins multiple videos into one continuous video in the order provided. Output URL opens inline in browser.",
  endpoint: "/v1/video/concatenate",
  method: "POST",
  output: "file",
  primaryInput: null,
  input: z.object({
    video_urls: z
      .array(
        z.object({
          video_url: z.string().url().describe("URL of a video to concatenate"),
        }),
      )
      .describe("Ordered list of videos to join"),
    webhook_url: z.string().url().optional().describe("Webhook URL for async notification"),
    id: z.string().optional().describe("Custom job ID"),
  }),
});
