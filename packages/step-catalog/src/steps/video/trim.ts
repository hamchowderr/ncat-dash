import { z } from "zod";
import { defineStep } from "../../define";

export const videoTrim = defineStep({
  id: "video-trim",
  category: "video",
  title: "Trim video",
  description:
    "Keeps content between start and end timestamps. Supports custom encoding. Output URL opens inline in browser.",
  endpoint: "/v1/video/trim",
  method: "POST",
  output: "file",
  primaryInput: "video_url",
  input: z.object({
    video_url: z.string().url().describe("URL of the video to trim"),
    start: z.string().optional().describe("Start timestamp (e.g. '00:00:05')"),
    end: z.string().optional().describe("End timestamp (e.g. '00:01:30')"),
    video_codec: z.string().optional().describe("Video codec (e.g. 'libx264')"),
    video_preset: z
      .string()
      .default("veryfast")
      .describe("Encoding preset: veryfast saves quickly; slower ones make smaller files"),
    video_crf: z.number().min(0).max(51).optional().describe("Constant rate factor (0-51)"),
    audio_codec: z.string().optional().describe("Audio codec (e.g. 'aac')"),
    audio_bitrate: z.string().optional().describe("Audio bitrate (e.g. '128k')"),
    webhook_url: z.string().url().optional().describe("Webhook URL for async notification"),
    id: z.string().optional().describe("Custom job ID"),
  }),
});
