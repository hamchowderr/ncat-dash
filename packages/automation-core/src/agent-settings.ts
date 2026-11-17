import { PLATFORMS } from "./clips";

/**
 * A team's settings for the agent: the model it runs on, house rules it always follows,
 * and the platforms it makes clips for when the person does not name any.
 */
export interface AgentSettings {
  /** A model id from AGENT_MODELS, or null for the agent server's own default. */
  model: string | null;
  houseRules: string;
  platforms: string[];
}

/** The models a team can pick. The agent server must also allow each id. */
export const AGENT_MODELS = [
  {
    id: "anthropic/claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    note: "Quick and careful. Right for most teams.",
  },
  {
    id: "anthropic/claude-opus-5-5",
    name: "Claude Opus 5.5",
    note: "The most careful with long automations of many steps. Slower, and costs more.",
  },
  {
    id: "anthropic/claude-haiku-5-5",
    name: "Claude Haiku 5.5",
    note: "The fastest and cheapest. Fine for small changes.",
  },
] as const;

export const MAX_HOUSE_RULES_CHARS = 2000;

export const NO_AGENT_SETTINGS: AgentSettings = { model: null, houseRules: "", platforms: [] };

/** Why these settings cannot be saved, or null when they can. */
export function agentSettingsProblem(settings: AgentSettings): string | null {
  if (settings.model !== null && !AGENT_MODELS.some((model) => model.id === settings.model)) {
    return "Choose one of the models listed.";
  }
  if (settings.houseRules.length > MAX_HOUSE_RULES_CHARS) {
    return `House rules can be at most ${MAX_HOUSE_RULES_CHARS} characters.`;
  }
  const unknown = settings.platforms.find(
    (name) => !PLATFORMS.some((platform) => platform.name === name),
  );
  if (unknown) return `${unknown} is not a platform clips can be made for.`;
  return null;
}

/**
 * What the agent is told about the team's settings at the start of each turn, or nothing
 * when the team has none. Kept byte-for-byte the same while the settings are, so the
 * model's prompt cache keeps working.
 */
export function agentSettingsText(settings: AgentSettings): string | undefined {
  const rules = settings.houseRules.trim();
  const lines: string[] = [];
  if (rules) {
    lines.push(
      "The team's house rules. Follow them in everything you build and say, unless the person asks otherwise in this conversation:",
      rules,
    );
  }
  if (settings.platforms.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(
      `The team's default platforms: ${settings.platforms.join(", ")}. When an automation makes clips and the person did not name platforms, use these without asking, and say which you used. Platforms the person names always win.`,
    );
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}
