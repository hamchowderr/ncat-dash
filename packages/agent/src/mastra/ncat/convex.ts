import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { env } from "../../lib/env";
import { sessionOf } from "./session-store";

/**
 * The dashboard's own Convex functions, called as the signed-in person. The agent has no
 * access of its own: every call carries that person's token, so Convex applies the same
 * team checks it applies to their browser.
 */
export const dash = anyApi;

export class NotConnected extends Error {}

export function dashFor(userId: string | undefined) {
  const session = sessionOf(userId);
  if (!session) {
    throw new NotConnected(
      "The dashboard has not said who is asking yet. Ask the person to send their message again from the dashboard.",
    );
  }
  if (!env.CONVEX_URL) {
    throw new NotConnected("CONVEX_URL is not set on the agent server.");
  }
  const client = new ConvexHttpClient(env.CONVEX_URL);
  client.setAuth(session.convexToken);
  return { client, session };
}

/** A Convex error's own message, without the stack and request id around it. */
export function plainError(caught: unknown): string {
  const data = (caught as { data?: { message?: unknown } })?.data;
  if (data && typeof data.message === "string") return data.message;
  const message = caught instanceof Error ? caught.message : String(caught);
  return message.split("\n")[0]?.slice(0, 400) ?? "Something went wrong.";
}
