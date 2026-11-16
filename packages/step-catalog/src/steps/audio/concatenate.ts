import { z } from "zod";
import { defineStep } from "../../define";

export const audioConcatenate = defineStep({
  id: "audio-concatenate",
  category: "audio",
  title: "Join audio",
  description: "Combines multiple audio files into a single audio file in the order provided.",
  endpoint: "/v1/audio/concatenate",
  method: "POST",
  output: "file",
  primaryInput: null,
  listInput: { field: "audio_urls", itemKey: "audio_url" },
  input: z.object({
    audio_urls: z
      .array(z.object({ audio_url: z.string().url() }))
      .min(1)
      .describe("Array of audio file URLs to concatenate in order"),
    webhook_url: z.string().url().optional().describe("Callback URL for async job completion"),
    id: z.string().optional().describe("Custom identifier echoed back in the response"),
  }),
});
