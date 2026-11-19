import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  httpAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { authComponent } from "./auth";
import { MANAGER_ROLES, requireMember, type TeamRole } from "./lib/authz";
import {
  ACCESS_TOKEN_MS,
  ACCESS_TOKEN_PREFIX,
  authServerMetadata,
  CLIENT_ID_PREFIX,
  CODE_MS,
  type ClientInfo,
  clientName,
  isMetadataClientId,
  OAUTH_SCOPE,
  pkceMatches,
  protectedResourceMetadata,
  randomToken,
  readClientMetadata,
  REFRESH_TOKEN_MS,
  REFRESH_TOKEN_PREFIX,
  redirectAllowed,
  redirectWith,
  REQUEST_MS,
  resourceMatches,
  sha256Hex,
  validRedirectUri,
} from "./lib/oauth";

/**
 * Sign-in for AI agents. An agent (an MCP client such as ChatGPT, Claude or Cursor) finds this
 * server from the MCP address, sends the person to /connect/<request> in the dashboard
 * to choose a team and allow it, and gets tokens that act as that person on that team.
 * The person can disconnect it in Settings > AI agents.
 */

const MAX_GRANTS_PER_TEAM = 100;

/** This deployment's public address, which is both the issuer and the MCP host. */
export function issuer(): string {
  return (process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "").replace(
    /\/+$/,
    "",
  );
}

export const mcpResource = () => `${issuer()}/mcp`;
const resourceMetadataUrl = () => `${issuer()}/.well-known/oauth-protected-resource/mcp`;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers":
    "authorization, content-type, mcp-protocol-version, mcp-method, mcp-name",
  "access-control-expose-headers": "www-authenticate",
};

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS, ...extra },
  });

const oauthError = (error: string, description: string, status = 400) =>
  json({ error, error_description: description }, status);

/** The challenge an agent gets with a 401: where to read how to sign in. */
export function signInChallenge(error?: "invalid_token") {
  const parts = [`resource_metadata="${resourceMetadataUrl()}"`, `scope="${OAUTH_SCOPE}"`];
  if (error) parts.unshift(`error="${error}"`);
  return `Bearer ${parts.join(", ")}`;
}

export const preflight = httpAction(async () => new Response(null, { status: 204, headers: CORS }));

export const authorizationServer = httpAction(async () => json(authServerMetadata(issuer())));

export const protectedResource = httpAction(async () =>
  json(protectedResourceMetadata(issuer(), mcpResource(), "Content automations")),
);

// ---------------------------------------------------------------- clients

export const registeredClient = internalQuery({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    const client = await ctx.db
      .query("oauthClients")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .unique();
    return client
      ? {
          clientId: client.clientId,
          name: client.name,
          uri: client.uri,
          redirectUris: client.redirectUris,
        }
      : null;
  },
});

export const storeClient = internalMutation({
  args: {
    clientId: v.string(),
    name: v.string(),
    uri: v.union(v.null(), v.string()),
    redirectUris: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("oauthClients", { ...args, createdAt: Date.now() });
  },
});

/** Dynamic client registration (RFC 7591), for agents without a metadata document. */
export const register = httpAction(async (ctx, request) => {
  const body = await request.text();
  if (body.length > 20_000) return oauthError("invalid_client_metadata", "Too large.");
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(body);
  } catch {
    return oauthError("invalid_client_metadata", "Send the client's metadata as JSON.");
  }
  const asked = Array.isArray(doc.redirect_uris) ? doc.redirect_uris : [];
  if (asked.length === 0 || asked.length > 10 || !asked.every(validRedirectUri)) {
    return oauthError(
      "invalid_redirect_uri",
      "Give 1 to 10 redirect_uris: https addresses, loopback http addresses, or an app's own scheme.",
    );
  }
  const method = doc.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") {
    return oauthError(
      "invalid_client_metadata",
      "Only public clients are supported: token_endpoint_auth_method must be none.",
    );
  }
  const redirectUris = asked as string[];
  const clientId = randomToken(CLIENT_ID_PREFIX);
  const name = clientName(doc.client_name, "An AI agent");
  const uri =
    typeof doc.client_uri === "string" && /^https:\/\//.test(doc.client_uri)
      ? doc.client_uri
      : null;
  await ctx.runMutation(internal.oauth.storeClient, { clientId, name, uri, redirectUris });
  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      ...(uri ? { client_uri: uri } : {}),
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: OAUTH_SCOPE,
    },
    201,
  );
});

