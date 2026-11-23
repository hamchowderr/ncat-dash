// Slack signs every request it sends with the app's signing secret. This checks one.

/** Slack refuses requests older than this, and so do we. */
export const TOLERANCE_S = 5 * 60;

async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/** Whether a request came from Slack, signed with this secret, recently. */
export async function slackSigned(
  secret: string,
  request: { body: string; timestamp: string; signature: string; now: number },
): Promise<boolean> {
  const seconds = Number(request.timestamp);
  if (!Number.isFinite(seconds) || Math.abs(request.now / 1000 - seconds) > TOLERANCE_S) {
    return false;
  }
  const expected = `v0=${await hmacHex(secret, `v0:${request.timestamp}:${request.body}`)}`;
  return sameText(expected, request.signature);
}
