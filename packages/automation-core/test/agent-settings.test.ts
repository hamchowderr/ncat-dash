import { describe, expect, test } from "vitest";

import {
  AGENT_MODELS,
  agentSettingsProblem,
  agentSettingsText,
  MAX_HOUSE_RULES_CHARS,
  NO_AGENT_SETTINGS,
} from "../src";

describe("a team's agent settings", () => {
  test("accept every listed model, the server's own, and known platforms", () => {
    for (const model of [null, ...AGENT_MODELS.map((one) => one.id)]) {
      expect(agentSettingsProblem({ ...NO_AGENT_SETTINGS, model })).toBeNull();
    }
    expect(
      agentSettingsProblem({ model: null, houseRules: "Be brief.", platforms: ["TikTok", "X"] }),
    ).toBeNull();
  });

  test("refuse an unlisted model, rules that are too long, and unknown platforms", () => {
    expect(agentSettingsProblem({ ...NO_AGENT_SETTINGS, model: "openai/gpt-9" })).toMatch(
      /models listed/,
    );
    expect(
      agentSettingsProblem({
        ...NO_AGENT_SETTINGS,
        houseRules: "a".repeat(MAX_HOUSE_RULES_CHARS + 1),
      }),
    ).toMatch(/at most/);
    expect(agentSettingsProblem({ ...NO_AGENT_SETTINGS, platforms: ["MySpace"] })).toBe(
      "MySpace is not a platform clips can be made for.",
    );
  });

  test("tell the agent nothing when the team has set nothing", () => {
    expect(agentSettingsText(NO_AGENT_SETTINGS)).toBeUndefined();
    expect(agentSettingsText({ ...NO_AGENT_SETTINGS, houseRules: "  \n " })).toBeUndefined();
    // The model is not something the agent is told: it is what it runs on.
    expect(agentSettingsText({ ...NO_AGENT_SETTINGS, model: AGENT_MODELS[0].id })).toBeUndefined();
  });

  test("tell the agent the house rules and the default platforms, in that order", () => {
    const text = agentSettingsText({
      model: null,
      houseRules: "Never all capitals.\nClips no longer than 45 seconds.",
      platforms: ["TikTok", "YouTube Shorts"],
    });
    expect(text).toBe(
      [
        "The team's house rules. Follow them in everything you build and say, unless the person asks otherwise in this conversation:",
        "Never all capitals.\nClips no longer than 45 seconds.",
        "",
        "The team's default platforms: TikTok, YouTube Shorts. When an automation makes clips and the person did not name platforms, use these without asking, and say which you used. Platforms the person names always win.",
      ].join("\n"),
    );
  });

  test("tell the agent only the platforms when there are no rules", () => {
    expect(agentSettingsText({ ...NO_AGENT_SETTINGS, platforms: ["LinkedIn"] })).toMatch(
      /^The team's default platforms: LinkedIn\./,
    );
  });
});
