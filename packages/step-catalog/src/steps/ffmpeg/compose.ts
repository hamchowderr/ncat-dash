import { z } from "zod";
import { defineStep } from "../../define";

export const ffmpegOption = z.object({
  option: z.string().describe("A setting such as -c:v"),
  argument: z.union([z.string(), z.number(), z.null()]).optional().describe("Its value"),
});

export const ffmpegCompose = defineStep({
  id: "ffmpeg-compose",
  category: "ffmpeg",
  title: "Custom edit",
  description:
    "A custom edit for what no other step does: change a file's format, join files, filter them or lay one over another, all in one request. A video it makes plays right in the browser.",
  endpoint: "/v1/ffmpeg/compose",
  method: "POST",
  output: "files",
  primaryInput: null,
  input: z.object({
    inputs: z
      .array(z.object({ file_url: z.string().url(), options: z.array(ffmpegOption).optional() }))
      .min(1)
      .describe("Input files, each with its own settings if needed"),
    filters: z
      .array(z.object({ filter: z.string() }))
      .optional()
      .describe("Filters to apply"),
    outputs: z
      .array(z.object({ options: z.array(ffmpegOption) }))
      .min(1)
      .describe("One entry per output file, each with its settings"),
    global_options: z.array(ffmpegOption).optional().describe("Flags for the whole command"),
    metadata: z
      .object({
        thumbnail: z.boolean().optional(),
        filesize: z.boolean().optional(),
        duration: z.boolean().optional(),
        bitrate: z.boolean().optional(),
        encoder: z.boolean().optional(),
      })
      .optional()
      .describe("Extra details to report about each output"),
    webhook_url: z.string().url().optional(),
    id: z.string().optional(),
  }),
});
