import { z } from "zod";
import { defineStep } from "../../define";

export const audioBeats = defineStep({
  id: "audio-beats",
  category: "audio",
  title: "Find the beat",
  description:
    "Finds a song's tempo, every beat and where each bar starts, in seconds, with plain sound analysis and no AI. Also says how steady the beat is, so speech or free-time music is not cut on. Works on a song or a video whose sound is music.",
  endpoint: "/v1/audio/beats",
  method: "POST",
  output: "json",
  primaryInput: "media_url",
  input: z.object({
    media_url: z.string().url().describe("The song, or a video with music"),
    max_seconds: z
      .number()
      .min(1)
      .max(3600)
      .optional()
      .describe("Read at most this many seconds (10 minutes when empty)"),
    beats_per_bar: z
      .number()
      .int()
      .min(3)
      .max(4)
      .optional()
      .describe("Beats in a bar: 4 for most music, 3 for a waltz"),
    min_bpm: z.number().min(30).max(300).optional().describe("Slowest tempo to look for"),
    max_bpm: z.number().min(30).max(300).optional().describe("Fastest tempo to look for"),
    webhook_url: z.string().url().optional().describe("Callback URL for async job completion"),
    id: z.string().optional().describe("Custom identifier echoed back in the response"),
  }),
});
