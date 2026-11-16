import { z } from "zod";
import { defineStep } from "../../define";

export const mediaMetadata = defineStep({
  id: "media-metadata",
  category: "media",
  title: "Media metadata",
  description:
    "Extracts full FFprobe metadata from a media file: format, codecs, resolution, duration, bitrates, streams.",
  endpoint: "/v1/media/metadata",
  method: "POST",
  output: "json",
  primaryInput: "media_url",
  input: z.object({
    media_url: z.string().url().describe("URL of the media file to analyze"),
    webhook_url: z.string().url().optional().describe("Callback URL for async job completion"),
    id: z.string().optional().describe("Custom identifier echoed back in the response"),
  }),
});
