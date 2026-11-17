import { getToken } from "@/lib/auth-server";
import { signServerToken } from "@/lib/mastra-proxy";

/** The cookie the browser keeps up to date with the team and automation on screen. */
export const AGENT_CONTEXT_COOKIE = "ncat_agent_context";

export type AgentContext = { organizationId: string | null; automationId: string | null };

const SERVER_URL = process.env.MASTRA_SERVER_URL ?? "http://localhost:4111";
/** How long a hand-over is trusted before it is sent again. The agent keeps it far longer. */
const FRESH_MS = 60_000;

// Kept on globalThis for the same reason as the proxy's own settings: route handlers
// and instrumentation.ts are bundled apart.
const KEY = Symbol.for("ncat-dash.agent-session");
type Holder = { [KEY]?: Map<string, { sent: string; at: number }> };
function sentSessions() {
  const holder = globalThis as Holder;
  return (holder[KEY] ??= new Map());
}

/** The `sub` of a JWT, without checking it: Convex checks the token on every call. */
function subjectOf(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export function readAgentContext(cookieHeader: string | null): AgentContext {
  const empty = { organizationId: null, automationId: null };
  const raw = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AGENT_CONTEXT_COOKIE}=`));
  if (!raw) return empty;
  try {
    const value = JSON.parse(decodeURIComponent(raw.slice(AGENT_CONTEXT_COOKIE.length + 1)));
    const text = (field: unknown) =>
      typeof field === "string" && field.length > 0 && field.length <= 200 ? field : null;
    return { organizationId: text(value.organizationId), automationId: text(value.automationId) };
  } catch {
    return empty;
  }
}

/**
 * Who a chat request is for, or null when nobody is signed in.
 *
 * Before answering, it hands the agent server what it needs to act for this person: their
 * own Convex token, and the team and automation they have on screen. The agent then calls
 * the same Convex functions the dashboard does, as them, so it can see and change exactly
 * what they can and nothing more. Without MASTRA_JWT_SECRET there is no safe way to do
 * that hand-over, so the chat stays signed out.
 */
export async function agentUserFor(request: Request): Promise<string | null> {
  const secret = process.env.MASTRA_JWT_SECRET;
  if (!secret) return null;
  const token = await getToken().catch(() => undefined);
  const userId = token ? subjectOf(token) : null;
  if (!token || !userId) return null;

  const context = readAgentContext(request.headers.get("cookie"));
  const sending = JSON.stringify([token, context]);
  const last = sentSessions().get(userId);
  if (last?.sent === sending && Date.now() - last.at < FRESH_MS) return userId;

  try {
    const response = await fetch(`${SERVER_URL}/ncat/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${signServerToken(secret, userId)}`,
      },
      body: JSON.stringify({ convexToken: token, ...context }),
    });
    if (response.ok) sentSessions().set(userId, { sent: sending, at: Date.now() });
  } catch {
    // The agent server is down: the chat request itself will say so.
  }
  return userId;
}
