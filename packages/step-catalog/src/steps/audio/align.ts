import { z } from "zod";
import { defineStep } from "../../define";

export const audioAlign = defineStep({
  id: "audio-align",
  category: "audio",
  title: "Line up two recordings",
  description:
    "Finds where a second recording of the same moment, such as a separate mic, sits against the first, such as the camera video: how many seconds apart they started and how far their clocks drift, from the sound alone with plain sound analysis and no AI. Says when the two do not share enough sound to line up.",
  endpoint: "/v1/audio/align",
  method: "POST",
  output: "json",
  primaryInput: "reference_url",
  input: z.object({
    reference_url: z
      .string()
      .url()
      .describe("The recording to line up against, such as the camera video"),
    media_url: z.string().url().describe("The recording to line up, such as the mic's own file"),
    max_seconds: z
      .number()
      .min(10)
      .max(7200)
      .optional()
      .describe("Read at most this many seconds of each (30 minutes when empty)"),
    max_shift: z
      .number()
      .min(1)
      .max(3600)
      .optional()
      .describe("The furthest apart the two may have started, in seconds (10 minutes when empty)"),
    webhook_url: z.string().url().optional().describe("Callback URL for async job completion"),
    id: z.string().optional().describe("Custom identifier echoed back in the response"),
  }),
});
