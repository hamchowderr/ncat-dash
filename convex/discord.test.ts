import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

// The dashboard's one Discord bot: an owner adds it to the team's Discord server from
// Settings, each member links their own Discord account, and the agent server, holding
// the shared secret, finds who wrote in which server and acts as them.

const SECRET = "the-agent-shared-secret-of-at-least-32-chars";

type DiscordUser = { id: string; username: string; global_name?: string };
let codes: Record<string, { user: DiscordUser; guild?: { id: string; name: string } }> = {};

beforeEach(() => {
  process.env.MASTRA_JWT_SECRET = SECRET;
  process.env.DISCORD_CLIENT_ID = "1300000000000000001";
  process.env.DISCORD_CLIENT_SECRET = "a-discord-client-secret";
  process.env.DISCORD_API_URL = "https://discord.test/api";
  process.env.CONVEX_SITE_URL = "https://site.test";
  codes = {};
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://discord.test/api/oauth2/token") {
      const form = new URLSearchParams(String(init?.body ?? ""));
      const found = codes[form.get("code") ?? ""];
      if (!found || form.get("client_secret") !== "a-discord-client-secret") {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      return Response.json({
        access_token: `access-${form.get("code")}`,
        ...(found.guild ? { guild: found.guild } : {}),
      });
    }
    if (url === "https://discord.test/api/users/@me") {
      const token = String(new Headers(init?.headers).get("authorization")).replace(
        "Bearer access-",
        "",
      );
      const found = codes[token];
      return found ? Response.json(found.user) : new Response("no", { status: 401 });
    }
    return new Response("unknown", { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of [
    "MASTRA_JWT_SECRET",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_API_URL",
    "CONVEX_SITE_URL",
  ]) {
    delete process.env[key];
  }
});

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Jordan Lee", [team], "owner");
  const member = await addPerson(t, "Maya Ortiz", [team], "member");
  return { t, team, owner, member };
}

/** Plays Discord: the person signs in, and Discord sends them back with a code. */
async function comeBack(
  t: ReturnType<typeof backend>,
  startUrl: string,
  code: string,
  found: { user: DiscordUser; guild?: { id: string; name: string } },
) {
  codes[code] = found;
  const state = new URL(startUrl).searchParams.get("state");
  const back = await t.fetch(
    `/discord/callback?code=${code}&state=${state}${found.guild ? `&guild_id=${found.guild.id}` : ""}`,
    { method: "GET" },
  );
  expect(back.status).toBe(302);
  return new URL(back.headers.get("location") ?? "").searchParams.get("discord");
}

function base64url(value: string | Uint8Array) {
  return Buffer.from(value).toString("base64url");
}

