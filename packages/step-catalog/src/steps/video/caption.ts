import { z } from "zod";
import { defineStep } from "../../define";

/** Caption styling, shared by "Caption video" and "Generate caption file". */
export const captionSettings = z.object({
  line_color: z.string().optional().describe("Hex color for caption lines"),
  word_color: z.string().optional().describe("Hex color for active word"),
  outline_color: z.string().optional().describe("Hex color for text outline"),
  all_caps: z.boolean().optional().describe("Convert text to uppercase"),
  max_words_per_line: z.number().int().optional().describe("Max words per caption line"),
  x: z.number().int().optional().describe("X position on screen"),
  y: z.number().int().optional().describe("Y position on screen"),
  position: z
    .enum([
      "bottom_left",
      "bottom_center",
      "bottom_right",
      "middle_left",
      "middle_center",
      "middle_right",
      "top_left",
      "top_center",
      "top_right",
    ])
    .optional()
    .describe("Caption position on screen"),
  alignment: z.enum(["left", "center", "right"]).optional(),
  font_family: z.string().optional().describe("Font family name"),
  font_size: z.number().int().optional().describe("Font size"),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikeout: z.boolean().optional(),
  style: z
    .enum(["classic", "karaoke", "highlight", "underline", "word_by_word"])
    .optional()
    .describe("Caption display style"),
  outline_width: z.number().int().optional(),
  spacing: z.number().int().optional(),
  angle: z.number().int().optional(),
  shadow_offset: z.number().int().optional(),
});

export const videoCaption = defineStep({
  id: "video-caption",
  category: "video",
  title: "Caption video",
  description:
    "Adds styled captions to a video. Auto-transcribes if no captions provided. Supports karaoke, highlight, word-by-word, and classic styles. Output URL opens inline in browser.",
  endpoint: "/v1/video/caption",
  method: "POST",
  output: "file",
  primaryInput: "video_url",
  // A captioned copy of a labelled variant, beside the clean one.
  outputLabels: () => ["captioned"],
  labelsFollow: true,
  valueInputs: {
    captions: {
      value: "captions",
      // The toolkit accepts caption text only with the classic style. The other styles
      // need word timings, which it works out when it transcribes the video itself.
      when: (settings) => {
        const style = (settings.settings as { style?: unknown } | undefined)?.style;
        return style === undefined || String(style).toLowerCase() === "classic";
      },
    },
  },
  input: z.object({
    video_url: z.string().url().describe("URL of the video to caption"),
    captions: z
      .string()
      .optional()
      .describe("Pre-existing caption text. If omitted, auto-transcription is used."),
    language: z.string().optional().describe("Language code for transcription (default: auto)"),
    settings: captionSettings.optional().describe("Caption styling settings"),
    replace: z
      .array(z.object({ find: z.string(), replace: z.string() }))
      .optional()
      .describe("Find-and-replace pairs for caption text"),
    exclude_time_ranges: z
      .array(z.object({ start: z.string(), end: z.string() }))
      .optional()
      .describe("Time ranges to exclude captions from (string timestamps)"),
    webhook_url: z.string().url().optional().describe("Webhook URL for async notification"),
    id: z.string().optional().describe("Custom job ID"),
  }),
});
