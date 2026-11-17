// A small client for toSend (https://tosend.com), the service that delivers this app's
// email. It uses fetch only, so it runs in Convex's default runtime. The API is described
// at https://tosend.com/docs/api/introduction/.

export const TOSEND_API = "https://api.tosend.com";

export type Sender = { email: string; name?: string };

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type SendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; status: number; reason: SendFailure; detail: string };

export type SendFailure =
  "unauthorized" | "billing" | "domain" | "refused" | "busy" | "unreachable";

export type KeyCheck =
  | { ok: true; domains: { name: string; verified: boolean }[] }
  | { ok: false; reason: "unauthorized" | "unreachable"; detail: string };

type Options = { fetch?: typeof fetch; signal?: AbortSignal; baseUrl?: string };

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

async function readMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message) return body.message.slice(0, 300);
  } catch {
    // Not JSON; the status says enough.
  }
  return `HTTP ${response.status}`;
}

/** Sends one email. Never throws: the outcome says what happened. */
export async function sendEmail(
  apiKey: string,
  from: Sender,
  message: EmailMessage,
  options: Options = {},
): Promise<SendResult> {
  const doFetch = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${options.baseUrl ?? TOSEND_API}/v2/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: from.name ? { email: from.email, name: from.name } : { email: from.email },
        to: [{ email: message.to }],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: options.signal,
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      reason: "unreachable",
      detail: error instanceof Error ? error.message : "No answer",
    };
  }
  if (response.ok) {
    let messageId: string | null = null;
    try {
      const body = (await response.json()) as { message_id?: unknown };
      if (typeof body.message_id === "string") messageId = body.message_id;
    } catch {
      // Accepted without a readable body.
    }
    return { ok: true, messageId };
  }
  const detail = await readMessage(response);
  return { ok: false, status: response.status, reason: reasonFor(response.status, detail), detail };
}

/** Checks an API key without sending anything, and lists the account's sending domains. */
export async function checkKey(apiKey: string, options: Options = {}): Promise<KeyCheck> {
  const doFetch = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${options.baseUrl ?? TOSEND_API}/v2/info`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: options.signal,
    });
  } catch (error) {
    return {
      ok: false,
      reason: "unreachable",
      detail: error instanceof Error ? error.message : "No answer",
    };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: "unauthorized", detail: await readMessage(response) };
  }
  if (!response.ok) {
    return { ok: false, reason: "unreachable", detail: await readMessage(response) };
  }
  try {
    const body = (await response.json()) as {
      domains?: { domain_name?: unknown; verification_status?: unknown }[];
    };
    const domains = (Array.isArray(body.domains) ? body.domains : [])
      .filter((domain) => typeof domain.domain_name === "string")
      .map((domain) => ({
        name: String(domain.domain_name).toLowerCase(),
        verified: domain.verification_status === "verified",
      }));
    return { ok: true, domains };
  } catch {
    return { ok: false, reason: "unreachable", detail: "toSend sent an answer that was not JSON." };
  }
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
