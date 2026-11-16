import { z } from "zod";
import { defineStep } from "../../define";

export const mediaToMp3 = defineStep({
  id: "media-to-mp3",
  category: "media",
  title: "Convert to MP3",
  description: "Converts any media file to MP3.",
  endpoint: "/v1/media/transform/mp3",
  method: "POST",
  output: "file",
  primaryInput: "media_url",
  input: z.object({
    media_url: z.string().url().describe("URL of the media file to convert to MP3"),
    bitrate: z
      .string()
      .regex(/^[0-9]+k$/)
      .optional()
      .describe("Audio bitrate e.g. 128k, 192k, 320k"),
    sample_rate: z.number().optional().describe("Sample rate in Hz e.g. 44100"),
    webhook_url: z.string().url().optional().describe("Callback URL for async job completion"),
    id: z.string().optional().describe("Custom identifier echoed back in the response"),
  }),
});
