import { makeSignature } from "better-auth/crypto";
import { mcpResource } from "./lib/agentSignIn";
import type { addPerson, backend } from "./test.setup";

/**
 * For tests: signs a person in as an AI agent on one team, the way a real agent does it
 * (register, authorize, pick the team, allow, swap the code), and returns the access
 * token to send to /mcp. Not a function module: the dotted name keeps it out of deploys.
 */

type Backend = ReturnType<typeof backend>;
type Person = Awaited<ReturnType<typeof addPerson>>;

const ORIGIN = "http://localhost:3000";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
// A PKCE pair: the challenge is base64url(SHA-256(verifier)).
const VERIFIER = "dBjftJeZ4CVP-mJ92K9ns3R_3iOIGI9w9U_7Hz0HRvM";
const CHALLENGE = "1RieZWqo-K9gdSrRRuS-3G2913JS22xChv9t6ZUot1M";

async function cookieOf(person: Person) {
  const token = `token-${person.id}`;
  const signature = await makeSignature(token, process.env.BETTER_AUTH_SECRET!);
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

async function asBrowser(t: Backend, person: Person, path: string, body: unknown) {
  const response = await t.fetch(`/api/auth${path}`, {
    method: "POST",
    headers: { cookie: await cookieOf(person), "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify(body),
  });
  if (response.status !== 200) throw new Error(`${path} answered ${response.status}`);
  return (await response.json()) as { url?: string };
}

const queryOf = (location: string) => new URL(location, ORIGIN).search.slice(1);

export async function agentToken(
  t: Backend,
  person: Person,
  organizationId: string,
  clientName = "Claude",
): Promise<string> {
  const registered = await t.fetch("/api/auth/oauth2/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
    }),
  });
  const clientId = ((await registered.json()) as { client_id: string }).client_id;
  const resource = mcpResource();
  const started = await t.fetch(
    `/api/auth/oauth2/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      state: "state",
      scope: "openid offline_access automations",
      resource,
    })}`,
    { headers: { cookie: await cookieOf(person) }, redirect: "manual" },
  );
  const teamPage = started.headers.get("location") ?? "";
  await asBrowser(t, person, "/organization/set-active", { organizationId });
  const consentPage = (
    await asBrowser(t, person, "/oauth2/continue", {
      postLogin: true,
      oauth_query: queryOf(teamPage),
    })
  ).url!;
  const back = new URL(
    (
      await asBrowser(t, person, "/oauth2/consent", {
        accept: true,
        oauth_query: queryOf(consentPage),
      })
    ).url!,
  );
  const exchanged = await t.fetch("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      code_verifier: VERIFIER,
      client_id: clientId,
      redirect_uri: REDIRECT,
      resource,
    }).toString(),
  });
  const tokens = (await exchanged.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error(`No access token: ${JSON.stringify(tokens)}`);
  return tokens.access_token;
}
