import { afterEach, describe, expect, test } from "vitest";

import { api } from "./_generated/api";
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
