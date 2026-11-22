// The Send to a URL step: posts the files that reach it, with the run's details, to an
// address such as an n8n webhook. The post itself is made by the backend (convex/send.ts).

/** The longest address kept. */
export const MAX_SEND_URL = 2000;

/** What is wrong with a Send to a URL step's settings, or null. */
export function sendProblem(input: Record<string, unknown>): string | null {
  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!url) return "Say which address to send to.";
  if (url.length > MAX_SEND_URL) return "This address is too long.";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "This is not an address. It starts with https://.";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "The address must start with http:// or https://.";
  }
  return null;
}

/** The address a Send to a URL step posts to, for its box on the canvas. */
export function sendSentence(input: Record<string, unknown>): string {
  if (sendProblem(input)) return "Needs an address";
  try {
    return `To ${new URL(String(input.url).trim()).host}`;
  } catch {
    return "Needs an address";
  }
}
