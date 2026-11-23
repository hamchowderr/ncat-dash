import { afterEach, describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";
import { fakeToolkitStorage } from "./test.toolkit";

// "No, Not Yet: Just use ours for now": a team without a toolkit is connected to the one
// the operator runs, set with HOSTED_TOOLKIT_URL and HOSTED_TOOLKIT_API_KEY.
let toolkit: ReturnType<typeof fakeToolkitStorage> | null = null;
let current: ReturnType<typeof backend> | null = null;
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await current?.finishInProgressScheduledFunctions();
  current = null;
  toolkit?.restore();
  delete process.env.HOSTED_TOOLKIT_URL;
  delete process.env.HOSTED_TOOLKIT_API_KEY;
});

async function studio() {
  process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
  toolkit = fakeToolkitStorage({});
  const t = backend();
  current = t;
  const team = await addTeam(t, "Okafor Talks");
  const owner = await addPerson(t, "Sam Okafor", [team], "owner");
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  return { t, team, owner, outsider };
}

describe("using our toolkit", () => {
  test("is offered only when its address and key are both set", async () => {
    const { team, owner } = await studio();
    expect(await owner.as.query(api.toolkitConnections.offersOurs, { organizationId: team })).toBe(
      false,
    );
    process.env.HOSTED_TOOLKIT_URL = "https://toolkit.example";
    expect(await owner.as.query(api.toolkitConnections.offersOurs, { organizationId: team })).toBe(
      false,
    );
    process.env.HOSTED_TOOLKIT_API_KEY = "operator-key";
    expect(await owner.as.query(api.toolkitConnections.offersOurs, { organizationId: team })).toBe(
      true,
    );
  });

  test("connects the team to it, tested like any toolkit, without the browser seeing the key", async () => {
    const { t, team, owner } = await studio();
    process.env.HOSTED_TOOLKIT_URL = "https://toolkit.example/";
    process.env.HOSTED_TOOLKIT_API_KEY = "operator-key";
    const result = await owner.as.action(api.toolkitConnections.connectOurs, {
      organizationId: team,
    });
    expect(result).toEqual({ ok: true, buildNumber: "210" });
    const [saved] = await t.run((ctx) => ctx.db.query("toolkitConnections").collect());
    expect(saved.organizationId).toBe(team);
    expect(saved.baseUrl).toBe("https://toolkit.example");
    expect(saved.apiKeyCipher).not.toContain("operator-key");
    const [listed] = await owner.as.query(api.toolkitConnections.list, { organizationId: team });
    expect(JSON.stringify(listed)).not.toContain("operator-key");
  });

  test("saves nothing when it is not set up", async () => {
    const { t, team, owner } = await studio();
    expect(
      await owner.as.action(api.toolkitConnections.connectOurs, { organizationId: team }),
    ).toEqual({ ok: false, reason: "not_offered" });
    expect(await t.run((ctx) => ctx.db.query("toolkitConnections").collect())).toEqual([]);
  });

  test("is refused to people outside the team", async () => {
    const { team, outsider } = await studio();
    process.env.HOSTED_TOOLKIT_URL = "https://toolkit.example";
    process.env.HOSTED_TOOLKIT_API_KEY = "operator-key";
    await expect(
      outsider.as.action(api.toolkitConnections.connectOurs, { organizationId: team }),
    ).rejects.toThrow();
    await expect(
      outsider.as.query(api.toolkitConnections.offersOurs, { organizationId: team }),
    ).rejects.toThrow();
  });
});