async function findClient(
  ctx: ActionCtx,
  clientId: string,
): Promise<{ ok: true; client: ClientInfo } | { ok: false; message: string }> {
  if (isMetadataClientId(clientId)) {
    try {
      const response = await fetch(clientId, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok)
        return { ok: false, message: "The client's metadata document could not be read." };
      const text = await response.text();
      if (text.length > 20_000)
        return { ok: false, message: "The client's metadata document is too large." };
      return readClientMetadata(clientId, JSON.parse(text));
    } catch {
      return { ok: false, message: "The client's metadata document could not be read." };
    }
  }
  const client = await ctx.runQuery(internal.oauth.registeredClient, { clientId });
  return client
    ? { ok: true, client }
    : { ok: false, message: "This client_id is not registered here." };
}

// ---------------------------------------------------------------- authorize

export const startRequest = internalMutation({
  args: {
    clientId: v.string(),
    clientName: v.string(),
    clientUri: v.union(v.null(), v.string()),
    redirectUri: v.string(),
    state: v.union(v.null(), v.string()),
    codeChallenge: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("oauthRequests", { ...args, expiresAt: Date.now() + REQUEST_MS });
  },
});

const plainError = (message: string) =>
  new Response(message, { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });

/** GET /oauth/authorize: checks the agent, then sends the person to the dashboard. */
export const authorize = httpAction(async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!clientId) return plainError("This sign-in link has no client_id.");
  const found = await findClient(ctx, clientId);
  if (!found.ok) return plainError(found.message);
  const { client } = found;
  // Without a redirect address the client registered, nothing can be sent back safely.
  if (!redirectUri || !redirectAllowed(client.redirectUris, redirectUri)) {
    return plainError("This redirect_uri is not one the client registered.");
  }
  const state = params.get("state");
  const back = (error: string, description: string) =>
    Response.redirect(
      redirectWith(redirectUri, { error, error_description: description, state, iss: issuer() }),
      302,
    );
  if (params.get("response_type") !== "code") {
    return back("unsupported_response_type", "Only response_type=code is supported.");
  }
  const challenge = params.get("code_challenge") ?? "";
  if (!/^[A-Za-z0-9\-_]{43}$/.test(challenge) || params.get("code_challenge_method") !== "S256") {
    return back("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  }
  if (!resourceMatches(params.get("resource"), mcpResource(), issuer())) {
    return back("invalid_target", `This server only gives access to ${mcpResource()}.`);
  }
  const requestId = await ctx.runMutation(internal.oauth.startRequest, {
    clientId,
    clientName: client.name,
    clientUri: client.uri,
    redirectUri,
    state: state ? state.slice(0, 1000) : null,
    codeChallenge: challenge,
  });
  const site = (process.env.SITE_URL ?? "").replace(/\/+$/, "");
  return Response.redirect(`${site}/connect/${requestId}`, 302);
});

/** What the /connect page shows: which agent is asking, and the person's teams. */
export const request = query({
  args: { requestId: v.string() },
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return { status: "signed-out" as const };
    const id = ctx.db.normalizeId("oauthRequests", args.requestId);
    const found = id ? await ctx.db.get(id) : null;
    if (!found || found.codeHash || found.expiresAt < Date.now())
      return { status: "gone" as const };
    const teams = (await ctx.runQuery(components.betterAuth.members.teamsFor, {
      userId: user._id,
    })) as { id: string; name: string; role: string }[];
    return {
      status: "open" as const,
      clientName: found.clientName,
      clientHost: found.clientUri ? new URL(found.clientUri).host : null,
      redirectHost: new URL(found.redirectUri).host || new URL(found.redirectUri).protocol,
      teams,
    };
  },
});

/** The person's answer. Returns where to send the browser: back to the agent. */
export const decide = mutation({
  args: { requestId: v.string(), organizationId: v.optional(v.string()), allow: v.boolean() },
  returns: v.object({ redirectTo: v.string() }),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("oauthRequests", args.requestId);
    const found = id ? await ctx.db.get(id) : null;
    if (!found || found.codeHash || found.expiresAt < Date.now()) {
      throw new ConvexError({
        code: "not_found",
        message: "This sign-in has expired. Start again from the agent.",
      });
    }
    const base = { state: found.state, iss: issuer() };
    if (!args.allow) {
      const user = await authComponent.safeGetAuthUser(ctx);
      if (!user) throw new ConvexError({ code: "unauthenticated", message: "Sign in first." });
      await ctx.db.delete(found._id);
      return {
        redirectTo: redirectWith(found.redirectUri, {
          error: "access_denied",
          error_description: "The person did not allow it.",
          ...base,
        }),
      };
    }
    if (!args.organizationId)
      throw new ConvexError({ code: "invalid_input", message: "Pick a team." });
    const { userId } = await requireMember(ctx, args.organizationId);
    const code = randomToken("");
    await ctx.db.patch(found._id, {
      userId,
      organizationId: args.organizationId,
      codeHash: await sha256Hex(code),
      codeExpiresAt: Date.now() + CODE_MS,
    });
    return { redirectTo: redirectWith(found.redirectUri, { code, ...base }) };
  },
});

