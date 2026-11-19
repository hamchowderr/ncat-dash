import { z } from "zod";
import { defineStep } from "../../define";

const PIECE_TYPES = [
  "lower_third",
  "title",
  "keyword",
  "stat",
  "chapter",
  "follow",
  "quote",
  "transition",
  "logo",
] as const;
// In the order the toolkit lists them.
const SOUNDS = [
  "click",
  "ding",
  "impact",
  "pop",
  "riser",
  "slide",
  "thud",
  "tick",
  "whoosh",
] as const;
const text = z.string().max(200);

/**
 * Only in Chowderr's toolkit fork (docs/video/motion.md there). Not listed as a step: the
 * Add Motion Graphics and Add Sound Effects steps place the pieces and sounds and send this.
 */
export const videoMotion = defineStep({
  id: "video-motion",
  category: "video",
  title: "Motion graphics",
  description:
    "Draws designed motion pieces (names, titles, numbers, chapter cards, follow cards, transitions, a logo) and sound effects onto a video at the times given.",
  endpoint: "/v1/video/motion",
  method: "POST",
  output: "file",
  primaryInput: "video_url",
  input: z.object({
    video_url: z.string().url(),
    pieces: z
      .array(
        z.object({
          type: z.enum(PIECE_TYPES),
          start: z.number().min(0),
          duration: z.number().positive().optional(),
          title: text.optional(),
          subtitle: text.optional(),
          // A link, or a pointer to one of the team's uploads, swapped for a link when sent.
          image: z.string().min(1).optional(),
          sound: z.enum(SOUNDS).nullable().optional(),
        }),
      )
      .max(120)
      .default([]),
    sounds: z
      .array(
        z.object({
          sound: z.enum(SOUNDS),
          at: z.number().min(0),
          volume: z.number().min(0).max(2).optional(),
        }),
      )
      .max(400)
      .default([]),
    style: z
      .object({
        look: z.enum(["bold", "clean", "editorial", "neon"]).optional(),
        accent: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
        text: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
        font: z
          .string()
          .regex(/^[A-Za-z0-9 ._-]{1,60}$/)
          .optional(),
      })
      .optional(),
    sound_volume: z.number().min(0).max(2).optional(),
    piece_sounds: z.boolean().optional(),
    webhook_url: z.string().url().optional(),
    id: z.string().optional(),
  }),
});
