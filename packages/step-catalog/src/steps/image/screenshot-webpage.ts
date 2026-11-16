import { z } from "zod";
import { defineStep } from "../../define";

export const imageScreenshotWebpage = defineStep({
  id: "image-screenshot-webpage",
  category: "image",
  title: "Screenshot webpage",
  description:
    "Captures a screenshot of a webpage or renders custom HTML to an image using Playwright. Supports full-page, element selector, viewport config, dark mode, JS/CSS injection.",
  endpoint: "/v1/image/screenshot/webpage",
  method: "POST",
  output: "file",
  primaryInput: null,
  input: z.object({
    url: z.string().url().optional().describe("URL of the webpage to screenshot"),
    html: z.string().optional().describe("Custom HTML to render to image"),
    viewport_width: z.number().int().min(1).optional(),
    viewport_height: z.number().int().min(1).optional(),
    full_page: z.boolean().optional().describe("Capture full scrollable page (default: false)"),
    format: z.enum(["png", "jpeg"]).optional().describe("Image format (default: png)"),
    delay: z.number().int().min(0).optional().describe("Milliseconds to wait before screenshot"),
    device_scale_factor: z.number().min(0.1).optional(),
    user_agent: z.string().optional(),
    cookies: z
      .array(
        z.object({
          name: z.string(),
          value: z.string(),
          domain: z.string(),
          path: z.string().optional(),
        }),
      )
      .optional(),
    headers: z.record(z.string(), z.string()).optional(),
    quality: z.number().int().min(0).max(100).optional().describe("JPEG quality (0-100)"),
    clip: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      })
      .optional(),
    timeout: z.number().int().min(100).optional().describe("Timeout in milliseconds"),
    wait_until: z.enum(["load", "domcontentloaded", "networkidle", "networkidle2"]).optional(),
    wait_for_selector: z.string().optional(),
    emulate: z.object({ color_scheme: z.enum(["light", "dark"]).optional() }).optional(),
    omit_background: z.boolean().optional(),
    selector: z.string().optional().describe("CSS selector to screenshot specific element"),
    js: z.string().optional().describe("JavaScript to inject before screenshot"),
    css: z.string().optional().describe("CSS to inject before screenshot"),
    webhook_url: z.string().url().optional(),
    id: z.string().optional(),
  }),
});
