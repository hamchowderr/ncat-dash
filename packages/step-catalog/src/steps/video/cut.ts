import { z } from "zod";
import { defineStep } from "../../define";

export const videoCut = defineStep({
  id: "video-cut",
  category: "video",
  title: "Cut segment out of video",
  description:
    "Removes specified segments from a video. Inverse of trim. Output URL opens inline in browser.",
  endpoint: "/v1/video/cut",
  method: "POST",
  output: "file",
  primaryInput: "video_url",
  input: z.object({
    video_url: z.string().url().describe("URL of the video to cut"),
    start: z.string().optional().describe("Start timestamp of segment to remove (e.g. '00:00:05')"),
    end: z.string().optional().describe("End timestamp of segment to remove (e.g. '00:01:30')"),
    video_codec: z.string().optional().describe("Video codec (e.g. 'libx264')"),
    video_preset: z.string().optional().describe("Encoding preset (e.g. 'medium')"),
    video_crf: z.number().min(0).max(51).optional().describe("Constant rate factor (0-51)"),
    audio_codec: z.string().optional().describe("Audio codec (e.g. 'aac')"),
    audio_bitrate: z.string().optional().describe("Audio bitrate (e.g. '128k')"),
    webhook_url: z.string().url().optional().describe("Webhook URL for async notification"),
    id: z.string().optional().describe("Custom job ID"),
  }),
});
