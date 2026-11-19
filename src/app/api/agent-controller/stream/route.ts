import { api } from "@convex/_generated/api";

import { readAgentContext } from "@/lib/agent-session";
import { fetchAuthQuery } from "@/lib/auth-server";
import { forward } from "@/lib/mastra-proxy";
import { TRIAL_ENDED_REPLY } from "@/lib/trial";

/**
 * Whether the team on screen is out of its free trial. Every reply costs AI tokens, so a
 * team whose trial is over gets a plain answer instead of the agent. Any doubt (nobody
 * signed in, no team yet, Convex not answering) is left to the agent server, which checks
 * the person itself.
 */
async function trialOver(req: Request): Promise<boolean> {
  const { organizationId } = readAgentContext(req.headers.get("cookie"));
  if (!organizationId) return false;
  try {
    const trial = await fetchAuthQuery(api.trial.status, { organizationId });
    return trial.kind === "ended";
  } catch {
    return false;
  }
}

// Same-origin proxy → standalone Mastra server's Agent Controller SSE route.
// Streams the AgentControllerEvent SSE straight back to the browser. No Mastra import
// here, so nothing heavy enters the Next webpack graph.
export async function POST(req: Request) {
  if (await trialOver(req)) {
    return Response.json({ error: TRIAL_ENDED_REPLY }, { status: 402 });
  }
  return forward(req, "/agent-controller/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await req.text(),
    // Forward client disconnects so the controller run can abort upstream.
    stream: true,
  });
}
