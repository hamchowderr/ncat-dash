/**
 * The pieces of the dashboard's own OAuth 2.1 sign-in for AI agents (MCP clients such as
 * claude.ai connectors), kept free of Convex so they can be tested on their own.
 *
 * Better Auth's OAuth provider plugin cannot run on the Convex adapter (it needs compound
 * unique indexes), so the dashboard is its own small authorization server: public
 * clients only, authorization code with PKCE (S256), refresh tokens that rotate, clients
 * named by a Client ID Metadata Document or registered on the spot (RFC 7591).
 */

export const OAUTH_SCOPE = "automations";
export const ACCESS_TOKEN_PREFIX = "ncat_at_";
export const REFRESH_TOKEN_PREFIX = "ncat_rt_";
export const CLIENT_ID_PREFIX = "ncat_client_";

export const ACCESS_TOKEN_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_MS = 60 * 24 * 60 * 60 * 1000;
/** How long the sign-in page may take, from the agent opening it to the person deciding. */
export const REQUEST_MS = 15 * 60 * 1000;
/** How long the agent has to swap the code for tokens. */
export const CODE_MS = 5 * 60 * 1000;

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export function randomToken(prefix: string): string {
  return prefix + base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Whether the verifier the agent sends with the code matches the challenge it began with. */
export async function pkceMatches(verifier: string, challenge: string): Promise<boolean> {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest)) === challenge;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:"]);

/**
 * Where an agent may be sent back to with its code: an https address, a loopback http
 * address (Claude Code, desktop apps), or an app's own scheme such as cursor://.
 */
export function validRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return LOOPBACK.has(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !BLOCKED_SCHEMES.has(url.protocol);
}

/**
 * Whether a registered redirect address covers the one asked for. Loopback addresses
 * match on any port, as RFC 8252 says, since a desktop app picks its port each time.
 */
export function redirectAllowed(registered: string[], asked: string): boolean {
  if (registered.includes(asked)) return true;
  let wanted: URL;
  try {
    wanted = new URL(asked);
  } catch {
    return false;
  }
  if (wanted.protocol !== "http:" || !LOOPBACK.has(wanted.hostname)) return false;
  return registered.some((each) => {
    try {
      const url = new URL(each);
      return (
        url.protocol === "http:" &&
        url.hostname === wanted.hostname &&
        url.pathname === wanted.pathname
      );
    } catch {
      return false;
    }
  });
}

/** A client id that is the address of its own metadata document. */
export function isMetadataClientId(clientId: string): boolean {
  try {
    const url = new URL(clientId);
    return url.protocol === "https:" && url.pathname !== "/" && !url.hash && !url.username;
  } catch {
    return false;
  }
}

export type ClientInfo = {
  clientId: string;
  name: string;
  uri: string | null;
  redirectUris: string[];
};

/** Reads a Client ID Metadata Document, or says what is wrong with it. */
export function readClientMetadata(
  clientId: string,
  document: unknown,
): { ok: true; client: ClientInfo } | { ok: false; message: string } {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return { ok: false, message: "The client's metadata document is not a JSON object." };
  }
  const doc = document as Record<string, unknown>;
  if (doc.client_id !== clientId) {
    return { ok: false, message: "The client's metadata document names a different client_id." };
  }
  const redirectUris = Array.isArray(doc.redirect_uris)
    ? doc.redirect_uris.filter(validRedirectUri)
    : [];
  if (redirectUris.length === 0) {
    return { ok: false, message: "The client's metadata document lists no usable redirect_uris." };
  }
  return {
    ok: true,
    client: {
      clientId,
      name: clientName(doc.client_name, new URL(clientId).hostname),
      uri:
        typeof doc.client_uri === "string" && /^https:\/\//.test(doc.client_uri)
          ? doc.client_uri
          : null,
      redirectUris: redirectUris.slice(0, 20),
    },
  };
}

export function clientName(name: unknown, fallback: string): string {
  const text = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  return text || fallback;
}

/** The authorization server metadata (RFC 8414) for an issuer. */
export function authServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    scopes_supported: [OAUTH_SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

/** The protected resource metadata (RFC 9728) for the MCP address. */
export function protectedResourceMetadata(issuer: string, resource: string, name: string) {
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: name,
  };
}

/** Whether the resource the agent named is this MCP server (with or without /mcp). */
export function resourceMatches(asked: string | null, resource: string, issuer: string): boolean {
  if (!asked) return true;
  const plain = asked.replace(/\/+$/, "");
  return plain === resource || plain === issuer;
}

/** Adds the code (or an error) to the agent's redirect address. */
export function redirectWith(
  redirectUri: string,
  values: Record<string, string | null | undefined>,
) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}