// ---------------------------------------------------------------- tokens

async function newTokens() {
  const access = randomToken(ACCESS_TOKEN_PREFIX);
  const refresh = randomToken(REFRESH_TOKEN_PREFIX);
  return {
    access,
    refresh,
    accessHash: await sha256Hex(access),
    refreshHash: await sha256Hex(refresh),
    accessExpiresAt: Date.now() + ACCESS_TOKEN_MS,
    refreshExpiresAt: Date.now() + REFRESH_TOKEN_MS,
  };
}

const tokenReply = (tokens: Awaited<ReturnType<typeof newTokens>>) => ({
  access_token: tokens.access,
  token_type: "Bearer",
  expires_in: Math.floor(ACCESS_TOKEN_MS / 1000),
  refresh_token: tokens.refresh,
  scope: OAUTH_SCOPE,
});

type Outcome =
  | { ok: true; reply: ReturnType<typeof tokenReply> }
  | { ok: false; error: string; description: string };

export const exchangeCode = internalMutation({
  args: { code: v.string(), verifier: v.string(), clientId: v.string(), redirectUri: v.string() },
  handler: async (ctx, args): Promise<Outcome> => {
    const bad = (description: string): Outcome => ({
      ok: false,
      error: "invalid_grant",
      description,
    });
    const hash = await sha256Hex(args.code);
    const request = await ctx.db
      .query("oauthRequests")
      .withIndex("by_code", (q) => q.eq("codeHash", hash))
      .unique();
    if (!request || !request.userId || !request.organizationId)
      return bad("This code is not valid.");
    // A code is used once, whatever happens next.
    await ctx.db.delete(request._id);
    if ((request.codeExpiresAt ?? 0) < Date.now()) return bad("This code has expired.");
    if (request.clientId !== args.clientId) return bad("This code was given to another client.");
    if (request.redirectUri !== args.redirectUri) return bad("redirect_uri does not match.");
    if (!(await pkceMatches(args.verifier, request.codeChallenge))) {
      return bad("code_verifier does not match the code_challenge.");
    }
    const role = await ctx.runQuery(components.betterAuth.members.roleFor, {
      userId: request.userId,
      organizationId: request.organizationId,
    });
    if (!role) return bad("The person is no longer on this team.");
    const grants = await ctx.db
      .query("oauthGrants")
      .withIndex("by_organization", (q) => q.eq("organizationId", request.organizationId!))
      .take(MAX_GRANTS_PER_TEAM + 1);
    if (grants.length >= MAX_GRANTS_PER_TEAM) {
      return bad(
        "This team has too many connected agents. Disconnect some in Settings > AI agents.",
      );
    }
    const tokens = await newTokens();
    await ctx.db.insert("oauthGrants", {
      organizationId: request.organizationId,
      userId: request.userId,
      clientId: request.clientId,
      clientName: request.clientName,
      accessHash: tokens.accessHash,
      accessExpiresAt: tokens.accessExpiresAt,
      refreshHash: tokens.refreshHash,
      refreshExpiresAt: tokens.refreshExpiresAt,
      createdAt: Date.now(),
      lastUsedAt: null,
    });
    return { ok: true, reply: tokenReply(tokens) };
  },
});

export const refreshGrant = internalMutation({
  args: { refreshToken: v.string(), clientId: v.string() },
  handler: async (ctx, args): Promise<Outcome> => {
    const hash = await sha256Hex(args.refreshToken);
    const grant = await ctx.db
      .query("oauthGrants")
      .withIndex("by_refresh", (q) => q.eq("refreshHash", hash))
      .unique();
    const bad: Outcome = {
      ok: false,
      error: "invalid_grant",
      description: "This refresh token is not valid.",
    };
    if (!grant || grant.clientId !== args.clientId) return bad;
    if (grant.refreshExpiresAt < Date.now()) {
      await ctx.db.delete(grant._id);
      return bad;
    }
    const tokens = await newTokens();
    await ctx.db.patch(grant._id, {
      accessHash: tokens.accessHash,
      accessExpiresAt: tokens.accessExpiresAt,
      refreshHash: tokens.refreshHash,
      refreshExpiresAt: tokens.refreshExpiresAt,
    });
    return { ok: true, reply: tokenReply(tokens) };
  },
});

