import { makeSignature } from "better-auth/crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, components } from "./_generated/api";
import { fetchClientMetadata, TEAM_CLAIM } from "./lib/agentSignIn";
import { addPerson, addTeam, backend } from "./test.setup";

/**
 * Agents sign in through Better Auth's MCP plugin. These tests drive the whole flow over
 * HTTP, as an agent and the person's browser would: register, authorize, pick a team
 * (/connect/team), allow it (/connect), swap the code, call /mcp, refresh, disconnect.
 */

type Backend = ReturnType<typeof backend>;
type Person = Awaited<ReturnType<typeof addPerson>>;

const SITE = "https://dash-api.example.site";
const RESOURCE = `${SITE}/mcp`;
const ISSUER = "http://localhost:3000/api/auth";
const ORIGIN = "http://localhost:3000";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
// A PKCE pair: the challenge is base64url(SHA-256(verifier)).
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
type Setup = Awaited<ReturnType<typeof setUp>>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** The signed session cookie the person's browser sends (addPerson's session). */
async function cookieOf(person: Person) {
  const token = `token-${person.id}`;
  const signature = await makeSignature(token, process.env.BETTER_AUTH_SECRET!);
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

/** A call from the person's browser on the dashboard. */
async function asBrowser(t: Backend, person: Person, path: string, body: unknown) {
  const response = await t.fetch(`/api/auth${path}`, {
    method: "POST",
    headers: { cookie: await cookieOf(person), "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function register(t: Backend, redirectUris = [REDIRECT]) {
  const response = await t.fetch("/api/auth/oauth2/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude",
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
    }),
  });
  return { status: response.status, body: await response.json() };
}

function authorizePath(clientId: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "state-123",
    scope: "openid offline_access automations",
    resource: RESOURCE,
    ...extra,
  });
  return `/api/auth/oauth2/authorize?${params}`;
}

/** The agent sends the signed-in person's browser to sign in. */
async function startSignIn(
  t: Backend,
  person: Person,
  clientId: string,
  extra: Record<string, string> = {},
) {
  const response = await t.fetch(authorizePath(clientId, extra), {
    headers: { cookie: await cookieOf(person) },
    redirect: "manual",
  });
  return { status: response.status, location: response.headers.get("location") ?? "" };
}

const queryOf = (location: string) => new URL(location, ORIGIN).search.slice(1);

/** /connect/team: the person picks a team, and the sign-in carries on to /connect. */
async function pickTeam(t: Backend, person: Person, teamPage: string, organizationId: string) {
  const picked = await asBrowser(t, person, "/organization/set-active", { organizationId });
  if (picked.status !== 200) return { status: picked.status, url: "" };
  const next = await asBrowser(t, person, "/oauth2/continue", {
    postLogin: true,
    oauth_query: queryOf(teamPage),
  });
  return { status: next.status, url: (next.body.url as string) ?? "" };
}

/** /connect: the person allows the agent (or not), and is sent back to it. */
async function decide(t: Backend, person: Person, consentPage: string, accept: boolean) {
  const decided = await asBrowser(t, person, "/oauth2/consent", {
    accept,
    oauth_query: queryOf(consentPage),
  });
  return new URL(decided.body.url as string);
}

async function exchange(t: Backend, fields: Record<string, string>) {
  const response = await t.fetch("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: response.status, body: await response.json() };
}

/** Registers, signs in as the owner on the team, and swaps the code for tokens. */
async function connect(setup: Setup, person: Person = setup.owner) {
  const { t, team } = setup;
  const client = (await register(t)).body.client_id as string;
  const started = await startSignIn(t, person, client);
  const consentPage = (await pickTeam(t, person, started.location, team)).url;
  const back = await decide(t, person, consentPage, true);
  const code = back.searchParams.get("code")!;
  const tokens = await exchange(t, {
    grant_type: "authorization_code",
    code,
    code_verifier: VERIFIER,
    client_id: client,
    redirect_uri: REDIRECT,
    resource: RESOURCE,
  });
  return { client, back, code, tokens: tokens.body };
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

function claimsOf(jwt: string) {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
}

async function leaveAllTeams(t: Backend, person: Person) {
  await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: { model: "member", where: [{ field: "userId", value: person.id }] },
      paginationOpts: { numItems: 10, cursor: null },
    } as never),
  );
}

