import { z } from "zod";
import { defineStep } from "../../define";

export const storageUploadGcp = defineStep({
  id: "storage-upload-gcp",
  category: "storage",
  title: "Upload to Google Cloud Storage",
  description: "Uploads a file from a URL to Google Cloud Storage.",
  endpoint: "/v1/gcp/upload",
  method: "POST",
  output: "file",
  primaryInput: "file_url",
  input: z.object({
    file_url: z.string().url().describe("URL of the file to upload to GCS"),
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
