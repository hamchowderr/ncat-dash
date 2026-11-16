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
    duration: z.number().min(0.1).describe("Minimum silence duration in seconds"),
    noise: z
      .string()
      .optional()
      .describe("Loudness below which sound counts as silence e.g. -30dB"),
    start: z.string().optional().describe("Where to start looking (e.g. '00:00:10')"),
    end: z.string().optional().describe("Where to stop looking (e.g. '00:05:00')"),
    mono: z.boolean().optional().describe("Mix to one channel before analysing"),
    webhook_url: z.string().url().optional().describe("Callback URL for async job completion"),
    id: z.string().optional().describe("Custom identifier echoed back in the response"),
  }),
});
