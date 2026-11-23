/**
 * Agents signing in (MCP clients) look for the sign-in server's metadata at the
 * addresses RFC 8414 and OpenID Connect derive from its issuer, SITE_URL/api/auth:
 * /.well-known/oauth-authorization-server/api/auth and
 * /.well-known/openid-configuration/api/auth. (SITE_URL/api/auth/.well-known/... already
 * reaches Better Auth through the /api/auth pass-through.) Better Auth writes the
 * document; this passes the one the backend serves on.
 */
const PATHS = {
  "oauth-authorization-server": "/.well-known/oauth-authorization-server",
  "openid-configuration": "/api/auth/.well-known/openid-configuration",
} as const;

export async function issuerMetadata(kind: keyof typeof PATHS): Promise<Response> {
  const backend = (process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
  const answer = await fetch(`${backend}${PATHS[kind]}`, { cache: "no-store" });
  return new Response(answer.body, {
    status: answer.status,
    headers: {
      "content-type": answer.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
