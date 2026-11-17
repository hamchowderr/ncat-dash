const SERVER_URL = process.env.MASTRA_SERVER_URL ?? "http://localhost:4111";

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

export async function forwardSlack(request: Request, serverUrl = SERVER_URL): Promise<Response> {
  const body = await request.text();
  const headers = new Headers();
  for (const name of PASSED) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
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
}
