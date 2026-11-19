// Where a sign-up came from. The dashboard's own /api/auth route (src/lib/client-ip.ts)
// adds the visitor's address and a signature made with MASTRA_JWT_SECRET, so an address
// can't be made up by calling the Convex site directly. A request without a good
// signature counts as "unknown", which shares one small allowance.

export const CLIENT_IP_HEADER = "x-ncat-client-ip";
export const CLIENT_IP_SIGNATURE_HEADER = "x-ncat-client-ip-signature";
export const UNKNOWN_NETWORK = "unknown";

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}

/** The signature the dashboard puts beside an address. */
export async function signClientIp(secret: string, ip: string): Promise<string> {
  return await hmac(secret, `client-ip:${ip}`);
}

/**
 * The network an address belongs to: the address itself for IPv4, its first four groups
 * (a /64, what one home or office is given) for IPv6.
 */
export function networkOf(ip: string): string {
  const address = ip.trim().toLowerCase();
  if (!address.includes(":")) return address;
  const [head = "", tail = ""] = address.split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups = address.includes("::")
    ? [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back]
    : front;
  return groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":");
}

/**
 * A key for the network a request came from, or UNKNOWN_NETWORK. It is a keyed hash, so
 * the address itself is never stored.
 */
export async function networkKey(
  headers: Headers | null | undefined,
  secret = process.env.MASTRA_JWT_SECRET,
): Promise<string> {
  const ip = headers?.get(CLIENT_IP_HEADER)?.trim();
  const signature = headers?.get(CLIENT_IP_SIGNATURE_HEADER)?.trim();
  if (!secret || !ip || !signature || ip.length > 64) return UNKNOWN_NETWORK;
  if ((await signClientIp(secret, ip)) !== signature) return UNKNOWN_NETWORK;
  return `net_${(await hmac(secret, `network:${networkOf(ip)}`)).slice(0, 32)}`;
}
