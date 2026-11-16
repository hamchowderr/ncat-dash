import { z } from "zod";
import { defineStep } from "../../define";

export const mediaConvert = defineStep({
  id: "media-convert",
  category: "media",
  title: "Convert media",
  description: "Converts media files between formats with customizable codec options.",
  endpoint: "/v1/media/convert",
  method: "POST",
  output: "file",
  primaryInput: "media_url",
  input: z.object({
    media_url: z.string().url().describe("URL of the media file to convert"),
    format: z.string().describe("Target format e.g. mp4, webm, avi"),
    video_codec: z.string().optional().describe("Video codec for conversion"),
    video_preset: z.string().optional().describe("Encoding preset (e.g. 'medium')"),
    video_crf: z.number().min(0).max(51).optional().describe("Constant rate factor (0-51)"),
    audio_codec: z.string().optional().describe("Audio codec for conversion"),
    audio_bitrate: z.string().optional().describe("Audio bitrate (e.g. '128k')"),
    webhook_url: z.string().url().optional().describe("Callback URL for async job completion"),
    id: z.string().optional().describe("Custom identifier echoed back in the response"),
  }),
});
