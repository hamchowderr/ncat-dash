import { requireMcpAuth } from "@better-auth/mcp";
import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { internal } from "./_generated/api";
import { type ActionCtx, httpAction } from "./_generated/server";
import { createAuth } from "./auth";
import { AGENT_SCOPES, mcpOrigin, mcpResource, TEAM_CLAIM } from "./lib/agentSignIn";
import { answerMcp, CORS, keyCallerOf } from "./mcp";
import { CORS as METADATA_CORS } from "./oauth";

/**
 * POST /mcp. A request sends one of the team's keys (Settings > MCP), or an OAuth access
 * token from Better Auth's MCP plugin, which Better Auth checks (signature, issuer, this
 * server as its audience, expiry) before the connection itself is checked here. Kept
 * apart from mcp.ts, so only this route loads Better Auth.
 */
export const serve = httpAction(async (ctx, request) => {
  const keyed = await keyCallerOf(ctx, request);
  if (keyed === "invalid") return withCors(invalidToken());
  if (keyed !== "none") return answerMcp(ctx, keyed, request);
  return withCors(await signedIn(ctx)(request));
});

/**
 * RFC 8414 and OpenID discovery, also at this backend's root, for agents that look for
 * them on the MCP server's own host. Better Auth writes the documents.
 */
export const authorizationServer = httpAction(async (ctx, request) =>
  oauthProviderAuthServerMetadata(createAuth(ctx), { headers: METADATA_CORS })(request),
);
export const openIdConfiguration = httpAction(async (ctx, request) =>
  oauthProviderOpenIdConfigMetadata(createAuth(ctx), { headers: METADATA_CORS })(request),
);

const signedIn = (ctx: ActionCtx) =>
  requireMcpAuth(
    createAuth(ctx),
    async (request, claims) => {
      const organizationId = claims[TEAM_CLAIM];
      const clientId = (claims.azp ?? claims.client_id) as unknown;
      if (typeof organizationId !== "string" || typeof clientId !== "string" || !claims.sub) {
        return invalidToken();
      }
      const connection = await ctx.runQuery(internal.oauth.connectionFor, {
        clientId,
        userId: claims.sub,
        organizationId,
      });
      // Disconnected in Settings, or the person left the team.
      if (!connection) return invalidToken("This connection has ended. Connect the app again.");
      if (!connection.lastUsedAt || Date.now() - connection.lastUsedAt > 60_000) {
        await ctx.runMutation(internal.oauth.touchConnection, {
          consentId: connection.consentId,
        });
      }
      return answerMcp(ctx, { organizationId, userId: claims.sub }, request);
    },
    { resource: mcpResource(), challengeScopes: AGENT_SCOPES },
  );

/** A 401 for a token or key that is not (or no longer) good, saying where to sign in. */
function invalidToken(
  message = "Sign in to use this server, or send one of your team's keys as Authorization: Bearer <key>.",
): Response {
  const metadata = `${mcpOrigin()}/.well-known/oauth-protected-resource/mcp`;
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": `Bearer error="invalid_token", resource_metadata="${metadata}", scope="${AGENT_SCOPES.join(" ")}"`,
    },
  });
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}