async function formOf(request: Request): Promise<Record<string, string>> {
  const text = await request.text();
  if (text.length > 20_000) return {};
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      const parsed = JSON.parse(text);
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

/** POST /oauth/token: a code (with its PKCE verifier) or a refresh token, for tokens. */
export const token = httpAction(async (ctx, request) => {
  const form = await formOf(request);
  const clientId = form.client_id ?? "";
  if (!clientId) return oauthError("invalid_client", "client_id is needed.", 401);
  if (form.resource && !resourceMatches(form.resource, mcpResource(), issuer())) {
    return oauthError("invalid_target", `This server only gives access to ${mcpResource()}.`);
  }
  let outcome: Outcome;
  if (form.grant_type === "authorization_code") {
    if (!form.code || !form.code_verifier || !form.redirect_uri) {
      return oauthError("invalid_request", "code, code_verifier and redirect_uri are needed.");
    }
    outcome = await ctx.runMutation(internal.oauth.exchangeCode, {
      code: form.code,
      verifier: form.code_verifier,
      clientId,
      redirectUri: form.redirect_uri,
    });
  } else if (form.grant_type === "refresh_token") {
    if (!form.refresh_token) return oauthError("invalid_request", "refresh_token is needed.");
    outcome = await ctx.runMutation(internal.oauth.refreshGrant, {
      refreshToken: form.refresh_token,
      clientId,
    });
  } else {
    return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  }
  return outcome.ok ? json(outcome.reply) : oauthError(outcome.error, outcome.description);
});

export const revokeToken = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const hash = await sha256Hex(args.token);
    const grant =
      (await ctx.db
        .query("oauthGrants")
        .withIndex("by_access", (q) => q.eq("accessHash", hash))
        .unique()) ??
      (await ctx.db
        .query("oauthGrants")
        .withIndex("by_refresh", (q) => q.eq("refreshHash", hash))
        .unique());
    if (grant) await ctx.db.delete(grant._id);
  },
});

/** POST /oauth/revoke (RFC 7009): the agent signing itself out. Always answers 200. */
export const revoke = httpAction(async (ctx, request) => {
  const form = await formOf(request);
  if (form.token) await ctx.runMutation(internal.oauth.revokeToken, { token: form.token });
  return json({});
});

// ---------------------------------------------------------------- the MCP side

/** Who an access token acts for, or null when it is unknown, expired or no longer valid. */
export const grantFor = internalQuery({
  args: { accessToken: v.string() },
  handler: async (ctx, args) => {
    const hash = await sha256Hex(args.accessToken);
    const grant = await ctx.db
      .query("oauthGrants")
      .withIndex("by_access", (q) => q.eq("accessHash", hash))
      .unique();
    if (!grant || grant.accessExpiresAt < Date.now()) return null;
    const role = (await ctx.runQuery(components.betterAuth.members.roleFor, {
      userId: grant.userId,
      organizationId: grant.organizationId,
    })) as TeamRole | null;
    if (!role) return null;
    return {
      grantId: grant._id,
      organizationId: grant.organizationId,
      userId: grant.userId,
      role,
      lastUsedAt: grant.lastUsedAt,
    };
  },
});

export const touchGrant = internalMutation({
  args: { grantId: v.id("oauthGrants") },
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.grantId))
      await ctx.db.patch(args.grantId, { lastUsedAt: Date.now() });
  },
});

// ---------------------------------------------------------------- settings

/** The agents connected to the team. Everyone sees their own; managers see everyone's. */
export const connections = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId, role } = await requireMember(ctx, args.organizationId);
    const manager = MANAGER_ROLES.includes(role);
    const grants = await ctx.db
      .query("oauthGrants")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(MAX_GRANTS_PER_TEAM);
    const visible = grants.filter((grant) => manager || grant.userId === userId);
    const people = new Map<string, string>();
    for (const grant of visible) {
      if (people.has(grant.userId)) continue;
      const contact = (await ctx.runQuery(components.betterAuth.members.contact, {
        userId: grant.userId,
      })) as { name?: string } | null;
      people.set(grant.userId, contact?.name || "Someone");
    }
    return visible.map((grant) => ({
      grantId: grant._id as Id<"oauthGrants">,
      clientName: grant.clientName,
      person: people.get(grant.userId) ?? "Someone",
      mine: grant.userId === userId,
      createdAt: grant.createdAt,
      lastUsedAt: grant.lastUsedAt,
    }));
  },
});

export const disconnect = mutation({
  args: { organizationId: v.string(), grantId: v.id("oauthGrants") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, role } = await requireMember(ctx, args.organizationId);
    const grant = await ctx.db.get(args.grantId);
    if (!grant || grant.organizationId !== args.organizationId) return null;
    if (grant.userId !== userId && !MANAGER_ROLES.includes(role)) {
      throw new ConvexError({
        code: "forbidden",
        message: "Only a team owner or admin can disconnect someone else's agent.",
      });
    }
    await ctx.db.delete(grant._id);
    return null;
  },
});
