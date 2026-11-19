import { afterEach, describe, expect, test, vi } from "vitest";
import { api, components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { pkceMatches, readClientMetadata, redirectAllowed, validRedirectUri } from "./lib/oauth";
import { addPerson, addTeam, backend } from "./test.setup";

type Backend = ReturnType<typeof backend>;

const SITE = "https://dash-api.example.site";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
// A PKCE pair: the challenge is base64url(SHA-256(verifier)), worked out by hand.
const VERIFIER = "dBjftJeZ4CVP-mJ92K9ns3R_3iOIGI9w9U_7Hz0HRvM";
const CHALLENGE = "1RieZWqo-K9gdSrRRuS-3G2913JS22xChv9t6ZUot1M";

async function setUp() {
  process.env.CONVEX_SITE_URL = SITE;
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const second = await addTeam(t, "Night Shift");
  const owner = await addPerson(t, "Maya Ortiz", [team, second], "owner");
  const member = await addPerson(t, "Theo Banks", [team]);
  await t.run((ctx) =>
    ctx.db.insert("automations", {
      organizationId: team,
      name: "Weekly clips",
      enabled: false,
      trigger: { kind: "manual" },
      nodes: [],
      edges: [],
      hookToken: "token",
      nextRunAt: null,
      createdBy: owner.id,
      updatedAt: Date.now(),
    }),
  );
  return { t, team, second, owner, member };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function register(t: Backend, redirectUris = [REDIRECT]) {
  const response = await t.fetch("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: redirectUris }),
  });
  return { status: response.status, body: await response.json() };
}

function authorizeUrl(clientId: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "state-123",
    scope: "automations",
    resource: `${SITE}/mcp`,
    ...extra,
  });
  return `/oauth/authorize?${params}`;
}

async function startSignIn(t: Backend, clientId: string, extra: Record<string, string> = {}) {
  const response = await t.fetch(authorizeUrl(clientId, extra), { redirect: "manual" });
  return { status: response.status, location: response.headers.get("location") ?? "", response };
}

async function exchange(t: Backend, fields: Record<string, string>) {
  const response = await t.fetch("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: response.status, body: await response.json() };
}

/** Registers, signs in as the owner on the team, and swaps the code for tokens. */
async function connect(setup: Awaited<ReturnType<typeof setUp>>) {
  const { t, team, owner } = setup;
  const client = (await register(t)).body.client_id as string;
  const started = await startSignIn(t, client);
  const requestId = started.location.split("/connect/")[1];
  const { redirectTo } = await owner.as.mutation(api.oauth.decide, {
    requestId,
    organizationId: team,
    allow: true,
  });
  const code = new URL(redirectTo).searchParams.get("code")!;
  const tokens = await exchange(t, {
    grant_type: "authorization_code",
    code,
    code_verifier: VERIFIER,
    client_id: client,
    redirect_uri: REDIRECT,
    resource: `${SITE}/mcp`,
  });
  return { client, requestId, redirectTo, code, tokens: tokens.body };
}

async function listAutomations(t: Backend, token: string) {
  return t.fetch("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_automations", arguments: {} },
    }),
  });
}

