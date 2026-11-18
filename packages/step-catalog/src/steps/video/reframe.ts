import { z } from "zod";
import { defineStep } from "../../define";

/** Only in Chowderr's toolkit fork (docs/video/reframe.md there). */
export const videoReframe = defineStep({
  id: "video-reframe",
  category: "video",
  title: "Follow the speaker",
  description:
    "Turns a wide video into a vertical, square or 4:5 one that follows whoever is talking: it holds on them, drifts gently when they move and cuts across when someone else speaks. Put it after Clips so each clip is followed.",
  endpoint: "/v1/video/reframe",
  method: "POST",
  output: "file",
  primaryInput: "video_url",
  input: z.object({
    video_url: z.string().url().describe("The video to reframe"),
    aspect: z
      .enum(["9:16", "1:1", "4:5", "16:9"])
      .default("9:16")
      .describe("The shape of the finished video")
      .meta({
        title: "Shape",
        choiceLabels: {
          "9:16": "Vertical 9:16",
          "1:1": "Square 1:1",
          "4:5": "Portrait 4:5",
          "16:9": "Wide 16:9",
        },
      }),
    follow: z
      .enum(["speaker", "largest_face", "center"])
      .default("speaker")
      .describe("What the frame stays on")
      .meta({
        title: "Follow",
        choiceLabels: {
          speaker: "The person talking",
          largest_face: "The biggest face",
          center: "Nothing, keep the middle",
        },
      }),
    switch_after: z
      .number()
      .min(0)
      .max(10)
      .default(0.5)
      .describe("Seconds someone must talk before the camera moves to them")
      .meta({ title: "Wait before switching" }),
    min_hold: z
      .number()
      .min(0)
      .max(30)
      .default(1.5)
      .describe("The camera never moves to someone new more often than this, in seconds")
      .meta({ title: "Shortest shot" }),
    smoothing: z
      .number()
      .min(0)
      .max(10)
      .default(1.5)
      .describe("Seconds over which small movements are smoothed so the frame drifts")
      .meta({ title: "Smoothing" }),
    output_width: z
      .number()
      .int()
      .min(144)
      .max(4320)
      .default(1080)
      .describe("Width of the finished video in pixels; the height follows from the shape")
      .meta({ title: "Width" }),
    path: z
      .array(
        z.object({
          time: z.number().min(0).describe("Seconds into the video"),
          x: z.number().min(0).describe("Left edge of the frame, in the video's pixels"),
        }),
      )
      .min(1)
      .optional()
      .describe(
        "Where the frame sits over time, to use instead of working it out. Each run's result has the path it used.",
      )
      .meta({ title: "Camera path" }),
    webhook_url: z.string().url().optional().describe("Webhook URL for async notification"),
    id: z.string().optional().describe("Custom job ID"),
  }),
});
