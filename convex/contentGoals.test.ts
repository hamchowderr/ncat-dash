import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

async function setUp({ toolkit = true } = {}) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Maya Ortiz", [team], "owner");
  const member = await addPerson(t, "Sam Lee", [team]);
  const stranger = await addPerson(t, "Ana Cruz");
  if (toolkit) {
    await t.run(async (ctx) => {
      await ctx.db.insert("toolkitConnections", {
        organizationId: team,
        baseUrl: "https://toolkit.example",
        apiKeyCipher: "x",
        apiKeyHint: "1234",
        status: "ok",
        buildNumber: "204",
        lastCheckedAt: Date.now(),
        lastError: null,
        storage: { bucket: "media", endpoint: null, publicUrl: null },
        createdBy: owner.id,
      });
    });
  }
  return { t, team, owner, member, stranger };
}

describe("what a team makes", () => {
  test("starts unanswered, with the agent's platforms read back as apps", async () => {
    const { team, owner } = await setUp();
    expect(await owner.as.query(api.contentGoals.get, { organizationId: team })).toEqual({
      kinds: [],
      apps: [],
      answered: false,
      canEdit: true,
    });
    await owner.as.mutation(api.teamSettings.setAgent, {
      organizationId: team,
      agent: { model: null, houseRules: "", platforms: ["TikTok", "LinkedIn"] },
    });
    const goals = await owner.as.query(api.contentGoals.get, { organizationId: team });
    expect(goals.apps).toEqual(["tiktok", "linkedin"]);
  });

  test("is saved in order, becomes the agent's platforms and makes new files searchable", async () => {
    const { t, team, owner, member } = await setUp();
    await owner.as.mutation(api.teamSettings.setAgent, {
      organizationId: team,
      agent: { model: "anthropic/claude-opus-5-5", houseRules: "Be brief.", platforms: [] },
    });
    await owner.as.mutation(api.contentGoals.save, {
      organizationId: team,
      kinds: ["podcast", "coaching", "podcast"],
      apps: ["youtube", "instagram"],
    });
    const goals = await member.as.query(api.contentGoals.get, { organizationId: team });
    expect(goals).toMatchObject({
      kinds: ["coaching", "podcast"],
      apps: ["instagram", "youtube"],
      answered: true,
      canEdit: false,
    });
    const settings = await member.as.query(api.teamSettings.get, { organizationId: team });
    // Model and house rules are kept; only the platforms change.
    expect(settings.agent).toEqual({
      model: "anthropic/claude-opus-5-5",
      houseRules: "Be brief.",
      platforms: ["Instagram Reels", "YouTube Shorts"],
    });
    const library = await t.run((ctx) =>
      ctx.db
        .query("librarySettings")
        .withIndex("by_organization", (q) => q.eq("organizationId", team))
        .first(),
    );
    expect(library?.searchNewFiles).toBe(true);
  });

  test("leaves the agent's platforms and searching alone when answered again", async () => {
    const { t, team, owner } = await setUp();
    await owner.as.mutation(api.contentGoals.save, {
      organizationId: team,
      kinds: ["music"],
      apps: ["tiktok"],
    });
    await owner.as.mutation(api.library.setSearchNewFiles, { organizationId: team, on: false });
    await owner.as.mutation(api.contentGoals.save, {
      organizationId: team,
      kinds: ["music", "streams"],
      apps: [],
    });
    const settings = await owner.as.query(api.teamSettings.get, { organizationId: team });
    expect(settings.agent.platforms).toEqual(["TikTok"]);
    const library = await t.run((ctx) =>
      ctx.db
        .query("librarySettings")
        .withIndex("by_organization", (q) => q.eq("organizationId", team))
        .first(),
    );
    expect(library?.searchNewFiles).toBe(false);
  });

  test("refuses no kinds, unknown kinds and unknown apps", async () => {
    const { team, owner } = await setUp();
    const save = (kinds: string[], apps: string[]) =>
      owner.as.mutation(api.contentGoals.save, { organizationId: team, kinds, apps });
    await expect(save([], ["tiktok"])).rejects.toThrow(/at least one/);
    await expect(save(["juggling"], [])).rejects.toThrow(/not one we know/);
    await expect(save(["podcast"], ["myspace"])).rejects.toThrow(/app/);
  });

  test("is answered only by an owner or admin, and only on their own team", async () => {
    const { team, member, stranger } = await setUp();
    const args = { organizationId: team, kinds: ["podcast"], apps: [] };
    await expect(member.as.mutation(api.contentGoals.save, args)).rejects.toThrow();
    await expect(stranger.as.mutation(api.contentGoals.save, args)).rejects.toThrow();
    await expect(
      stranger.as.query(api.contentGoals.get, { organizationId: team }),
    ).rejects.toThrow();
  });
});

