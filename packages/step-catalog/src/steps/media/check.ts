import { z } from "zod";
import { defineStep } from "../../define";

/**
 * The toolkit's footage check (FFmpeg only). Not a step people add: Check Footage sends it
 * for each file before editing and decides by plain rules what counts as a problem.
 */
export const mediaCheck = defineStep({
  id: "media-check",
  category: "media",
  title: "Check footage",
  description:
    "Measures a video before editing, with no AI: its shape as it plays, frame rate, length, how loud its sound is and whether it clips, and where its picture is black or frozen.",
  endpoint: "/v1/media/check",
  method: "POST",
  output: "json",
  primaryInput: "media_url",
  input: z.object({
    media_url: z.string().url().describe("URL of the video to check"),
    max_seconds: z.number().min(1).max(7200).optional().describe("Read at most this many seconds"),
    webhook_url: z.string().url().optional().describe("Callback URL for async job completion"),
    id: z.string().optional().describe("Custom identifier echoed back in the response"),
  }),
});
