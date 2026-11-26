// Sends this app's email through toSend (https://tosend.com) with its official SDK
// (npm "tosend", https://github.com/tosend/tosend-node). The SDK uses fetch only, so it
// runs in Convex's default runtime. This file turns its answers and errors into plain
// outcomes that never throw. API docs: https://tosend.com/docs/api/introduction/.

import { ToSend, ToSendError } from "tosend";

export const TOSEND_API = "https://api.tosend.com";

export type Sender = { email: string; name?: string };

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, such as List-Unsubscribe. */
  headers?: Record<string, string>;
  /** Where replies go, such as a support inbox. */
  replyTo?: string;
};

export type SendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; status: number; reason: SendFailure; detail: string };

export type SendFailure =
  "unauthorized" | "billing" | "domain" | "refused" | "busy" | "unreachable";

export type KeyCheck =
  | { ok: true; domains: { name: string; verified: boolean }[] }
  | { ok: false; reason: "unauthorized" | "unreachable"; detail: string };

type Options = { timeoutMs?: number; baseUrl?: string };

function clientFor(apiKey: string, options: Options): ToSend {
  return new ToSend({
    apiKey,
    baseUrl: options.baseUrl ?? TOSEND_API,
    timeout: options.timeoutMs ?? 30_000,
  });
}

/** The HTTP status and message of a failed SDK call; status 0 when nothing answered. */
function failureOf(error: unknown): { status: number; message: string } {
  if (error instanceof ToSendError) {
    const message = (error.message || "No answer").slice(0, 300);
    // The SDK reports a timeout as 408; nothing usable came back.
    return { status: error.code === 408 ? 0 : error.code, message };
  }
  return { status: 0, message: error instanceof Error ? error.message : "No answer" };
}

/** The part of an address after the @, in lower case. Empty when there is none. */
export function domainOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at < 0
    ? ""
    : address
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

/** Whether this looks like one plain email address. */
export function isEmailAddress(value: string): boolean {
  return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(value);
}

function reasonFor(status: number, message: string): SendFailure {
  if (status === 401) return "unauthorized";
  if (status === 402) return "billing";
  if (status === 403) return /credit/i.test(message) ? "billing" : "refused";
  if (status === 429 || status >= 500) return "busy";
  if (status === 422 && /domain/i.test(message)) return "domain";
  return "refused";
}

/** What to tell a person about a failed send, in plain words. */
export function failureText(reason: SendFailure, detail: string): string {
  switch (reason) {
    case "unauthorized":
      return "toSend did not accept the API key.";
    case "billing":
      return `toSend would not send: ${detail}`;
    case "domain":
      return `toSend would not send from this address: ${detail}`;
    case "busy":
      return "toSend is busy or having trouble. Try again in a minute.";
    case "unreachable":
      return "toSend could not be reached.";
    default:
      return `toSend refused the email: ${detail}`;
  }
}

/** Sends one email. Never throws: the outcome says what happened. */
export async function sendEmail(
  apiKey: string,
  from: Sender,
  message: EmailMessage,
  options: Options = {},
): Promise<SendResult> {
  try {
    const answer = await clientFor(apiKey, options).send({
      from: from.name ? { email: from.email, name: from.name } : { email: from.email },
      to: [{ email: message.to }],
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.headers ? { headers: message.headers } : {}),
      ...(message.replyTo ? { reply_to: { email: message.replyTo } } : {}),
    });
    return {
      ok: true,
      messageId: typeof answer?.message_id === "string" ? answer.message_id : null,
    };
  } catch (error) {
    const { status, message: detail } = failureOf(error);
    if (status === 0) return { ok: false, status: 0, reason: "unreachable", detail };
    return { ok: false, status, reason: reasonFor(status, detail), detail };
  }
}

/** Checks an API key without sending anything, and lists the account's sending domains. */
export async function checkKey(apiKey: string, options: Options = {}): Promise<KeyCheck> {
  let info: Awaited<ReturnType<ToSend["getAccountInfo"]>>;
  try {
    info = await clientFor(apiKey, options).getAccountInfo();
  } catch (error) {
    const { status, message } = failureOf(error);
    const reason = status === 401 || status === 403 ? "unauthorized" : "unreachable";
    return { ok: false, reason, detail: message };
  }
  const domains = (Array.isArray(info?.domains) ? info.domains : [])
    .filter((domain) => typeof domain.domain_name === "string")
    .map((domain) => ({
      name: String(domain.domain_name).toLowerCase(),
      verified: domain.verification_status === "verified",
    }));
  return { ok: true, domains };
}

/**
 * Why an address cannot be used to send from with this account, or null when it can.
 * toSend only sends from domains that have been verified in the account.
 */
export function senderProblem(
  address: string,
  domains: { name: string; verified: boolean }[],
): string | null {
  if (!isEmailAddress(address)) return "Enter one email address, such as alerts@yourdomain.com.";
  const domain = domainOf(address);
  const found = domains.find((candidate) => candidate.name === domain);
  if (!found) {
    return `${domain} is not a sending domain in this toSend account. Add it in toSend first.`;
  }
  if (!found.verified) {
    return `${domain} is not verified in toSend yet. Finish its DNS records there, then try again.`;
  }
  return null;
}
