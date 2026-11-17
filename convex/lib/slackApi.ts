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

export type SlackChannel = { id: string; name: string; private: boolean };

/** The channels the bot can post review alerts to: public ones, and private ones it is in. */
export async function channelsOf(token: string): Promise<SlackChannel[] | null> {
  const found: SlackChannel[] = [];
  let cursor = "";
  for (let page = 0; page < 5; page++) {
    const reply = await call("conversations.list", token, {
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "200",
      ...(cursor ? { cursor } : {}),
    });
    if (!reply?.ok) return page === 0 ? null : found;
    for (const channel of (reply.channels as Record<string, unknown>[] | undefined) ?? []) {
      if (typeof channel.id !== "string" || typeof channel.name !== "string") continue;
      found.push({ id: channel.id, name: channel.name, private: channel.is_private === true });
    }
    const next = (reply.response_metadata as { next_cursor?: string } | undefined)?.next_cursor;
    if (!next) break;
    cursor = next;
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Joins a public channel, so the bot sees the replies people write there. */
export async function joinChannel(token: string, channel: string): Promise<boolean> {
  const reply = await call("conversations.join", token, { channel });
  return reply?.ok === true;
}

/** Posts a message, in a thread when `threadTs` is given. Returns its ts, or null. */
export async function postMessage(
  token: string,
  message: { channel: string; text: string; threadTs?: string },
): Promise<string | null> {
  const reply = await call("chat.postMessage", token, {
    channel: message.channel,
    text: message.text,
    unfurl_links: "false",
    unfurl_media: "false",
    ...(message.threadTs ? { thread_ts: message.threadTs } : {}),
  });
  return reply?.ok && typeof reply.ts === "string" ? reply.ts : null;
}

/** The Slack user with this email address, so a mention can tag them there. */
export async function slackUserByEmail(token: string, email: string): Promise<string | null> {
  const reply = await call("users.lookupByEmail", token, { email });
  const user = reply?.ok ? (reply.user as Record<string, unknown> | undefined) : undefined;
  return typeof user?.id === "string" ? user.id : null;
}

/** A Slack user's name as people see it, for a tag inside a reply. */
export async function nameOf(token: string, slackUserId: string): Promise<string | null> {
  const reply = await call("users.info", token, { user: slackUserId });
  const user = reply?.ok ? (reply.user as Record<string, unknown> | undefined) : undefined;
  const profile = user?.profile as Record<string, unknown> | undefined;
  const name = profile?.display_name || profile?.real_name || user?.real_name || user?.name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/** Escapes text for a Slack message, where &, < and > are markup. */
export function slackEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Slack's markup in a reply, as plain words for the review room: tags become @Name,
 * links their text (or address), channels #name, and Slack's escapes are undone.
 */
export function plainFromSlack(text: string, names: Record<string, string>): string {
  return text
    .replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id: string) => (names[id] ? `@${names[id]}` : ""))
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, (_, name: string) => `#${name}`)
    .replace(/<!(here|channel|everyone)[^>]*>/g, (_, word: string) => `@${word}`)
    .replace(/<((?:https?|mailto):[^|>]+)\|([^>]+)>/g, (_, url: string, label: string) =>
      label === url ? url : `${label} (${url})`,
    )
    .replace(/<((?:https?|mailto):[^>]+)>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** A note only one person sees, in the thread they wrote in. */
export async function postEphemeral(
  token: string,
  message: { channel: string; user: string; text: string; threadTs?: string },
): Promise<boolean> {
  const reply = await call("chat.postEphemeral", token, {
    channel: message.channel,
    user: message.user,
    text: message.text,
    ...(message.threadTs ? { thread_ts: message.threadTs } : {}),
  });
  return reply?.ok === true;
}
