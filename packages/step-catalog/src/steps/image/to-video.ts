import { z } from "zod";
import { defineStep } from "../../define";

export const imageToVideo = defineStep({
  id: "image-to-video",
  category: "image",
  title: "Image to video",
  description:
    "Transforms a static image into a video with configurable duration and Ken Burns zoom effect. Output URL opens inline in browser.",
  endpoint: "/v1/image/convert/video",
  method: "POST",
  output: "file",
  primaryInput: "image_url",
  input: z.object({
    image_url: z.string().url().describe("URL of the image to convert to video"),
    duration: z.number().optional().describe("Video duration in seconds"),
    zoom_factor: z.number().optional().describe("Ken Burns zoom factor"),
    webhook_url: z.string().url().optional(),
    id: z.string().optional(),
  }),
});
