import { z } from "zod";
import { defineStep } from "../../define";

const KINDS = ["blur", "color", "image", "video"] as const;

/** Only in Chowderr's toolkit fork (docs/video/background.md there). */
export const videoBackground = defineStep({
  id: "video-background",
  category: "video",
  title: "New background",
  description:
    "Puts a new background behind the speaker, with no green screen: their own background blurred, a colour, a picture or a video. The speaker is cut out once and the cut-out is kept with the video, so pieces behind the speaker reuse it.",
  endpoint: "/v1/video/background",
  method: "POST",
  output: "file",
  primaryInput: "video_url",
  keptFields: ["mask_url"],
  input: z.object({
    video_url: z.string().url().describe("The video with the speaker"),
    background: z
      .enum(KINDS)
      .default("blur")
      .describe("What goes behind the speaker")
      .meta({
        title: "Background",
        choiceLabels: {
          blur: "Their own background, blurred",
          color: "A colour",
          image: "A picture",
          video: "A video",
        },
      }),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#1b3a5c")
      .describe("The colour, for a colour background")
      .meta({ title: "Colour" }),
    background_url: z
      .string()
      .url()
      .optional()
      .describe("The picture or video, for a picture or video background. A shorter video loops.")
      .meta({ title: "Picture or video" }),
    blur: z
      .number()
      .min(2)
      .max(80)
      .default(24)
      .describe("How strong the blur is, for a blurred background")
      .meta({ title: "Blur" }),
    mask_url: z.string().url().optional(),
    webhook_url: z.string().url().optional(),
    id: z.string().optional(),
  }),
  toRequest: (b) => ({
    video_url: b.video_url,
    background: {
      type: b.background,
      ...(b.background === "color" ? { color: b.color } : {}),
      ...(b.background === "blur" ? { blur: b.blur } : {}),
      ...(b.background === "image" || b.background === "video" ? { url: b.background_url } : {}),
    },
    ...(b.mask_url ? { mask_url: b.mask_url } : {}),
  }),
});
