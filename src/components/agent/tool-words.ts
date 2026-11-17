import { getNodeType } from "@ncat-dash/automation-core";

/**
 * What the agent's dashboard tools are doing, in plain words. The chat shows these in
 * place of tool names and raw settings, both while a tool runs and when it asks first.
 */
export type ToolWords = {
  /** What the tool is doing, e.g. "Changing the automation". */
  title: string;
  /** The question on the card that asks first. */
  question: string;
  /** What exactly it would do, one line each. */
  lines: string[];
};

type Args = Record<string, unknown> | undefined;

function typeTitle(type: unknown): string {
  if (typeof type !== "string") return "a step";
  return getNodeType(type)?.title ?? getNodeType(`trigger:${type}`)?.title ?? "a step";
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function changeLine(change: Record<string, unknown>): string | null {
  switch (change.op) {
    case "add":
      return `Add the step "${typeof change.label === "string" ? change.label : typeTitle(change.type)}"`;
    case "remove": {
      const ids = Array.isArray(change.ids) ? change.ids.length : 1;
      return `Remove ${count(ids, "step", "steps")}`;
    }
    case "connect":
      return "Join two steps";
    case "disconnect":
      return "Take away the line between two steps";
    case "set": {
      const fields = Object.keys((change.settings as object | undefined) ?? {}).length;
      return `Change ${count(fields, "setting", "settings")} of a step`;
    }
    case "use":
      return "Choose which file a step works on";
    case "rename":
      return typeof change.label === "string"
        ? `Rename a step to "${change.label}"`
        : "Rename a step";
    case "trigger":
      return `Start it with: ${typeTitle((change.trigger as { kind?: unknown } | undefined)?.kind)}`;
    case "name":
      return typeof change.name === "string"
        ? `Rename the automation to "${change.name}"`
        : "Rename the automation";
    case "tidy":
      // Only moves steps around on the canvas; not worth a line.
      return null;
    default:
      return "Make a change";
  }
}

export function toolWords(name: string | undefined, args: unknown): ToolWords | null {
  const given = (args && typeof args === "object" ? args : undefined) as Args;
  switch (name) {
    case "dash_overview":
      return { title: "Looking at your automations", question: "", lines: [] };
    case "describe_automation":
      return { title: "Reading the automation", question: "", lines: [] };
    case "list_step_types":
      return { title: "Checking the steps available", question: "", lines: [] };
    case "change_automation": {
      const changes = Array.isArray(given?.operations) ? given.operations : [];
      const lines = changes
        .map((change) => changeLine((change ?? {}) as Record<string, unknown>))
        .filter((line): line is string => line !== null);
      return {
        title: "Changing the automation",
        question: "Make these changes?",
        lines: lines.length > 0 ? lines : ["Tidy the canvas"],
      };
    }
    case "create_automation":
      return {
        title: "Making a new automation",
        question: "Make a new automation?",
        lines: [
          typeof given?.name === "string" ? `Called "${given.name}", switched off` : "Switched off",
        ],
      };
    case "switch_automation":
      return {
        title: given?.on ? "Switching the automation on" : "Switching the automation off",
        question: given?.on ? "Switch this automation on?" : "Switch this automation off?",
        lines: [
          given?.on
            ? "It will then start by itself, with nobody logged in."
            : "It will stop starting by itself.",
        ],
      };
    default:
      return null;
  }
}

/** What came back, for the person: short facts only, never the raw result. */
export function resultWords(name: string | undefined, result: unknown): string[] {
  const value = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  if (name === "dash_overview") {
    const rows = Array.isArray(value.automations) ? value.automations : [];
    if (rows.length === 0) return ["No automations yet."];
    return rows.map(
      (row: { name?: string; on?: boolean; steps?: number }) =>
        `${row.name ?? "Untitled"}: ${row.on ? "on" : "off"}, ${count(row.steps ?? 0, "step", "steps")}`,
    );
  }
  if (name === "describe_automation" || name === "change_automation") {
    const problems = Array.isArray(value.problems) ? value.problems : [];
    const lines = problems.map((problem) =>
      typeof problem === "string"
        ? problem
        : String((problem as { message?: unknown }).message ?? ""),
    );
    return lines.filter(Boolean).length > 0
      ? ["Still needed before it can run:", ...lines.filter(Boolean)]
      : ["Nothing is stopping it from running."];
  }
  return [];
}
