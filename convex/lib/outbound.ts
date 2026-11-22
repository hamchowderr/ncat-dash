import { getEdition } from "./edition";

/**
 * Addresses a team types that this backend then calls itself: a toolkit's address, a
 * Send to a URL step, a webhook's callback_url, an AI agent's client metadata document.
 *
 * The backend runs inside the server's own network. On a copy strangers sign up to, one
 * of them could otherwise point these at things only that network reaches: the backend's
 * own admin port, the other apps on a shared server, a cloud's metadata address. So there,
 * addresses on a private network are refused.
 *
 * On a copy whose people all belong to its owner, they are allowed: a self-hosted copy
 * often sends to its own n8n at http://n8n:5678 or a toolkit at http://toolkit:8080.
 *
 * Refused when OUTBOUND_PRIVATE=block, or by default on the hosted edition and on a copy
 * that lends its toolkit to teams (HOSTED_TOOLKIT_URL). OUTBOUND_PRIVATE=allow turns it off.
 *
 * Names are judged as written: this runtime cannot look up DNS, so a public name that
 * points at a private address is not caught here.
 */
export function privateAddressesBlocked(): boolean {
  const setting = process.env.OUTBOUND_PRIVATE?.trim().toLowerCase();
  if (setting === "block") return true;
  if (setting === "allow") return false;
  return getEdition() === "hosted" || Boolean(process.env.HOSTED_TOOLKIT_URL?.trim());
}

// Names that only mean something inside a network, and services that turn a name into
// any address written inside it (10.0.0.1.nip.io).
const INTERNAL_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".private",
  ".home.arpa",
];
const ADDRESS_IN_NAME = /(^|[.-])(\d{1,3}[.-]){3}\d{1,3}\.(nip\.io|sslip\.io|xip\.io|traefik\.me)$/;

function privateV4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function privateV6(address: string): boolean {
  const plain = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (plain === "::" || plain === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(plain);
  if (mapped) return privateV4(mapped[1]);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(plain)) return true;
  return /^(fc|fd|fe[89ab]|ff)/.test(plain) || plain.startsWith("64:ff9b:");
}

/** Whether a host name or address can only be reached from inside a network. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host.includes(":") || host.startsWith("[")) return privateV6(host);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return privateV4(host);
  // A name with no dot is a machine on the same network (convex, agent, toolkit, coolify).
  if (!host.includes(".")) return true;
  if (host === "localhost" || INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return true;
  }
  const embedded = ADDRESS_IN_NAME.exec(host);
  if (embedded) {
    const address = /(\d{1,3}[.-]){3}\d{1,3}(?=\.(nip|sslip|xip)\.io$|\.traefik\.me$)/.exec(host);
    return address ? privateV4(address[0].replace(/-/g, ".")) : true;
  }
  return false;
}

/**
 * Why this backend should not call an address a team gave it, in plain words, or null
 * when it may. `allowed` lists origins that are fine whatever they are (the toolkit the
 * operator lends).
 */
export function outboundProblem(address: string, allowed: string[] = []): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return "That is not a full web address.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "Only http and https addresses can be used.";
  }
  if (url.username || url.password) return "Leave the name and password out of the address.";
  if (!privateAddressesBlocked()) return null;
  if (allowed.some((origin) => sameOrigin(origin, url))) return null;
  if (isPrivateHost(url.hostname)) {
    return "That address is on a private network, which this dashboard can't reach. Use a public address.";
  }
  return null;
}

function sameOrigin(origin: string, url: URL): boolean {
  try {
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
}