async function agentToken(secret = SECRET) {
  const iat = Math.floor(Date.now() / 1000);
  const body = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({ sub: "agent-server", iat, exp: iat + 300 }),
  )}`;
  const { createHmac } = await import("node:crypto");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

async function askPerson(
  t: ReturnType<typeof backend>,
  body: object,
  authorization: string | null = null,
) {
  return await t.fetch("/discord/person", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: authorization ?? `Bearer ${await agentToken()}`,
    },
    body: JSON.stringify(body),
  });
}

const JORDAN = { id: "200000000000000001", username: "jordan", global_name: "Jordan" };
const MAYA = { id: "200000000000000002", username: "maya.o" };
const SERVER = { id: "300000000000000001", name: "Salt House Crew" };

describe("adding the bot to a team's Discord server", () => {
  test("an owner adds it; Settings shows the server and their own linked account", async () => {
    const { t, team, owner, member } = await setUp();
    const url = await owner.as.mutation(api.discord.startLink, {
      organizationId: team,
      kind: "server",
    });
    const asked = new URL(url);
    expect(asked.searchParams.get("client_id")).toBe("1300000000000000001");
    expect(asked.searchParams.get("scope")).toBe("identify bot applications.commands");
    expect(asked.searchParams.get("redirect_uri")).toBe("https://site.test/discord/callback");

    expect(await comeBack(t, url, "c1", { user: JORDAN, guild: SERVER })).toBe("added");

    const shown = await member.as.query(api.discord.forTeam, { organizationId: team });
    expect(shown).toMatchObject({
      ready: true,
      canEdit: false,
      me: null,
      linkedCount: 1,
      servers: [{ guildName: "Salt House Crew", addedBy: "Jordan Lee" }],
    });
    expect(await owner.as.query(api.discord.forTeam, { organizationId: team })).toMatchObject({
      canEdit: true,
      me: { discordName: "Jordan" },
    });
  });

  test("a member cannot add it, but can link their own account", async () => {
    const { t, team, member } = await setUp();
    await expect(
      member.as.mutation(api.discord.startLink, { organizationId: team, kind: "server" }),
    ).rejects.toThrow(/owner or admin/);
    const url = await member.as.mutation(api.discord.startLink, {
      organizationId: team,
      kind: "person",
    });
    expect(new URL(url).searchParams.get("scope")).toBe("identify");
    expect(await comeBack(t, url, "c2", { user: MAYA })).toBe("linked");
    expect(await member.as.query(api.discord.forTeam, { organizationId: team })).toMatchObject({
      me: { discordName: "maya.o" },
    });
  });

  test("a server one team has cannot be taken by another", async () => {
    const { t, team, owner } = await setUp();
    const first = await owner.as.mutation(api.discord.startLink, {
      organizationId: team,
      kind: "server",
    });
    await comeBack(t, first, "c3", { user: JORDAN, guild: SERVER });
    const other = await addTeam(t, "Harbor Lane");
    const rival = await addPerson(t, "Riley Park", [other], "owner");
    const second = await rival.as.mutation(api.discord.startLink, {
      organizationId: other,
      kind: "server",
    });
    expect(
      await comeBack(t, second, "c4", {
        user: { id: "200000000000000009", username: "riley" },
        guild: SERVER,
      }),
    ).toBe("taken");
  });

  test("a sign-in can be used once, and a made-up one is refused", async () => {
    const { t, team, member } = await setUp();
    const url = await member.as.mutation(api.discord.startLink, {
      organizationId: team,
      kind: "person",
    });
    expect(await comeBack(t, url, "c5", { user: MAYA })).toBe("linked");
    expect(await comeBack(t, url, "c6", { user: MAYA })).toBe("expired");
    const madeUp = await t.fetch("/discord/callback?code=c7&state=nope", { method: "GET" });
    expect(new URL(madeUp.headers.get("location") ?? "").searchParams.get("discord")).toBe(
      "expired",
    );
  });

  test("without a bot set up, Settings says so and nothing starts", async () => {
    const { team, owner } = await setUp();
    delete process.env.DISCORD_CLIENT_SECRET;
    expect(await owner.as.query(api.discord.forTeam, { organizationId: team })).toMatchObject({
      ready: false,
    });
    await expect(
      owner.as.mutation(api.discord.startLink, { organizationId: team, kind: "person" }),
    ).rejects.toThrow(/not set up/);
  });

  test("removing the server and unlinking forget them", async () => {
    const { t, team, owner } = await setUp();
    const url = await owner.as.mutation(api.discord.startLink, {
      organizationId: team,
      kind: "server",
    });
    await comeBack(t, url, "c8", { user: JORDAN, guild: SERVER });
    await owner.as.mutation(api.discord.removeServer, { organizationId: team, guildId: SERVER.id });
    await owner.as.mutation(api.discord.unlinkMe, { organizationId: team });
    expect(await owner.as.query(api.discord.forTeam, { organizationId: team })).toMatchObject({
      servers: [],
      me: null,
    });
  });
});

describe("who the agent server is told wrote", () => {
  test("only a caller with the shared secret is answered", async () => {
    const { t } = await setUp();
    const wrong = await askPerson(
      t,
      { guildId: SERVER.id, discordUserId: JORDAN.id },
      `Bearer ${await agentToken("a-different-secret-of-32-characters!")}`,
    );
    expect(wrong.status).toBe(401);
  });

  test("a linked member in the team's server gets a sign-in that acts as them", async () => {
    const { t, team, owner } = await setUp();
    const url = await owner.as.mutation(api.discord.startLink, {
      organizationId: team,
      kind: "server",
    });
    await comeBack(t, url, "c9", { user: JORDAN, guild: SERVER });
    const found = await (
      await askPerson(t, { guildId: SERVER.id, discordUserId: JORDAN.id })
    ).json();
    expect(found).toMatchObject({ ok: true, name: "Jordan Lee", organizationId: team });
    expect(typeof found.convexToken).toBe("string");

    // A direct message works too, for someone linked to one team.
    expect(
      await (await askPerson(t, { guildId: "@me", discordUserId: JORDAN.id })).json(),
    ).toMatchObject({ ok: true, organizationId: team });
  });

  test("someone not linked, or a server no team added, is told why", async () => {
    const { t, team, owner } = await setUp();
    const url = await owner.as.mutation(api.discord.startLink, {
      organizationId: team,
      kind: "server",
    });
    await comeBack(t, url, "c10", { user: JORDAN, guild: SERVER });
    expect(
      await (await askPerson(t, { guildId: SERVER.id, discordUserId: MAYA.id })).json(),
    ).toEqual({ ok: false, reason: "not_linked" });
    expect(
      await (
        await askPerson(t, { guildId: "300000000000000099", discordUserId: JORDAN.id })
      ).json(),
    ).toEqual({ ok: false, reason: "not_connected" });
  });
});
