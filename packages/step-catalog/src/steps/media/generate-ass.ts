import { z } from "zod";
import { defineStep } from "../../define";

export const mediaGenerateAss = defineStep({
  id: "media-generate-ass",
  category: "media",
  title: "Generate caption file (ASS)",
  description:
    "Generates an ASS subtitle file from media without burning it into the video. Use when you need the subtitle file separately for downstream processing.",
  endpoint: "/v1/media/generate/ass",
  method: "POST",
  output: "file",
  primaryInput: "media_url",
  input: z.object({
    media_url: z.string().url().describe("URL of the media file to generate subtitles from"),
    language: z.string().optional().describe("Language code (default: auto)"),
    webhook_url: z.string().url().optional().describe("Callback URL for async job completion"),
    id: z.string().optional().describe("Custom identifier echoed back in the response"),
  }),
});
