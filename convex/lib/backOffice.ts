// The business's Back Office: a WordPress store running FluentCRM (and Fluent Support) that
// keeps the dashboard's customers as contacts. The dashboard tells it, through FluentCRM's
// incoming webhook, who signed up, whose team is on a free trial and whose team has bought.
// Off unless BACK_OFFICE_WEBHOOK_URL is set.

/** What happened to a person, as the Back Office hears it. */
export type BackOfficeEvent = "signedUp" | "trialStarted" | "paid";

/** The tag names FluentCRM keeps, by name, the same ones the AnyPress SDK uses for Stripe. */
export const BACK_OFFICE_TAGS = { trial: "Trial", customer: "Customer" } as const;

/** One contact update in the shape FluentCRM's incoming webhook takes. */
export interface ContactUpdate {
  email: string;
  first_name?: string;
  last_name?: string;
  tags?: string[];
  detach_tags?: string[];
}

/**
 * The webhook address from BACK_OFFICE_WEBHOOK_URL, or null when it is not set or is not an
 * https:// address (the address holds the webhook's key, so it never goes over plain http).
 */
export function backOfficeWebhook(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = env.BACK_OFFICE_WEBHOOK_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** A name as FluentCRM keeps it: the first word, then the rest. */
function splitName(name: string): { first_name?: string; last_name?: string } {
  const [first, ...rest] = name.trim().split(/\s+/).filter(Boolean);
  if (!first) return {};
  return rest.length ? { first_name: first, last_name: rest.join(" ") } : { first_name: first };
}

/** The update to send for one event about one person. */
export function contactUpdate(
  event: BackOfficeEvent,
  person: { email: string; name: string },
): ContactUpdate {
  const base = { email: person.email.trim().toLowerCase(), ...splitName(person.name) };
  if (event === "trialStarted") return { ...base, tags: [BACK_OFFICE_TAGS.trial] };
  if (event === "paid") {
    return { ...base, tags: [BACK_OFFICE_TAGS.customer], detach_tags: [BACK_OFFICE_TAGS.trial] };
  }
  return base;
}

/**
 * Sends one update to the webhook. Throws when FluentCRM did not take it, so the outbound
 * pool tries again. `redirect: "error"`: the key in the address is never sent on.
 */
export async function sendContactUpdate(
  webhookUrl: string,
  update: ContactUpdate,
  send: typeof fetch = fetch,
): Promise<void> {
  const response = await send(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(update),
    redirect: "error",
  });
  const answer = (await response.json().catch(() => null)) as { success?: unknown } | null;
  if (!response.ok || answer?.success !== true) {
    throw new Error(`The Back Office did not take the contact update (${response.status}).`);
  }
}
