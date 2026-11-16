import { z } from "zod";
import { defineStep } from "../../define";

export const ffmpegCompose = defineStep({
  id: "ffmpeg-compose",
  category: "ffmpeg",
  title: "FFmpeg compose",
  description:
    "Direct FFmpeg interface for complex custom media operations not covered by other endpoints. Supports transcoding, concatenation, filtering, overlays, and any FFmpeg-supported operation. Video output opens inline in browser.",
  endpoint: "/v1/ffmpeg/compose",
  method: "POST",
  output: "files",
  primaryInput: null,
  input: z.object({
    inputs: z
      .array(z.object({ file_url: z.string().url() }))
      .min(1)
      .describe("Array of input file URLs"),
    filters: z.array(z.string()).optional().describe("FFmpeg filter strings"),
    output_format: z.string().optional().describe("Output format"),
    options: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Arbitrary FFmpeg flags as key-value pairs"),
    webhook_url: z.string().url().optional(),
    id: z.string().optional(),
  }),
});
