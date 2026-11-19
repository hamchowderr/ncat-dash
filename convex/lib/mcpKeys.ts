/** The start of every key, so a key is easy to recognise (and to find if leaked). */
export const MCP_KEY_PREFIX = "ncat_";

/** A new key: the prefix and 32 random bytes, written with letters, digits, - and _. */
export function newMcpKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return MCP_KEY_PREFIX + btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** What is kept of a key: its SHA-256, in hex. */
export async function hashMcpKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The key sent with a request, as "Authorization: Bearer <key>". */
export function bearerKey(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match && match[1].startsWith(MCP_KEY_PREFIX) ? match[1] : null;
}
