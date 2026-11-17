// Checks a request from the agent server: an HS256 JWT signed with MASTRA_JWT_SECRET, the
// same shared secret the dashboard signs its own calls to the agent with.

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** True when the request carries a live token signed with the shared secret. */
export async function fromAgent(request: Request, now = Date.now()): Promise<boolean> {
  const secret = process.env.MASTRA_JWT_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const [head, body, signature] = token.split(".");
  if (!head || !body || !signature) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const good = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64url(signature),
      new TextEncoder().encode(`${head}.${body}`),
    );
    if (!good) return false;
    const header = JSON.parse(new TextDecoder().decode(fromBase64url(head))) as { alg?: unknown };
    if (header.alg !== "HS256") return false;
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as { exp?: unknown };
    return typeof claims.exp === "number" && claims.exp * 1000 > now;
  } catch {
    return false;
  }
}
