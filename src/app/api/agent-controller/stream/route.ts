import { api } from "@convex/_generated/api";

import { readAgentContext } from "@/lib/agent-session";
import { fetchAuthMutation } from "@/lib/auth-server";
import { forward } from "@/lib/mastra-proxy";
import { TRIAL_ENDED_REPLY } from "@/lib/trial";

const STATUS = { trial_ended: 402, team_blocked: 403, user_blocked: 403, rate_limited: 429 };

/**
 * Asked before each message goes to the agent, since every reply costs AI tokens: a team
 * whose trial is over, a blocked team or person, and someone sending a great many
 * messages in a short time get a plain answer instead. Any doubt (nobody signed in, no
 * team yet, Convex not answering) is left to the agent server, which checks the person
 * itself.
 */
async function refusal(req: Request): Promise<Response | null> {
  const { organizationId } = readAgentContext(req.headers.get("cookie"));
  if (!organizationId) return null;
  try {
    const turn = await fetchAuthMutation(api.access.agentTurn, { organizationId });
    if (turn.ok) return null;
    const error = turn.reason === "trial_ended" ? TRIAL_ENDED_REPLY : turn.message;
    return Response.json({ error }, { status: STATUS[turn.reason] });
  } catch {
    return null;
  }
}

// Same-origin proxy → standalone Mastra server's Agent Controller SSE route.
// Streams the AgentControllerEvent SSE straight back to the browser. No Mastra import
// here, so nothing heavy enters the Next webpack graph.
export async function POST(req: Request) {
  const refused = await refusal(req);
  if (refused) return refused;
  return forward(req, "/agent-controller/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await req.text(),
    // Forward client disconnects so the controller run can abort upstream.
    stream: true,
  });
}