// Nobody setting up is asked about a toolkit: a new team goes on ours by itself.
describe("a new team goes on our toolkit by itself", () => {
  test("is connected to it, with nothing to answer", async () => {
    const { t, team, owner } = await studio();
    process.env.HOSTED_TOOLKIT_URL = "https://toolkit.example";
    process.env.HOSTED_TOOLKIT_API_KEY = "operator-key";
    await t.action(internal.toolkitConnections.lendOurs, {
      organizationId: team,
      userId: owner.id,
    });
    const [listed] = await owner.as.query(api.toolkitConnections.list, { organizationId: team });
    expect(listed).toMatchObject({ ours: true, status: "ok", apiKeyHint: "" });
  });

  test("leaves a team that has a toolkit alone, and does nothing when none is lent", async () => {
    const { t, team, owner } = await studio();
    await t.action(internal.toolkitConnections.lendOurs, {
      organizationId: team,
      userId: owner.id,
    });
    expect(await t.run((ctx) => ctx.db.query("toolkitConnections").collect())).toEqual([]);
    process.env.HOSTED_TOOLKIT_URL = "https://toolkit.example";
    process.env.HOSTED_TOOLKIT_API_KEY = "operator-key";
    await owner.as.action(api.toolkitConnections.connectOurs, { organizationId: team });
    const before = await t.run((ctx) => ctx.db.query("toolkitConnections").collect());
    await t.action(internal.toolkitConnections.lendOurs, {
      organizationId: team,
      userId: owner.id,
    });
    expect(await t.run((ctx) => ctx.db.query("toolkitConnections").collect())).toEqual(before);
  });

  test("tries again later when our toolkit does not answer", async () => {
    const { t, team, owner } = await studio();
    process.env.HOSTED_TOOLKIT_URL = "https://down.example";
    process.env.HOSTED_TOOLKIT_API_KEY = "operator-key";
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      new URL(String(input instanceof Request ? input.url : input)).origin ===
      "https://down.example"
        ? Promise.reject(new TypeError("fetch failed"))
        : inner(input, init)) as typeof fetch;
    try {
      await t.action(internal.toolkitConnections.lendOurs, {
        organizationId: team,
        userId: owner.id,
      });
    } finally {
      globalThis.fetch = inner;
    }
    expect(await t.run((ctx) => ctx.db.query("toolkitConnections").collect())).toEqual([]);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((each) => [each.name, each.args[0].attempt])).toContainEqual([
      "toolkitConnections:lendOurs",
      2,
    ]);
  });
});

describe("one toolkit at a time", () => {
  test("its own toolkit replaces ours, and the list says which is which", async () => {
    const { t, team, owner } = await studio();
    process.env.HOSTED_TOOLKIT_URL = "https://ours.example";
    process.env.HOSTED_TOOLKIT_API_KEY = "operator-key";
    await t.run((ctx) =>
      ctx.db.insert("toolkitConnections", {
        organizationId: team,
        baseUrl: "https://ours.example",
        apiKeyCipher: "x",
        apiKeyHint: "-key",
        status: "ok",
        buildNumber: null,
        lastCheckedAt: 1,
        lastError: null,
        createdBy: owner.id,
      }),
    );
    const ownResult = await owner.as.action(api.toolkitConnections.connect, {
      organizationId: team,
      baseUrl: "https://toolkit.example",
      apiKey: "own-key-1234",
    });
    expect(ownResult.ok).toBe(true);
    const listed = await owner.as.query(api.toolkitConnections.list, { organizationId: team });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      ours: false,
      baseUrl: "https://toolkit.example",
      apiKeyHint: "1234",
    });
  });

  test("switching waits while jobs are out on the current toolkit", async () => {
    const { t, team, owner } = await studio();
    const connectionId = await t.run((ctx) =>
      ctx.db.insert("toolkitConnections", {
        organizationId: team,
        baseUrl: "https://old.example",
        apiKeyCipher: "x",
        apiKeyHint: "abcd",
        status: "ok",
        buildNumber: null,
        lastCheckedAt: 1,
        lastError: null,
        createdBy: owner.id,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("jobs", {
        organizationId: team,
        connectionId,
        stepId: "video-trim",
        input: {},
        status: "running",
        webhookToken: "w",
        toolkitJobId: null,
        outputs: [],
        error: null,
        createdBy: owner.id,
        startedAt: null,
        finishedAt: null,
      }),
    );
    const result = await owner.as.action(api.toolkitConnections.connect, {
      organizationId: team,
      baseUrl: "https://toolkit.example",
      apiKey: "own-key",
    });
    expect(result).toMatchObject({ ok: false, reason: "busy" });
    expect(result.ok ? "" : result.detail).toMatch(/1 job is still out/);
    const listed = await owner.as.query(api.toolkitConnections.list, { organizationId: team });
    expect(listed.map((each) => each.baseUrl)).toEqual(["https://old.example"]);
  });
});