describe("how an agent finds out how to sign in", () => {
  test("a request without a token gets 401 naming the resource metadata", async () => {
    const { t } = await setUp();
    const response = await t.fetch("/mcp", { method: "POST", body: "{}" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${SITE}/.well-known/oauth-protected-resource/mcp", scope="automations"`,
    );
  });

  test("the metadata points from the MCP address to this server's sign-in", async () => {
    const { t } = await setUp();
    for (const path of [
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource",
    ]) {
      const resource = await (await t.fetch(path)).json();
      expect(resource).toMatchObject({ resource: `${SITE}/mcp`, authorization_servers: [SITE] });
    }
    const server = await (await t.fetch("/.well-known/oauth-authorization-server")).json();
    expect(server).toMatchObject({
      issuer: SITE,
      authorization_endpoint: `${SITE}/oauth/authorize`,
      token_endpoint: `${SITE}/oauth/token`,
      registration_endpoint: `${SITE}/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });
});

describe("signing an agent in", () => {
  test("register, allow on a team, swap the code, and work as that person on that team", async () => {
    const setup = await setUp();
    const { t, team, owner } = setup;
    const { redirectTo, tokens } = await connect(setup);
    const back = new URL(redirectTo);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("state-123");
    expect(back.searchParams.get("iss")).toBe(SITE);
    expect(tokens).toMatchObject({
      token_type: "Bearer",
      access_token: expect.stringMatching(/^ncat_at_/),
      refresh_token: expect.stringMatching(/^ncat_rt_/),
      expires_in: 3600,
    });

    const listed = await (await listAutomations(t, tokens.access_token)).json();
    expect(JSON.parse(listed.result.content[0].text)).toEqual([
      expect.objectContaining({ name: "Weekly clips" }),
    ]);

    const connections = await owner.as.query(api.oauth.connections, { organizationId: team });
    expect(connections).toEqual([
      expect.objectContaining({ clientName: "Claude", mine: true, lastUsedAt: expect.any(Number) }),
    ]);
  });

  test("the page shows the agent and the person's teams, and the person picks one", async () => {
    const { t, owner } = await setUp();
    const client = (await register(t)).body.client_id as string;
    const started = await startSignIn(t, client);
    expect(started.status).toBe(302);
    expect(started.location).toMatch(/^http:\/\/localhost:3000\/connect\//);
    const requestId = started.location.split("/connect/")[1];
    const shown = await owner.as.query(api.oauth.request, { requestId });
    expect(shown).toMatchObject({
      status: "open",
      clientName: "Claude",
      redirectHost: "claude.ai",
      teams: [
        expect.objectContaining({ name: "Salt House" }),
        expect.objectContaining({ name: "Night Shift" }),
      ],
    });
    expect(await t.query(api.oauth.request, { requestId })).toEqual({ status: "signed-out" });
  });

  test("a code works once, only with its verifier, client and redirect address", async () => {
    const setup = await setUp();
    const { t, team, owner } = setup;
    const client = (await register(t)).body.client_id as string;
    const started = await startSignIn(t, client);
    const { redirectTo } = await owner.as.mutation(api.oauth.decide, {
      requestId: started.location.split("/connect/")[1],
      organizationId: team,
      allow: true,
    });
    const code = new URL(redirectTo).searchParams.get("code")!;
    const wrongVerifier = await exchange(t, {
      grant_type: "authorization_code",
      code,
      code_verifier: "x".repeat(43),
      client_id: client,
      redirect_uri: REDIRECT,
    });
    expect(wrongVerifier).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
    // The failed try used the code up.
    const again = await exchange(t, {
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
      client_id: client,
      redirect_uri: REDIRECT,
    });
    expect(again).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
  });

  test("a refresh token gives new tokens once, and the old ones stop working", async () => {
    const setup = await setUp();
    const { t } = setup;
    const { client, tokens } = await connect(setup);
    const refreshed = await exchange(t, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: client,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.access_token).not.toBe(tokens.access_token);
    expect((await listAutomations(t, tokens.access_token)).status).toBe(401);
    expect((await listAutomations(t, refreshed.body.access_token)).status).toBe(200);
    const reused = await exchange(t, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: client,
    });
    expect(reused.body.error).toBe("invalid_grant");
  });

  test("saying no sends the agent access_denied, and nothing is let in", async () => {
    const { t, team, owner } = await setUp();
    const client = (await register(t)).body.client_id as string;
    const started = await startSignIn(t, client);
    const { redirectTo } = await owner.as.mutation(api.oauth.decide, {
      requestId: started.location.split("/connect/")[1],
      allow: false,
    });
    expect(new URL(redirectTo).searchParams.get("error")).toBe("access_denied");
    expect(await owner.as.query(api.oauth.connections, { organizationId: team })).toEqual([]);
  });

  test("someone cannot let an agent into a team they are not on", async () => {
    const { t, second, member } = await setUp();
    const client = (await register(t)).body.client_id as string;
    const started = await startSignIn(t, client);
    await expect(
      member.as.mutation(api.oauth.decide, {
        requestId: started.location.split("/connect/")[1],
        organizationId: second,
        allow: true,
      }),
    ).rejects.toThrow(/not on this team/);
  });

  test("refuses unknown clients and redirect addresses they did not register", async () => {
    const { t } = await setUp();
    const unknown = await startSignIn(t, "ncat_client_madeup");
    expect(unknown.status).toBe(400);
    const client = (await register(t)).body.client_id as string;
    const elsewhere = await startSignIn(t, client, { redirect_uri: "https://evil.example/cb" });
    expect(elsewhere.status).toBe(400);
    const noPkce = await startSignIn(t, client, { code_challenge_method: "plain" });
    expect(noPkce.status).toBe(302);
    expect(new URL(noPkce.location).searchParams.get("error")).toBe("invalid_request");
    const badRegister = await register(t, ["javascript:alert(1)"]);
    expect(badRegister.status).toBe(400);
  });

  test("a client named by its metadata document address needs no registering", async () => {
    const { t, owner } = await setUp();
    const clientId = "https://claude.ai/oauth/mcp-oauth-client-metadata";
    const fetched = vi.fn(async () =>
      Response.json({ client_id: clientId, client_name: "Claude", redirect_uris: [REDIRECT] }),
    );
    vi.stubGlobal("fetch", fetched);
    const started = await startSignIn(t, clientId);
    expect(started.status).toBe(302);
    expect(fetched).toHaveBeenCalledWith(clientId, expect.anything());
    const shown = await owner.as.query(api.oauth.request, {
      requestId: started.location.split("/connect/")[1],
    });
    expect(shown).toMatchObject({ clientName: "Claude" });
  });
});

describe("disconnecting", () => {
  test("the person disconnects it and its token stops working", async () => {
    const setup = await setUp();
    const { t, team, owner } = setup;
    const { tokens } = await connect(setup);
    const [connection] = await owner.as.query(api.oauth.connections, { organizationId: team });
    await owner.as.mutation(api.oauth.disconnect, {
      organizationId: team,
      grantId: connection.grantId as Id<"oauthGrants">,
    });
    expect((await listAutomations(t, tokens.access_token)).status).toBe(401);
  });

  test("a member sees only their own, and cannot disconnect someone else's", async () => {
    const setup = await setUp();
    const { team, owner, member } = setup;
    await connect(setup);
    expect(await member.as.query(api.oauth.connections, { organizationId: team })).toEqual([]);
    const [connection] = await owner.as.query(api.oauth.connections, { organizationId: team });
    await expect(
      member.as.mutation(api.oauth.disconnect, {
        organizationId: team,
        grantId: connection.grantId,
      }),
    ).rejects.toThrow(/owner or admin/);
  });

  test("leaving the team ends the agent's access", async () => {
    const setup = await setUp();
    const { t, owner } = setup;
    const { tokens } = await connect(setup);
    await t.run((ctx) =>
      ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: { model: "member", where: [{ field: "userId", value: owner.id }] },
        paginationOpts: { numItems: 10, cursor: null },
      } as never),
    );
    expect((await listAutomations(t, tokens.access_token)).status).toBe(401);
  });
});

describe("the sign-in checks", () => {
  test("PKCE S256: only the verifier the challenge was made from matches", async () => {
    expect(await pkceMatches(VERIFIER, CHALLENGE)).toBe(true);
    expect(await pkceMatches(`${VERIFIER}x`, CHALLENGE)).toBe(false);
  });

  test("redirect addresses: https, loopback on any port, app schemes; never script schemes", () => {
    expect(validRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(validRedirectUri("http://localhost:33418/callback")).toBe(true);
    expect(validRedirectUri("cursor://anysphere.cursor-mcp/oauth/callback")).toBe(true);
    expect(validRedirectUri("http://example.com/cb")).toBe(false);
    expect(validRedirectUri("javascript:alert(1)")).toBe(false);
    expect(validRedirectUri("https://x.example/cb#frag")).toBe(false);
    expect(redirectAllowed(["http://127.0.0.1/callback"], "http://127.0.0.1:52000/callback")).toBe(
      true,
    );
    expect(redirectAllowed(["http://127.0.0.1/callback"], "http://127.0.0.1:52000/other")).toBe(
      false,
    );
    expect(redirectAllowed(["https://a.example/cb"], "https://a.example/cb2")).toBe(false);
  });

  test("a metadata document must name itself and list usable redirect addresses", () => {
    const id = "https://app.example/client.json";
    expect(
      readClientMetadata(id, { client_id: "https://other.example/c", redirect_uris: [REDIRECT] })
        .ok,
    ).toBe(false);
    expect(readClientMetadata(id, { client_id: id, redirect_uris: ["javascript:x"] }).ok).toBe(
      false,
    );
    expect(readClientMetadata(id, { client_id: id, redirect_uris: [REDIRECT] })).toMatchObject({
      ok: true,
      client: { name: "app.example" },
    });
  });
});
