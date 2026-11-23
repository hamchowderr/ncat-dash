import { NOTIFICATION_KINDS, type NotificationKind } from "./notifications";

// One-click unsubscribe for the emails people can opt out of (alerts and the daily
// summary). Each email carries a signed link for one person, one team and one kind of
// news, so the link alone is enough to switch that email off: no sign-in, as Gmail and
// Yahoo expect (RFC 8058). The link changes nothing else.

/** What a link switches off: one kind of alert email, or every alert email (the summary). */
export type UnsubscribeScope = NotificationKind | "all";

export type UnsubscribeTarget = {
  userId: string;
  organizationId: string;
  scope: UnsubscribeScope;
};

function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET?.trim();
  if (!value)
    throw new Error("BETTER_AUTH_SECRET is not set, so unsubscribe links can't be signed.");
  return value;
}

function base64url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const text = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`email-unsubscribe:${payload}`),
  );
  return base64url(new Uint8Array(signature));
}

const SCOPES = new Set<string>(["all", ...NOTIFICATION_KINDS.map((entry) => entry.kind)]);

export async function unsubscribeToken(target: UnsubscribeTarget): Promise<string> {
  const payload = base64url(
    new TextEncoder().encode(JSON.stringify([target.userId, target.organizationId, target.scope])),
  );
  return `${payload}.${await sign(payload)}`;
}

/** The person, team and kind a token is for, or null when it was not signed by us. */
export async function readUnsubscribeToken(token: string): Promise<UnsubscribeTarget | null> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  if ((await sign(payload)) !== signature) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(fromBase64url(payload)));
    if (!Array.isArray(value) || value.length !== 3) return null;
    const [userId, organizationId, scope] = value;
    if (typeof userId !== "string" || typeof organizationId !== "string") return null;
    if (typeof scope !== "string" || !SCOPES.has(scope)) return null;
    return { userId, organizationId, scope: scope as UnsubscribeScope };
  } catch {
    return null;
  }
}

/** Where an unsubscribe link goes: this deployment's own HTTP address. */
export function unsubscribeUrl(token: string): string {
  const base = (process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
  return `${base}/email/unsubscribe?token=${encodeURIComponent(token)}`;
}
