// What the browser tests and e2e/slack-stand-in.mjs agree on. Keep the two in step.
export const SLACK_API = "http://127.0.0.1:8768/api/";
export const TOKEN_PREFIX = "xoxb-stand-in-";
export const BOT_USER = "U0AGENTBOT";

/** The workspace a stand-in token belongs to. */
export function teamOfToken(token: string): string {
  return `T${token
    .slice(TOKEN_PREFIX.length)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")}`;
}
