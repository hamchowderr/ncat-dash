import { z } from "zod";
import { defineStep } from "../../define";
import { captionSettings } from "../video/caption";

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
    canvas_width: z.number().int().min(1).optional().describe("Width to lay captions out for"),
    canvas_height: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Height to lay captions out for. Give both width and height, or neither."),
    settings: captionSettings.optional().describe("Caption styling settings"),
    replace: z
      .array(z.object({ find: z.string(), replace: z.string() }))
      .optional()
      .describe("Find-and-replace pairs for caption text"),
    exclude_time_ranges: z
      .array(z.object({ start: z.string(), end: z.string() }))
      .optional()
      .describe("Time ranges to leave captions out of"),
    segments: z
      .array(
        z.object({
          start: z.number().min(0),
          end: z.number().min(0),
          text: z.string().optional(),
          words: z
            .array(z.object({ word: z.string(), start: z.number().min(0), end: z.number().min(0) }))
            .max(2000),
        }),
      )
      .max(20000)
      .optional()
      .describe("A transcript with word times already made, so the media is not transcribed again"),
    webhook_url: z.string().url().optional().describe("Callback URL for async job completion"),
    id: z.string().optional().describe("Custom identifier echoed back in the response"),
  }),
});
