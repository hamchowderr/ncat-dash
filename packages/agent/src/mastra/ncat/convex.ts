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

/** The calls the tools make. ConvexHttpClient has them all; a test can stand in for it. */
export type DashClient = Pick<ConvexHttpClient, "query" | "mutation" | "action">;

function realClient(url: string, token: string): DashClient {
  const client = new ConvexHttpClient(url);
  client.setAuth(token);
  return client;
}

let makeClient: (url: string, token: string) => DashClient = realClient;

/** For tests: answer the tools' Convex calls without a deployment. Pass nothing to undo. */
export function useDashClientForTests(make?: (url: string, token: string) => DashClient): void {
  makeClient = make ?? realClient;
}

export function dashFor(userId: string | undefined) {
  const session = sessionOf(userId);
  if (!session) {
    throw new NotConnected(
      "Takewon has not said who is asking yet. Ask the person to send their message again from Takewon.",
    );
  }
  if (!env.CONVEX_URL && makeClient === realClient) {
    throw new NotConnected("CONVEX_URL is not set on the agent server.");
  }
  const client = makeClient(env.CONVEX_URL ?? "", session.convexToken);
  return { client, session };
}

/** A Convex error's own message, without the stack and request id around it. */
export function plainError(caught: unknown): string {
  const data = (caught as { data?: { message?: unknown } })?.data;
  if (data && typeof data.message === "string") return data.message;
  const message = caught instanceof Error ? caught.message : String(caught);
  // A deployed Convex backend hides the reason for anything but its own errors, so the model
  // would only see "Server Error" and retry the same thing.
  if (/\bServer Error\b/.test(message)) {
    return "Takewon could not do that, and gave no reason. Check every value against list_step_types, and change one thing at a time to find the one it refuses.";
  }
  return message.split("\n")[0]?.slice(0, 400) ?? "Something went wrong.";
}
