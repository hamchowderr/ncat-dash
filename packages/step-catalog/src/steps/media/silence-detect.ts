import { z } from "zod";
import { defineStep } from "../../define";

export const mediaSilenceDetect = defineStep({
  id: "media-silence-detect",
  category: "media",
  title: "Detect silence",
  description:
    "Detects silent sections in audio or video. Useful for auto-editing and content analysis.",
  endpoint: "/v1/media/silence",
  method: "POST",
  output: "json",
  primaryInput: "media_url",
  input: z.object({
    media_url: z.string().url().describe("URL of the media file to analyze for silence"),
    noise_tolerance: z.number().optional().describe("dB threshold for silence detection e.g. -30"),
    duration: z.number().optional().describe("Minimum silence duration in seconds"),
    webhook_url: z.string().url().optional().describe("Callback URL for async job completion"),
    id: z.string().optional().describe("Custom identifier echoed back in the response"),
  }),
});
