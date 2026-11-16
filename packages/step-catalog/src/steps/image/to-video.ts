import { z } from "zod";
import { defineStep } from "../../define";

export const imageToVideo = defineStep({
  id: "image-to-video",
  category: "image",
  title: "Image to video",
  description:
    "Transforms a static image into a video with configurable duration and Ken Burns zoom effect. Output URL opens inline in browser.",
  endpoint: "/v1/image/transform/video",
  method: "POST",
  output: "file",
  primaryInput: "image_url",
  input: z.object({
    image_url: z.string().url().describe("URL of the image to convert to video"),
    length: z.number().min(0.1).max(400).optional().describe("Video length in seconds"),
    frame_rate: z.number().int().min(15).max(60).optional().describe("Frames per second"),
    zoom_speed: z.number().min(0).max(100).optional().describe("Ken Burns zoom speed (0 to 100)"),
    webhook_url: z.string().url().optional(),
    id: z.string().optional(),
  }),
});
