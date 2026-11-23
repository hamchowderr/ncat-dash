import { z } from "zod";
import { defineStep } from "../../define";

export const mediaDownload = defineStep({
  id: "media-download",
  category: "media",
  title: "Download media",
  description:
    "Downloads media from any yt-dlp supported URL (YouTube, Vimeo, social platforms, etc). Supports format selection, audio extraction, thumbnail and subtitle download.",
  endpoint: "/v1/BETA/media/download",
  method: "POST",
  output: "json",
  primaryInput: "media_url",
  input: z.object({
    media_url: z.string().url().describe("URL of the media to download"),
    cloud_upload: z.boolean().optional().describe("Upload downloaded media to cloud storage"),
    filename: z
      .string()
      .optional()
      .describe(
        "Where in the bucket to put it (a key such as folder/name.mp4); its own name by default",
      ),
    cookie: z.string().optional().describe("Cookie string, path, or URL for authentication"),
    format: z
      .object({
        quality: z.string().optional(),
        format_id: z.string().optional(),
        resolution: z.string().optional(),
        video_codec: z.string().optional(),
        audio_codec: z.string().optional(),
      })
      .optional()
      .describe("Format selection options"),
    audio: z
      .object({
        extract: z.boolean().optional(),
        format: z.string().optional(),
        quality: z.string().optional(),
      })
      .optional()
      .describe("Audio extraction options"),
    thumbnails: z
      .object({
        download: z.boolean().optional(),
        download_all: z.boolean().optional(),
        formats: z.array(z.string()).optional(),
        convert: z.boolean().optional(),
        embed_in_audio: z.boolean().optional(),
      })
      .optional()
      .describe("Thumbnail download options"),
    subtitles: z
      .object({
        download: z.boolean().optional(),
        languages: z.array(z.string()).optional(),
        format: z.enum(["srt", "vtt", "json3"]).optional(),
        cloud_upload: z.boolean().optional(),
      })
      .optional()
      .describe("Subtitle download options"),
    download: z
      .object({
        max_filesize: z.number().int().optional(),
        rate_limit: z.string().optional(),
        retries: z.number().int().optional(),
      })
      .optional()
      .describe("Download behavior options"),
    webhook_url: z.string().url().optional().describe("Callback URL for async job completion"),
    id: z.string().optional().describe("Custom identifier echoed back in the response"),
  }),
});
