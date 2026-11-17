// The few Slack Web API calls the dashboard makes itself. SLACK_API_URL points them at a
// stand-in Slack in tests and local runs.

export function slackApiBase(): string {
  const base = process.env.SLACK_API_URL || "https://slack.com/api/";
  return base.endsWith("/") ? base : `${base}/`;
}

type SlackReply = { ok: boolean; error?: string; [key: string]: unknown };

async function call(
  method: string,
  token: string,
  params: Record<string, string>,
): Promise<SlackReply | null> {
  try {
    const response = await fetch(`${slackApiBase()}${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as SlackReply;
  } catch {
    return null;
  }
}

export type SlackIdentity = { teamId: string; teamName: string; botUserId: string };

/** Who a bot token belongs to, or why Slack refused it. */
export async function whoAmI(
  token: string,
): Promise<
  { ok: true; identity: SlackIdentity } | { ok: false; reason: "refused" | "unreachable" }
> {
  const reply = await call("auth.test", token, {});
  if (!reply) return { ok: false, reason: "unreachable" };
  const teamId = typeof reply.team_id === "string" ? reply.team_id : "";
  const botUserId = typeof reply.user_id === "string" ? reply.user_id : "";
  if (!reply.ok || !teamId || !botUserId) return { ok: false, reason: "refused" };
  return {
    ok: true,
    identity: { teamId, teamName: typeof reply.team === "string" ? reply.team : teamId, botUserId },
  };
}

/** A Slack user's email address, when the app may read it and they are a real person. */
export async function emailOf(token: string, slackUserId: string): Promise<string | null> {
  const reply = await call("users.info", token, { user: slackUserId });
  const user = reply?.ok ? (reply.user as Record<string, unknown> | undefined) : undefined;
  if (!user || user.is_bot || user.deleted) return null;
  const email = (user.profile as Record<string, unknown> | undefined)?.email;
  return typeof email === "string" && email.includes("@") ? email.trim().toLowerCase() : null;
}

/** The text of a Slack token or secret as people paste it: trimmed, nothing else. */
export function cleanPasted(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}
