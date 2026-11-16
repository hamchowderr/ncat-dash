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
    bucket_name: z.string().optional().describe("Target S3 bucket name"),
    file_name: z.string().optional().describe("Custom filename for the uploaded file"),
    webhook_url: z.string().url().optional(),
    id: z.string().optional(),
  }),
});