describe("turning on the ready-made automations that fit", () => {
  test("makes each one for the first app picked and switches it on", async () => {
    const { t, team, owner } = await setUp();
    await owner.as.mutation(api.contentGoals.save, {
      organizationId: team,
      kinds: ["coaching"],
      apps: ["tiktok", "instagram"],
    });
    const made = await owner.as.mutation(api.contentGoals.turnOn, {
      organizationId: team,
      starterIds: ["coaching-session-pack", "recording-pack"],
    });
    expect(made.map((each) => [each.name, each.on, each.problem])).toEqual([
      ["Coaching session pack", true, null],
      ["Sermon, webinar or lecture pack", true, null],
    ]);
    const pack = await t.run((ctx) => ctx.db.get(made[0].automationId!));
    // Instagram is listed before TikTok, so Instagram's placement comes first.
    expect(pack?.nodes.find((node) => node.kind === "moments")?.input.platform).toBe(
      "Instagram Reels",
    );
    expect(pack?.enabled).toBe(true);
    const versions = await t.run((ctx) =>
      ctx.db
        .query("automationVersions")
        .withIndex("by_automation_and_number", (q) => q.eq("automationId", made[0].automationId!))
        .collect(),
    );
    expect(versions).toHaveLength(1);
  });

  test("uses the app picked for clips", async () => {
    const { t, team, owner } = await setUp();
    await owner.as.mutation(api.contentGoals.save, {
      organizationId: team,
      kinds: ["podcast"],
      apps: ["linkedin"],
    });
    const [made] = await owner.as.mutation(api.contentGoals.turnOn, {
      organizationId: team,
      starterIds: ["clips-follow-speaker"],
    });
    const automation = await t.run((ctx) => ctx.db.get(made.automationId!));
    expect(automation?.nodes.find((node) => node.kind === "clips")?.input.platform).toBe(
      "LinkedIn",
    );
  });

  test("leaves one that needs the brand off, saying what it needs", async () => {
    const { team, owner } = await setUp();
    const [made] = await owner.as.mutation(api.contentGoals.turnOn, {
      organizationId: team,
      starterIds: ["branded-clip"],
    });
    expect(made.on).toBe(false);
    expect(made.automationId).not.toBeNull();
    expect(made.problem).toMatch(/logo/i);
  });

  test("leaves them off until the toolkit is connected", async () => {
    const { team, owner } = await setUp({ toolkit: false });
    const [made] = await owner.as.mutation(api.contentGoals.turnOn, {
      organizationId: team,
      starterIds: ["podcast-master"],
    });
    expect(made.on).toBe(false);
    expect(made.problem).toMatch(/toolkit/i);
  });

  test("does not make one the team already has", async () => {
    const { t, team, owner } = await setUp();
    const first = await owner.as.mutation(api.contentGoals.turnOn, {
      organizationId: team,
      starterIds: ["podcast-master"],
    });
    const again = await owner.as.mutation(api.contentGoals.turnOn, {
      organizationId: team,
      starterIds: ["podcast-master", "podcast-master"],
    });
    expect(again).toHaveLength(1);
    expect(again[0].automationId).toBe(first[0].automationId);
    const all = await t.run((ctx) =>
      ctx.db
        .query("automations")
        .withIndex("by_organization", (q) => q.eq("organizationId", team))
        .collect(),
    );
    expect(all).toHaveLength(1);
  });

  test("refuses unknown ready-mades and people outside the team", async () => {
    const { team, owner, stranger } = await setUp();
    await expect(
      owner.as.mutation(api.contentGoals.turnOn, { organizationId: team, starterIds: ["nope"] }),
    ).rejects.toThrow(/Unknown/);
    await expect(
      stranger.as.mutation(api.contentGoals.turnOn, {
        organizationId: team,
        starterIds: ["podcast-master"],
      }),
    ).rejects.toThrow();
  });
});
