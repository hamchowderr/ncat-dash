/**
 * Sign-in for AI agents (MCP clients such as claude.ai, ChatGPT or Cursor), done by Better
 * Auth's MCP plugin (@better-auth/mcp, with @better-auth/cimd for clients named by a Client
 * ID Metadata Document). Its settings are in convex/auth.ts; the addresses and names they
 * share with the MCP server (convex/mcp.ts) and Settings (convex/oauth.ts) are here, kept
 * free of Better Auth so ordinary modules can import them.
 *
 * - The authorization server is Better Auth itself, at SITE_URL/api/auth (the dashboard
 *   passes /api/auth on to this backend).
 * - The protected resource is the MCP server, at CONVEX_SITE_URL/mcp. Access tokens are
 *   JWTs for exactly that address (their `aud`).
 * - A token works on one team: the person picks it at /connect/team, and it travels in
 *   the token as TEAM_CLAIM.
 */
import { outboundProblem } from "./outbound";

/** The scope that lets an agent work with a team's automations. */
export const AGENT_SCOPE = "automations";
/** Everything an agent is offered: who it is acting for, a refresh token, and the work. */
export const AGENT_SCOPES = ["openid", "profile", "email", "offline_access", AGENT_SCOPE];
/** The access-token claim that names the team the token works on. */
export const TEAM_CLAIM = "https://takewon.com/team";

export const ACCESS_TOKEN_SECONDS = 60 * 60;
export const REFRESH_TOKEN_SECONDS = 60 * 24 * 60 * 60;

const plain = (url: string | undefined) => (url ?? "").trim().replace(/\/+$/, "");

/** The dashboard's address, where people sign in and allow agents. */
export const siteUrl = () => plain(process.env.SITE_URL);

/**
 * This backend's public address, which serves the MCP server. Every deployment has
 * CONVEX_SITE_URL; the local default is only for code that runs without one (schema
 * generation).
 */
export const backendUrl = () =>
  plain(process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL) ||
  "http://127.0.0.1:3211";

/**
 * The authorization server: Better Auth's own address under the dashboard. A backend
 * that has no SITE_URL yet (a copy being set up) names itself instead, so Better Auth
 * still starts: its token signing refuses an issuer that is not a full address.
 */
export const agentIssuer = () => `${siteUrl() || backendUrl()}/api/auth`;

/** The MCP server's address, the one resource access tokens are for. */
export const mcpResource = () => `${backendUrl()}/mcp`;

/** The protected resource metadata (RFC 9728) for the MCP address. */
export function protectedResourceMetadata(name: string) {
  return {
    resource: mcpResource(),
    authorization_servers: [agentIssuer()],
    scopes_supported: AGENT_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: name,
  };
}

// A metadata document is a few kilobytes; a client's keys a little more.
const MAX_METADATA_BYTES = 64 * 1024;

/**
 * How client metadata documents (and their keys) are fetched, for @better-auth/cimd.
 *
 * Better Auth's own transport is Node only: it looks the name up once and connects to that
 * address. This backend's runtime cannot look up DNS, so this does what it can: the
 * address must be https, it is checked against the private-network rules every other
 * outside call here follows (lib/outbound.ts), redirects are refused, and the answer is
 * cut off at 64 KB. A public name that points at a private address is not caught, as for
 * every other address this backend calls.
 */
export async function fetchClientMetadata(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "https:")
    throw new TypeError("Client metadata must be on an https address.");
  const refused = outboundProblem(url.toString());
  if (refused) throw new TypeError(refused);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" && method !== "HEAD") throw new TypeError("Only GET and HEAD are used.");
  let response: Response;
  try {
    response = await fetch(url, { ...init, method, redirect: "manual" });
  } catch (error) {
    if (init?.signal?.aborted) {
      throw Object.assign(new TypeError("metadata request aborted", { cause: error }), {
        code: "ERR_CIMD_REQUEST_ABORTED",
      });
    }
    throw error;
  }
  if (!response.body || method === "HEAD") return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_METADATA_BYTES) {
      await reader.cancel();
      throw new TypeError("The client's metadata is too large.");
    }
    chunks.push(value);
  }
  return new Response(new Blob(chunks as BlobPart[]), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
