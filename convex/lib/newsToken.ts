// Signed links for product news, which also reach people without an account (website
// sign-ups): one to confirm a sign-up (double opt-in) and one to unsubscribe. Each names
// one email address, so the link alone is enough; nobody has to sign in.

const CONFIRM_FOR_MS = 7 * 24 * 60 * 60 * 1000;

export type NewsLink =
  | { purpose: "confirm"; email: string; issuedAt: number }
  | { purpose: "unsubscribe"; email: string; broadcastId?: string };

function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET?.trim();
  if (!value) throw new Error("BETTER_AUTH_SECRET is not set, so news links can't be signed.");
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
    new TextEncoder().encode(`product-news:${payload}`),
  );
  return base64url(new Uint8Array(signature));
}

export async function newsToken(link: NewsLink): Promise<string> {
  const fields =
    link.purpose === "confirm"
      ? ["c", link.email.toLowerCase(), link.issuedAt]
      : ["u", link.email.toLowerCase(), link.broadcastId ?? ""];
  const payload = base64url(new TextEncoder().encode(JSON.stringify(fields)));
  return `${payload}.${await sign(payload)}`;
}

/** What a link is for, or null when we did not sign it or a confirm link is too old. */
export async function readNewsToken(token: string, now = Date.now()): Promise<NewsLink | null> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  if ((await sign(payload)) !== signature) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(fromBase64url(payload)));
    if (!Array.isArray(value) || value.length !== 3) return null;
    const [kind, email, third] = value;
    if (typeof email !== "string" || !email.includes("@")) return null;
    if (kind === "c" && typeof third === "number") {
      if (now - third > CONFIRM_FOR_MS || third > now + 60_000) return null;
      return { purpose: "confirm", email, issuedAt: third };
    }
    if (kind === "u" && typeof third === "string") {
      return { purpose: "unsubscribe", email, ...(third ? { broadcastId: third } : {}) };
    }
    return null;
  } catch {
    return null;
  }
}

/** This deployment's own address for a news link. */
export function newsUrl(path: "confirm" | "unsubscribe", token: string): string {
  const base = (process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
  return `${base}/email/news/${path}?token=${encodeURIComponent(token)}`;
}
