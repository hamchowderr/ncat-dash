import { MAX_HOUSE_RULES_CHARS } from "@takewon/automation-core";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Maya Ortiz", [team], "owner");
  const member = await addPerson(t, "Sam Lee", [team]);
  return { t, team, owner, member };
}

describe("the team's agent settings", () => {
  test("start with the server's model, no house rules and no default platforms", async () => {
    const { team, member } = await setUp();
    const settings = await member.as.query(api.teamSettings.get, { organizationId: team });
    expect(settings.agent).toEqual({ model: null, houseRules: "", platforms: [] });
    expect(settings.agentModels.map((model) => model.name)).toContain("Claude Sonnet 5.5");
    expect(settings.mostHouseRules).toBe(MAX_HOUSE_RULES_CHARS);
    expect(await member.as.query(api.teamSettings.agentBrief, { organizationId: team })).toEqual({
      model: null,
      text: null,
    });
  });

  test("are saved by an owner, tidied, and given to the agent for everyone on the team", async () => {
    const { team, owner, member } = await setUp();
    await owner.as.mutation(api.teamSettings.setAgent, {
      organizationId: team,
      agent: {
        model: "anthropic/claude-opus-5-5",
        houseRules: "  Never all capitals.\nClips no longer than 45 seconds.  \n",
        platforms: ["TikTok", "YouTube Shorts", "TikTok"],
      },
    });
    const settings = await member.as.query(api.teamSettings.get, { organizationId: team });
    expect(settings.agent).toEqual({
      model: "anthropic/claude-opus-5-5",
      houseRules: "Never all capitals.\nClips no longer than 45 seconds.",
      platforms: ["TikTok", "YouTube Shorts"],
    });
    expect(settings.canEdit).toBe(false);

    const brief = await member.as.query(api.teamSettings.agentBrief, { organizationId: team });
    expect(brief.model).toBe("anthropic/claude-opus-5-5");
    expect(brief.text).toContain("Never all capitals.");
    expect(brief.text).toContain("TikTok, YouTube Shorts");
  });

  test("keep the rest of the team's settings when changed", async () => {
    const { team, owner } = await setUp();
    await owner.as.mutation(api.teamSettings.setMaxParallelJobs, {
      organizationId: team,
      maxParallelJobs: 3,
    });
    await owner.as.mutation(api.teamSettings.setAgent, {
      organizationId: team,
      agent: { model: null, houseRules: "Be brief.", platforms: [] },
    });
    const settings = await owner.as.query(api.teamSettings.get, { organizationId: team });
    expect(settings.maxParallelJobs).toBe(3);
    expect(settings.agent.houseRules).toBe("Be brief.");
  });

  test("can only be changed by an owner or admin", async () => {
    const { team, member } = await setUp();
    await expect(
      member.as.mutation(api.teamSettings.setAgent, {
        organizationId: team,
        agent: { model: null, houseRules: "Be brief.", platforms: [] },
      }),
    ).rejects.toThrow();
  });

  test("refuse a model the agent cannot use, rules that are too long, and unknown platforms", async () => {
    const { team, owner } = await setUp();
    const set = (agent: { model: string | null; houseRules: string; platforms: string[] }) =>
      owner.as.mutation(api.teamSettings.setAgent, { organizationId: team, agent });
    await expect(set({ model: "openai/gpt-9", houseRules: "", platforms: [] })).rejects.toThrow(
      /model/i,
    );
    await expect(
      set({ model: null, houseRules: "a".repeat(MAX_HOUSE_RULES_CHARS + 1), platforms: [] }),
    ).rejects.toThrow(/house rules/i);
    await expect(set({ model: null, houseRules: "", platforms: ["MySpace"] })).rejects.toThrow(
      /MySpace/,
    );
  });

  test("are not seen by people outside the team", async () => {
    const { t, team } = await setUp();
    const other = await addPerson(t, "Jo Park", [await addTeam(t, "Other team")]);
    await expect(
      other.as.query(api.teamSettings.agentBrief, { organizationId: team }),
    ).rejects.toThrow();
  });
});
