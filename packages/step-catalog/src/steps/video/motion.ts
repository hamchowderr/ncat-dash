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
  "big_text",
  "graph",
  "doodle",
  "checklist",
] as const;
export const DOODLE_SHAPES = ["crown", "star", "heart", "arrow", "burst", "circle"] as const;
const window = { start: z.number().min(0).optional(), duration: z.number().positive().optional() };
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
  keptFields: ["mask_url"],
  id: "video-motion",
  category: "video",
  title: "Motion graphics",
  description:
    "Draws designed motion pieces (names, titles, numbers, chapter cards, follow cards, transitions, a logo, big words, a rising graph, doodles, a tick list) and sound effects onto a video at the times given. Pieces can sit behind the speaker, who can get a sticker outline, and the picture can punch in.",
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
          // "behind" draws the piece between the background and the speaker.
          layer: z.enum(["front", "behind"]).optional(),
          items: z.array(z.string().max(60)).max(6).optional(),
          shape: z.enum(DOODLE_SHAPES).optional(),
          x: z.number().min(0).max(100).optional(),
          y: z.number().min(0).max(100).optional(),
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
    // The speaker's cut-out (/v1/video/cutout), kept per video. Without one the toolkit
    // makes it for behind pieces and outlines, and hands it back.
    mask_url: z.string().url().optional(),
    outlines: z
      .array(
        z.object({
          ...window,
          color: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .optional(),
          width: z.number().min(0.3).max(4).optional(),
        }),
      )
      .max(50)
      .optional(),
    zooms: z
      .array(
        z.object({
          start: z.number().min(0),
          duration: z.number().positive(),
          scale: z.number().min(1.02).max(2.5).optional(),
          focus_y: z.number().min(0).max(1).optional(),
        }),
      )
      .max(200)
      .optional(),
    sound_volume: z.number().min(0).max(2).optional(),
    piece_sounds: z.boolean().optional(),
    webhook_url: z.string().url().optional(),
    id: z.string().optional(),
  }),
});
