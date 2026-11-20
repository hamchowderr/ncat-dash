const SERVER_URL = process.env.MASTRA_SERVER_URL ?? "http://localhost:4111";
const CONVEX_SITE_URL = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";

/** Where the agent server takes Slack requests (Mastra's route for the chat controller). */
export const SLACK_WEBHOOK_PATH =
  "/api/agent-controllers/chat-agent-controller/channels/slack/webhook";

/** The headers Slack's signature check and the body parsing need, and nothing else. */
const PASSED = [
  "content-type",
  "x-slack-signature",
  "x-slack-request-timestamp",
  "x-slack-retry-num",
  "x-slack-retry-reason",
];

/** The challenge in Slack's address check, or null for anything else. */
export function urlCheckChallenge(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { type?: unknown; challenge?: unknown };
    return parsed.type === "url_verification" && typeof parsed.challenge === "string"
      ? parsed.challenge
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether a Slack event is someone's reply inside a thread: what the dashboard brings
 * into a review when the thread is one of its review threads.
 */
export function isThreadReply(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as {
      type?: string;
      event?: { type?: string; subtype?: string; bot_id?: string; ts?: string; thread_ts?: string };
    };
    const event = parsed.event;
    return (
      parsed.type === "event_callback" &&
      event?.type === "message" &&
      !event.subtype &&
      !event.bot_id &&
      typeof event.thread_ts === "string" &&
      event.thread_ts !== event.ts
    );
  } catch {
    return false;
  }
}

/** Our alert buttons' action ids start with this; the agent's own buttons do not. */
const ALERT_ACTION_PREFIX = "ncat_alert_";

/**
 * Whether a Slack request is a press of an alert button (Approve, Send back) on a
 * message the dashboard sent. Slack sends button presses form-encoded, as `payload`.
 */
export function isAlertAction(body: string): boolean {
  try {
    const payload = new URLSearchParams(body).get("payload");
    if (!payload) return false;
    const parsed = JSON.parse(payload) as { type?: string; actions?: { action_id?: unknown }[] };
    return (
      parsed.type === "block_actions" &&
      (parsed.actions ?? []).some(
        (action) =>
          typeof action.action_id === "string" && action.action_id.startsWith(ALERT_ACTION_PREFIX),
      )
    );
  } catch {
    return false;
  }
}

/**
 * Passes a Slack request on to the agent server, and a reply in a thread also to the
 * dashboard's backend, which writes it into the review that thread belongs to. Slack is
 * answered with what the agent server says.
 */
export async function forwardSlack(
  request: Request,
  serverUrl = SERVER_URL,
  convexSiteUrl = CONVEX_SITE_URL,
): Promise<Response> {
  const body = await request.text();
  // Slack's one-time address check carries no data and gives up after 3 seconds, which a
  // trip to an idle agent server can take. It is answered here, at once, with the
  // challenge Slack sent; the agent server would answer the same.
  const challenge = urlCheckChallenge(body);
  if (challenge !== null) return Response.json({ challenge });
  const headers = new Headers();
  for (const name of PASSED) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // An Approve or Send back press on an alert is the dashboard's, not the agent's.
  if (isAlertAction(body)) {
    if (!convexSiteUrl) return new Response("The dashboard is not set up.", { status: 503 });
    try {
      const answer = await fetch(`${convexSiteUrl.replace(/\/$/, "")}/slack/actions`, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(2_500),
      });
      return new Response(null, { status: answer.status });
    } catch {
      return new Response("The dashboard is not reachable.", { status: 503 });
    }
  }
  const toReview =
    convexSiteUrl && isThreadReply(body)
      ? fetch(`${convexSiteUrl.replace(/\/$/, "")}/slack/events`, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(10_000),
        }).catch(() => null)
      : Promise.resolve(null);
  const toAgent = (async () => {
    try {
      const answer = await fetch(`${serverUrl}${SLACK_WEBHOOK_PATH}`, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      return new Response(await answer.text(), {
        status: answer.status,
        headers: { "content-type": answer.headers.get("content-type") ?? "text/plain" },
      });
    } catch {
      // Slack tries again when it gets no answer, so say plainly that we are not there.
      return new Response("The agent server is not reachable.", { status: 503 });
    }
  })();
  const [answer] = await Promise.all([toAgent, toReview]);
  return answer;
}
