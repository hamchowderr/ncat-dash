import { forwardSlack } from "@/lib/slack-forward";

/**
 * The address a team's Slack app sends its events, button presses and slash commands to.
 * The agent server usually sits on a private network, so the dashboard passes each
 * request on to it untouched; the agent server checks Slack's signature itself.
 */
export async function POST(request: Request) {
  return forwardSlack(request);
}
