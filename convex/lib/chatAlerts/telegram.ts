import type { ChatAlert, ChatSender, ChatTarget, SentMessage } from "./index";

/**
 * Alerts in Telegram: each linked member gets them in their own chat with the
 * dashboard's bot, straight from Telegram's Bot API. Approvals carry Approve and Send
 * back buttons; a press reaches the bot on the agent server, which asks the dashboard
 * to decide (`telegram.decide`). Once decided, the message is changed to say so.
 */

/** What a press of Approve or Send back sends back, as "ncat_approve:<runStepId>". */
export const APPROVE_PREFIX = "ncat_approve:";
export const SEND_BACK_PREFIX = "ncat_send_back:";

/** Whether this dashboard has a Telegram bot set up. */
export function telegramReady(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && botUsername());
}

/** The bot's @name, without the @. */
export function botUsername(): string | null {
  const name = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  return name || null;
}

function botApi(method: string): string {
  const base = (process.env.TELEGRAM_API_URL ?? "https://api.telegram.org").replace(/\/+$/, "");
  return `${base}/bot${process.env.TELEGRAM_BOT_TOKEN?.trim() ?? ""}/${method}`;
}

type Button = { text: string; url?: string; callback_data?: string };

/**
 * The buttons under an alert: Approve and Send back for an approval, then a link to the
 * page. Telegram only takes web addresses it can open, so a local address goes in the
 * text instead.
 */
export function keyboardFor(
  alert: Pick<ChatAlert, "actions" | "runStepId" | "link" | "linkLabel">,
  withActions = true,
) {
  const rows: Button[][] = [];
  if (withActions && alert.actions?.length && alert.runStepId) {
    rows.push(
      alert.actions.map((action) => ({
        text: action.label,
        callback_data: `${action.id === "approve" ? APPROVE_PREFIX : SEND_BACK_PREFIX}${alert.runStepId}`,
      })),
    );
  }
  if (linkable(alert.link)) rows.push([{ text: alert.linkLabel, url: alert.link }]);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

export function linkable(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname !== "localhost";
  } catch {
    return false;
  }
}

/** An alert as Telegram text: the title, its lines, and the link when it is not a button. */
export function textFor(alert: ChatAlert): string {
  const lines = [alert.title, ...alert.lines.filter((line) => line.trim() !== "")];
  if (!linkable(alert.link) && alert.link) lines.push(`${alert.linkLabel}: ${alert.link}`);
  return lines.join("\n\n").slice(0, 4000);
}

export async function call(method: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(botApi(method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const answer = (await response.json().catch(() => null)) as {
    ok?: boolean;
    result?: unknown;
    description?: string;
  } | null;
  if (!response.ok || !answer?.ok) {
    throw new Error(`Telegram ${method}: ${answer?.description ?? response.status}`);
  }
  return answer.result;
}

/**
 * Whether the bot can see a message that tags it in this group. Telegram starts every bot
 * in privacy mode, which in groups only passes on commands and replies to the bot, so a
 * plain "@bot do this" never reaches it. The bot hears everything once privacy mode is
 * off in BotFather (it takes effect in groups it joins after that), or when it is an
 * admin of the group. `privacyOff` is the bot's setting now; `wasOff` is what it was
 * when the bot joined this group, when known. Null when Telegram can't be asked.
 */
export async function botHearsGroup(
  chatId: string,
  wasOff?: boolean,
): Promise<{ hears: boolean; privacyOff: boolean } | null> {
  try {
    const me = (await call("getMe", {})) as { id: number; can_read_all_group_messages?: boolean };
    const privacyOff = me.can_read_all_group_messages === true;
    // The setting a group was joined under stays with it until the bot is added again.
    if (wasOff ?? privacyOff) return { hears: true, privacyOff };
    const member = (await call("getChatMember", { chat_id: chatId, user_id: me.id }).catch(
      () => null,
    )) as { status?: string } | null;
    const admin = member?.status === "administrator" || member?.status === "creator";
    return { hears: admin, privacyOff };
  } catch {
    return null;
  }
}

/** "chat id:message id" */
function splitRef(ref: string): { chatId: string; messageId: number } | null {
  const at = ref.lastIndexOf(":");
  const messageId = Number(ref.slice(at + 1));
  if (at <= 0 || !Number.isInteger(messageId)) return null;
  return { chatId: ref.slice(0, at), messageId };
}

/** What `send` kept about a message. */
function readKept(stored: string): { text: string; link: Button | null } {
  try {
    const parsed = JSON.parse(stored) as { text?: unknown; link?: Button | null };
    if (typeof parsed.text === "string") return { text: parsed.text, link: parsed.link ?? null };
  } catch {
    // Kept as plain text.
  }
  return { text: stored, link: null };
}

export const telegramSender: ChatSender = {
  app: "telegram",
  async isLinked(ctx, organizationId, userId) {
    const row = await ctx.db
      .query("telegramPeople")
      .withIndex("by_member", (q) => q.eq("organizationId", organizationId).eq("userId", userId))
      .unique();
    return row !== null;
  },
  async targets(ctx, organizationId, userIds) {
    if (!telegramReady()) return [];
    const targets: ChatTarget[] = [];
    for (const userId of userIds) {
      const row = await ctx.db
        .query("telegramPeople")
        .withIndex("by_member", (q) => q.eq("organizationId", organizationId).eq("userId", userId))
        .unique();
      if (row) targets.push({ userId, address: row.chatId });
    }
    return targets;
  },
  async send(_ctx, alert, target): Promise<SentMessage | null> {
    const text = textFor(alert);
    const keyboard = keyboardFor(alert);
    const result = (await call("sendMessage", {
      chat_id: target.address,
      text,
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: keyboard } : {}),
    })) as { message_id?: number } | null;
    if (!result?.message_id) return null;
    // Kept with the link button, which stays when the decision buttons go.
    const link = keyboard?.inline_keyboard.find((row) => row[0]?.url)?.[0] ?? null;
    return {
      ref: `${target.address}:${result.message_id}`,
      text: JSON.stringify({ text, link }),
    };
  },
  async settle(_ctx, message, outcome) {
    const where = splitRef(message.ref);
    if (!where) return;
    const kept = readKept(message.text);
    await call("editMessageText", {
      chat_id: where.chatId,
      message_id: where.messageId,
      text: `${kept.text}\n\n${outcome}`.slice(0, 4096),
      link_preview_options: { is_disabled: true },
      // Without reply_markup, Telegram takes the buttons off.
      ...(kept.link ? { reply_markup: { inline_keyboard: [[kept.link]] } } : {}),
    });
  },
};
