// The business's Back Office: a WordPress store running FluentCRM (and Fluent Support) that
// keeps the dashboard's customers as contacts. The dashboard tells it, through FluentCRM's
// incoming webhook, who signed up, whose team is on a free trial and whose team has bought.
// Off unless BACK_OFFICE_WEBHOOK_URL is set. Updates go out through the AnyPress SDK.

import { type ContactUpdate, DEFAULT_TAG_NAMES } from "waas-provisioning-sdk";

export { sendContactUpdate } from "waas-provisioning-sdk";

/** What happened to a person, as the Back Office hears it. */
export type BackOfficeEvent = "signedUp" | "trialStarted" | "paid";

/** The tag names FluentCRM keeps, by name: the AnyPress SDK's, so Stripe events can share them. */
export const BACK_OFFICE_TAGS = {
  trial: DEFAULT_TAG_NAMES.trial,
  customer: DEFAULT_TAG_NAMES.customer,
} as const;

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
