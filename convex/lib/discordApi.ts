// The few Discord calls the dashboard makes as its bot: direct messages for alerts, and
// editing them once an approval is decided. DISCORD_BOT_TOKEN is the same bot the agent
// server runs; DISCORD_API_URL points these at a stand-in Discord in tests.

function discordApi(): string {
  return (process.env.DISCORD_API_URL ?? "https://discord.com/api/v10").replace(/\/+$/, "");
}

/** Whether the dashboard can send as its Discord bot. */
export function discordBotReady(): boolean {
  return Boolean(process.env.DISCORD_BOT_TOKEN);
}

async function call(
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
): Promise<Record<string, unknown> | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;
  try {
    const response = await fetch(`${discordApi()}${path}`, {
      method,
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** A Discord message the bot sent, as Discord names it. */
export type DiscordMessageRef = { channel: string; message: string };

/** A message body as Discord takes it: words, and rows of buttons. */
export type DiscordMessage = { content: string; components: unknown[] };

/** Sends a direct message to a Discord user. Returns where it went, or null. */
export async function sendDirect(
  discordUserId: string,
  message: DiscordMessage,
): Promise<DiscordMessageRef | null> {
  const dm = await call("POST", "/users/@me/channels", { recipient_id: discordUserId });
  const channel = typeof dm?.id === "string" ? dm.id : null;
  if (!channel) return null;
  const sent = await call("POST", `/channels/${channel}/messages`, {
    ...message,
    allowed_mentions: { parse: [] },
  });
  return typeof sent?.id === "string" ? { channel, message: sent.id } : null;
}

/** Rewrites a message the bot sent, such as taking its buttons away once decided. */
export async function editMessage(
  ref: DiscordMessageRef,
  message: DiscordMessage,
): Promise<boolean> {
  const edited = await call("PATCH", `/channels/${ref.channel}/messages/${ref.message}`, message);
  return edited !== null;
}
