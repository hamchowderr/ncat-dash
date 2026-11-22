/**
 * Headers every page and route answers with (next.config.ts).
 *
 * - No other site may show the dashboard in a frame, so a page can't be laid over it to
 *   trick someone into pressing Approve or Delete.
 * - Browsers keep to https once they have been here, never guess a file's type, and send
 *   only the site's address (never the path, which can hold a share link's token) to
 *   other sites.
 * - Pages may use the microphone (speaking to the agent) and nothing else of the device.
 */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
  },
];
