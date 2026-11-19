import { z } from "zod";
import { defineStep } from "../../define";

/**
 * The picture model (CLIP) on the toolkit. Not a step people add: the Content Library and
 * Add B-Roll use it to find footage by what it shows.
 */
export const mediaLook = defineStep({
  id: "media-look",
  category: "media",
  title: "Look at media",
  description:
    "Turns frames of a video, pictures and words into vectors with the CLIP picture model, so footage can be found by what it shows.",
  endpoint: "/v1/media/look",
  method: "POST",
  output: "json",
  primaryInput: null,
  input: z.object({
    media_url: z.string().url().optional().describe("URL of a video or picture to sample"),
    every: z.number().min(0.5).max(60).optional().describe("Seconds between sampled frames"),
    image_urls: z.array(z.string().url()).max(60).optional().describe("Pictures to look at"),
    texts: z.array(z.string().max(1000)).max(200).optional().describe("Words to turn into vectors"),
    webhook_url: z.string().url().optional().describe("Callback URL for async job completion"),
    id: z.string().optional().describe("Custom identifier echoed back in the response"),
  }),
});