describe("how an agent finds out how to sign in", () => {
  test("a request without a token gets 401 naming the resource metadata", async () => {
    const { t } = await setUp();
    const response = await t.fetch("/mcp", { method: "POST", body: "{}" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="${SITE}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  test("MCP_ORIGIN gives the MCP server its own domain in the challenge and the metadata", async () => {
    const { t } = await setUp();
    process.env.MCP_ORIGIN = "https://mcp.example.com/";
    try {
      const response = await t.fetch("/mcp", { method: "POST", body: "{}" });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
      );
      const resource = await (await t.fetch("/.well-known/oauth-protected-resource/mcp")).json();
      expect(resource).toMatchObject({
        resource: "https://mcp.example.com/mcp",
        authorization_servers: [ISSUER],
      });
    } finally {
      delete process.env.MCP_ORIGIN;
    }
  });

  test("a token that is not a key or a good access token gets 401 too", async () => {
    const { t } = await setUp();
    expect((await listAutomations(t, "madeup")).status).toBe(401);
  });

  test("the metadata points from the MCP address to Better Auth's sign-in", async () => {
    const { t } = await setUp();
    for (const path of [
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource",
    ]) {
      const resource = await (await t.fetch(path)).json();
      expect(resource).toMatchObject({ resource: RESOURCE, authorization_servers: [ISSUER] });
    }
    for (const path of [
      "/.well-known/oauth-authorization-server",
      "/api/auth/.well-known/openid-configuration",
    ]) {
      const server = await (await t.fetch(path)).json();
      expect(server).toMatchObject({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth2/authorize`,
        token_endpoint: `${ISSUER}/oauth2/token`,
        registration_endpoint: `${ISSUER}/oauth2/register`,
        code_challenge_methods_supported: ["S256"],
        client_id_metadata_document_supported: true,
      });
    }
  });
});

describe("a copy being set up", () => {
  test("without SITE_URL yet, the backend still answers, and agents' sign-in names it", async () => {
    const { t } = await setUp();
    vi.stubEnv("SITE_URL", "");
    expect((await t.fetch("/automations/hook", { method: "POST" })).status).toBe(400);
    const server = await (await t.fetch("/.well-known/oauth-authorization-server")).json();
    expect(server.issuer).toBe(`${SITE}/api/auth`);
  });
});

describe("signing an agent in", () => {
  test("register, pick a team, allow, swap the code, and work as that person on that team", async () => {
    const setup = await setUp();
    const { t, team, owner } = setup;
    const client = (await register(t)).body.client_id as string;

    const started = await startSignIn(t, owner, client);
    expect(started.status).toBe(302);
    expect(started.location).toMatch(/^\/connect\/team\?/);

    const picked = await pickTeam(t, owner, started.location, team);
    expect(picked.url).toMatch(/^\/connect\?/);

    const back = await decide(t, owner, picked.url, true);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("state-123");
    expect(back.searchParams.get("iss")).toBe(ISSUER);

    const { body: tokens } = await exchange(t, {
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      code_verifier: VERIFIER,
      client_id: client,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
    });
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect(tokens.refresh_token).toEqual(expect.any(String));
    expect(claimsOf(tokens.access_token)).toMatchObject({
      sub: owner.id,
      aud: expect.arrayContaining([RESOURCE]),
      [TEAM_CLAIM]: team,
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

  test("the team picked is the one the token works on", async () => {
    const setup = await setUp();
    const { t, second, owner } = setup;
    const client = (await register(t)).body.client_id as string;
    const started = await startSignIn(t, owner, client);
    const consentPage = (await pickTeam(t, owner, started.location, second)).url;
    const back = await decide(t, owner, consentPage, true);
    const { body: tokens } = await exchange(t, {
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      code_verifier: VERIFIER,
      client_id: client,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
    });
    expect(claimsOf(tokens.access_token)[TEAM_CLAIM]).toBe(second);
    // Night Shift has no automations; Salt House's are not visible on it.
    const listed = await (await listAutomations(t, tokens.access_token)).json();
    expect(JSON.parse(listed.result.content[0].text)).toEqual([]);
  });

  test("a code works once, and only with its verifier", async () => {
    const setup = await setUp();
    const { t, team, owner } = setup;
    const client = (await register(t)).body.client_id as string;
    const started = await startSignIn(t, owner, client);
    const back = await decide(
      t,
      owner,
      (await pickTeam(t, owner, started.location, team)).url,
      true,
    );
    const code = back.searchParams.get("code")!;
    const fields = {
      grant_type: "authorization_code",
      code,
      client_id: client,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
    };
    expect((await exchange(t, { ...fields, code_verifier: "x".repeat(43) })).status).toBe(400);
    const { code: second } = await connect(setup);
    expect((await exchange(t, { ...fields, code: second, code_verifier: VERIFIER })).status).toBe(
      400,
    );
  });

  test("a refresh token gives new tokens once; using it again ends the connection", async () => {
    const setup = await setUp();
    const { t, team, owner } = setup;
    const { client, tokens } = await connect(setup);
    const refresh = (refresh_token: string) =>
      exchange(t, {
        grant_type: "refresh_token",
        refresh_token,
        client_id: client,
        resource: RESOURCE,
      });

    const fresh = await refresh(tokens.refresh_token);
    expect(fresh.status).toBe(200);
    expect(fresh.body.refresh_token).not.toBe(tokens.refresh_token);

    // A replayed refresh token (stolen, or copied) is refused, and the family it came
    // from goes with it: the fresh one stops working too.
    expect((await refresh(tokens.refresh_token)).body.error).toBe("invalid_grant");
    expect((await refresh(fresh.body.refresh_token)).body.error).toBe("invalid_grant");
    expect(await owner.as.query(api.oauth.connections, { organizationId: team })).toHaveLength(1);
  });

  test("a refresh for someone who left the team is refused", async () => {
    const setup = await setUp();
    const { t, owner } = setup;
    const { client, tokens } = await connect(setup);
    await leaveAllTeams(t, owner);
    const refreshed = await exchange(t, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: client,
      resource: RESOURCE,
    });
    expect(refreshed.status).not.toBe(200);
    expect(refreshed.body.access_token).toBeUndefined();
  });

  test("saying no sends the agent access_denied, and nothing is let in", async () => {
    const { t, team, owner } = await setUp();
    const client = (await register(t)).body.client_id as string;
    const started = await startSignIn(t, owner, client);
    const back = await decide(
      t,
      owner,
      (await pickTeam(t, owner, started.location, team)).url,
      false,
    );
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("code")).toBeNull();
    expect(await owner.as.query(api.oauth.connections, { organizationId: team })).toEqual([]);
  });

  test("someone cannot let an agent into a team they are not on", async () => {
    const { t, second, member } = await setUp();
    const client = (await register(t)).body.client_id as string;
    const started = await startSignIn(t, member, client);
    const picked = await pickTeam(t, member, started.location, second);
    expect(picked.status).not.toBe(200);
    // Without a team of theirs picked, carrying on just asks for a team again.
    const next = await asBrowser(t, member, "/oauth2/continue", {
      postLogin: true,
      oauth_query: queryOf(started.location),
    });
    expect(next.body.url ?? "").not.toMatch(/^\/connect\?|code=/);
  });

  test("refuses unknown clients and redirect addresses they did not register", async () => {
    const { t, owner } = await setUp();
    const unknown = await startSignIn(t, owner, "madeup-client");
    expect(unknown.location).not.toMatch(/^\/connect/);
    const client = (await register(t)).body.client_id as string;
    const elsewhere = await startSignIn(t, owner, client, {
      redirect_uri: "https://evil.example/cb",
    });
    expect(elsewhere.location).not.toMatch(/^(\/connect|https:\/\/evil\.example)/);
    const badRegister = await register(t, ["javascript:alert(1)"]);
    expect(badRegister.status).toBe(400);
  });

  test("a client named by its metadata document address needs no registering", async () => {
    const { t, owner } = await setUp();
    const clientId = "https://claude.ai/oauth/mcp-oauth-client-metadata";
    const fetched = vi.fn(async () =>
      Response.json({
        client_id: clientId,
        client_name: "Claude",
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    );
    vi.stubGlobal("fetch", fetched);
    const started = await startSignIn(t, owner, clientId);
    expect(started.location).toMatch(/^\/connect\/team\?/);
    expect(fetched).toHaveBeenCalled();
    expect(String((fetched.mock.calls[0] as unknown[])[0])).toBe(clientId);
  });
});

describe("fetching a client's metadata document", () => {
  test("only https, never a private address, never following a redirect, and small", async () => {
    // As on the hosted edition, which refuses private addresses (lib/outbound.ts).
    vi.stubEnv("OUTBOUND_PRIVATE", "block");
    await expect(fetchClientMetadata("http://claude.ai/meta")).rejects.toThrow(/https/);
    await expect(fetchClientMetadata("https://127.0.0.1/meta")).rejects.toThrow(/private/);
    await expect(fetchClientMetadata("https://10.0.0.5/meta")).rejects.toThrow(/private/);
    await expect(fetchClientMetadata("https://claude.ai/meta", { method: "POST" })).rejects.toThrow(
      /GET/,
    );

    const seen = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return new Response("x".repeat(70 * 1024));
    });
    vi.stubGlobal("fetch", seen);
    await expect(fetchClientMetadata("https://claude.ai/meta")).rejects.toThrow(/too large/);
    expect(seen).toHaveBeenCalledTimes(1);

    vi.stubGlobal("fetch", async () => Response.json({ client_id: "https://claude.ai/meta" }));
    const ok = await fetchClientMetadata("https://claude.ai/meta");
    expect(await ok.json()).toEqual({ client_id: "https://claude.ai/meta" });
  });
});

describe("disconnecting", () => {
  test("the person disconnects it, its token stops working, and its refresh token too", async () => {
    const setup = await setUp();
    const { t, team, owner } = setup;
    const { client, tokens } = await connect(setup);
    const [connection] = await owner.as.query(api.oauth.connections, { organizationId: team });
    await owner.as.mutation(api.oauth.disconnect, {
      organizationId: team,
      grantId: connection.grantId,
    });
    expect((await listAutomations(t, tokens.access_token)).status).toBe(401);
    const refreshed = await exchange(t, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: client,
      resource: RESOURCE,
    });
    expect(refreshed.body.access_token).toBeUndefined();
    expect(await owner.as.query(api.oauth.connections, { organizationId: team })).toEqual([]);
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

  test("a manager sees everyone's, and can disconnect a member's", async () => {
    const setup = await setUp();
    const { t, team, owner, member } = setup;
    const { tokens } = await connect(setup, member);
    const [connection] = await owner.as.query(api.oauth.connections, { organizationId: team });
    expect(connection).toMatchObject({ person: "Theo Banks", mine: false });
    await owner.as.mutation(api.oauth.disconnect, {
      organizationId: team,
      grantId: connection.grantId,
    });
    expect((await listAutomations(t, tokens.access_token)).status).toBe(401);
  });

  test("leaving the team ends the agent's access", async () => {
    const setup = await setUp();
    const { t, owner } = setup;
    const { tokens } = await connect(setup);
    await leaveAllTeams(t, owner);
    expect((await listAutomations(t, tokens.access_token)).status).toBe(401);
  });
});
