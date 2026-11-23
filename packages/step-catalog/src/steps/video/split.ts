import { z } from "zod";
import { defineStep } from "../../define";

export const videoSplit = defineStep({
  id: "video-split",
  category: "video",
  title: "Split video",
  description:
    "Cuts a video into separate clips, one per start and end time you give. Output URLs open inline in browser.",
  endpoint: "/v1/video/split",
  method: "POST",
  output: "files",
  primaryInput: "video_url",
  input: z.object({
    video_url: z.string().url().describe("URL of the video to split"),
    splits: z
      .array(z.object({ start: z.string(), end: z.string() }))
      .min(1)
      .describe("Clips to make, each with a start and end time (e.g. '00:01:00')"),
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
