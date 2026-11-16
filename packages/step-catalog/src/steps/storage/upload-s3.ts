import { z } from "zod";
import { defineStep } from "../../define";

export const storageUploadS3 = defineStep({
  id: "storage-upload-s3",
  category: "storage",
  title: "Upload to S3",
  description:
    "Uploads a file from a URL to Amazon S3 or any S3-compatible storage (DigitalOcean Spaces, Supabase Storage, MinIO) by streaming.",
  endpoint: "/v1/s3/upload",
  method: "POST",
  output: "file",
  primaryInput: "file_url",
  input: z.object({
    file_url: z.string().url().describe("URL of the file to upload to S3"),
    filename: z.string().optional().describe("Name to give the uploaded file"),
    public: z.boolean().optional().describe("Make the uploaded file readable by anyone"),
    download_headers: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Headers to send when fetching the file, for a source that needs sign-in"),
    webhook_url: z.string().url().optional(),
    id: z.string().optional(),
  }),
});
