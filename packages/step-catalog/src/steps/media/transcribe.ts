import { z } from "zod";
import { defineStep } from "../../define";

export const mediaTranscribe = defineStep({
  id: "media-transcribe",
  category: "media",
  title: "Transcribe",
  description:
    "Transcribes or translates audio/video using Whisper. Returns text, SRT, and/or segments. Supports direct response or cloud upload.",
  endpoint: "/v1/media/transcribe",
  method: "POST",
  output: "json",
  primaryInput: "media_url",
  input: z.object({
    media_url: z.string().url().describe("URL of the audio or video file to transcribe"),
    task: z
      .enum(["transcribe", "translate"])
      .optional()
      .describe("Task type (default: transcribe)"),
    include_text: z
      .boolean()
      .optional()
      .describe("Include plain text transcription (default: true)"),
    include_srt: z.boolean().optional().describe("Include SRT subtitle format (default: false)"),
    include_segments: z
      .boolean()
      .optional()
      .describe("Include timestamped segments (default: false)"),
    word_timestamps: z
      .boolean()
      .optional()
      .describe("Include word-level timestamps (default: false)"),
    response_type: z
      .enum(["direct", "cloud"])
      .optional()
      .describe("Return data directly or upload to cloud (default: direct)"),
    language: z.string().optional().describe("Language code for transcription"),
    words_per_line: z.number().int().min(1).optional().describe("Words per line in SRT output"),
    webhook_url: z.string().url().optional().describe("Callback URL for async job completion"),
    id: z.string().optional().describe("Custom identifier echoed back in the response"),
  }),
});
