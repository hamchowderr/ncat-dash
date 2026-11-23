import { MastraJwtAuth } from '@mastra/auth';

/**
 * Auth for Studio, every /api/* route and the chat-kit contract routes: a Bearer JWT
 * signed with one shared HS256 secret. No secret, no auth. That is the local-dev default.
 *
 * The token's `sub` is the user. The web proxy (lib/mastra-proxy.ts) signs each request
 * with the signed-in user's id as `sub`, and `mapUserToResourceId` makes that the
 * request's resource id, so the routes drive that user's own Session. A token with no
 * `sub` (a hand-made Studio token, say) maps to `defaultResourceId`, the shared user.
 */
/** Tokens for this server say so in `aud`; a token signed for the dashboard is refused. */
export const AGENT_AUDIENCE = 'ncat-agent';

class AgentJwtAuth extends MastraJwtAuth {
  override async authorizeUser(user: Parameters<MastraJwtAuth['authorizeUser']>[0]) {
    const aud = user?.aud;
    const forUs = aud === AGENT_AUDIENCE || (Array.isArray(aud) && aud.includes(AGENT_AUDIENCE));
    return forUs && (await super.authorizeUser(user));
  }
}

export function createServerAuth(
  secret: string | undefined,
  defaultResourceId = 'chat-kit-user',
): MastraJwtAuth | undefined {
  return secret
    ? new AgentJwtAuth({
        secret,
        mapUserToResourceId: (user) =>
          typeof user?.sub === 'string' && user.sub.trim() ? user.sub.trim() : defaultResourceId,
      })
    : undefined;
}
