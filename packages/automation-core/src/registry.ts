/**
 * One description of every kind of node an automation can hold: what starts it, what it
 * takes from the step before, what it hands on, and the settings it needs. The canvas
 * builds its step list from this and the agent reads the same list, so a node added here
 * shows up for both.
 */
import { allSteps, getStep, userInputJsonSchema } from "@ncat-dash/step-catalog";
import type { StepCategory, StepDefinition } from "@ncat-dash/step-catalog";

import { PLATFORMS } from "./clips";
import type { AutomationNode } from "./graph";
import { MIN_INTERVAL_MINUTES } from "./schedule";
import type { StarterTrigger } from "./starters";

/** What moves along a connection. Only files do today; "data" is a step's JSON result. */
export type Carries = "nothing" | "file" | "files" | "data";

export type NodeGroup = "trigger" | "ready-made" | "people" | StepCategory;

export interface JsonSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface NodeType {
  /**
   * Stable name: "trigger:upload", "approval", "clips", or "step:<catalog id>".
   * Never rename one that has shipped.
   */
  type: string;
  role: "trigger" | "action";
  group: NodeGroup;
  title: string;
  /** One or two sentences in plain language. Also what the agent reads to choose a node. */
  description: string;
  /** What it needs from the step before. */
  takes: Carries;
  /** What it hands to the next step. */
  gives: Carries;
  /** JSON Schema of the settings a person or the agent fills in. */
  settings: JsonSchema;
  /** The setting the step before fills in by itself, when there is one. */
  automatic: string | null;
  /** Named text or data it makes for later steps, such as "transcript". */
  makes?: string[];
  /** Settings filled by a named value from an earlier step when left empty. */
  fills?: Record<string, string>;
}

export const GROUP_LABELS: Record<NodeGroup, string> = {
  trigger: "Starts the automation",
  "ready-made": "Ready-made",
  video: "Video",
  audio: "Audio",
  media: "Media",
  image: "Image",
  recipe: "Recipes",
  ffmpeg: "FFmpeg",
  code: "Code",
  storage: "Storage",
  people: "People",
};

/** The order groups are listed in. */
export const GROUP_ORDER: NodeGroup[] = [
  "trigger",
  "ready-made",
  "video",
  "audio",
  "media",
  "image",
  "recipe",
  "ffmpeg",
  "code",
  "storage",
  "people",
];

const fileType = {
  type: "string",
  enum: ["any", "video", "audio", "image"],
  default: "any",
  description: "Only files of this kind start the automation.",
};

const TRIGGERS: NodeType[] = [
  {
    type: "trigger:manual",
    role: "trigger",
    group: "trigger",
    title: "Run by hand",
    description: "Starts only when someone presses Run now, with the file they give it.",
    takes: "nothing",
    gives: "file",
    settings: { type: "object", properties: {} },
    automatic: null,
  },
  {
    type: "trigger:upload",
    role: "trigger",
    group: "trigger",
    title: "New upload",
    description: "Starts by itself each time someone on the team uploads a file.",
    takes: "nothing",
    gives: "file",
    settings: { type: "object", properties: { fileType }, required: ["fileType"] },
    automatic: null,
  },
  {
    type: "trigger:folder",
    role: "trigger",
    group: "trigger",
    title: "Watched folder",
    description:
      "Starts by itself each time a new file lands in a folder of the team's own bucket. Checked every minute.",
    takes: "nothing",
    gives: "file",
    settings: {
      type: "object",
      properties: {
        prefix: {
          type: "string",
          description:
            'The folder to watch, for example "incoming/". Empty watches the whole bucket.',
        },
        fileType,
      },
      required: ["prefix", "fileType"],
    },
    automatic: null,
  },
  {
    type: "trigger:schedule",
    role: "trigger",
    group: "trigger",
    title: "Schedule",
    description: "Starts by itself on a timetable: every so many minutes, or every day at a time.",
    takes: "nothing",
    gives: "nothing",
    settings: {
      type: "object",
      properties: {
        schedule: {
          oneOf: [
            {
              type: "object",
              properties: {
                mode: { const: "interval" },
                minutes: { type: "number", minimum: MIN_INTERVAL_MINUTES },
              },
              required: ["mode", "minutes"],
            },
            {
              type: "object",
              properties: {
                mode: { const: "daily" },
                time: { type: "string", description: "24-hour time, for example 09:30." },
                timeZone: { type: "string", description: "For example America/Los_Angeles." },
              },
              required: ["mode", "time", "timeZone"],
            },
          ],
        },
      },
      required: ["schedule"],
    },
    automatic: null,
  },
  {
    type: "trigger:webhook",
    role: "trigger",
    group: "trigger",
    title: "Webhook",
    description:
      "Starts when another system calls the automation's own address. A file_url in the call becomes the file to work on.",
    takes: "nothing",
    gives: "file",
    settings: { type: "object", properties: {} },
    automatic: null,
  },
];

const APPROVAL: NodeType = {
  type: "approval",
  role: "action",
  group: "people",
  title: "Approval",
  description:
    "Stops the run until someone on the team approves. The files it was shown carry on to the next step.",
  takes: "files",
  gives: "files",
  settings: { type: "object", properties: {} },
  automatic: null,
};

const CLIPS: NodeType = {
  type: "clips",
  role: "action",
  group: "ready-made",
  title: "Clips for a platform",
  description:
    "Cuts each video at pauses in speech into clips that fit a platform's length limit, and reframes them for it.",
  takes: "file",
  gives: "files",
  settings: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        enum: PLATFORMS.map((platform) => platform.name),
        default: "Instagram Reels",
        description: "Where the clips will be posted. Sets the longest clip and the frame.",
      },
    },
    required: ["platform"],
  },
  automatic: null,
};

function gives(step: StepDefinition): Carries {
  return step.output === "json" ? "data" : step.output;
}

function stepType(step: StepDefinition): NodeType {
  return {
    type: `step:${step.id}`,
    role: "action",
    group: step.category,
    title: step.title,
    description: step.description,
    takes: step.listInput ? "files" : step.primaryInput ? "file" : "nothing",
    gives: gives(step),
    settings: userInputJsonSchema(step) as JsonSchema,
    automatic: step.primaryInput ?? step.listInput?.field ?? null,
    ...(step.values ? { makes: Object.keys(step.values) } : {}),
    ...(step.valueInputs
      ? {
          fills: Object.fromEntries(
            Object.entries(step.valueInputs).map(([field, { value }]) => [field, value]),
          ),
        }
      : {}),
  };
}

/** Every node type, triggers first, then in the order the step list shows them. */
export const NODE_TYPES: NodeType[] = [
  ...TRIGGERS,
  CLIPS,
  ...allSteps.map(stepType),
  APPROVAL,
].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));

const byType = new Map(NODE_TYPES.map((nodeType) => [nodeType.type, nodeType]));

export function getNodeType(type: string): NodeType | undefined {
  return byType.get(type);
}

/** The types that can be added as steps, grouped for the step list. */
export function actionTypesByGroup(): { group: NodeGroup; label: string; types: NodeType[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    types: NODE_TYPES.filter((nodeType) => nodeType.role === "action" && nodeType.group === group),
  })).filter((entry) => entry.types.length > 0);
}

/** The registry name of a saved node. */
export function typeNameOf(node: Pick<AutomationNode, "kind" | "stepId">): string {
  return node.kind === "step" ? `step:${node.stepId ?? ""}` : node.kind;
}

export function nodeTypeOf(node: Pick<AutomationNode, "kind" | "stepId">): NodeType | undefined {
  return byType.get(typeNameOf(node));
}

export function triggerTypeOf(trigger: StarterTrigger): NodeType {
  return byType.get(`trigger:${trigger.kind}`)!;
}

/** The saved shape of a node of this type: its kind and, for a toolkit step, the step id. */
export function savedKind(type: string): Pick<AutomationNode, "kind" | "stepId"> | null {
  if (type === "approval" || type === "clips") return { kind: type };
  if (type.startsWith("step:")) {
    const stepId = type.slice("step:".length);
    return getStep(stepId) ? { kind: "step", stepId } : null;
  }
  return null;
}

/** The settings a new node of this type starts with: every default the schema declares. */
export function defaultSettings(nodeType: NodeType): Record<string, unknown> {
  // Toolkit steps apply their own defaults when they run, so a blank stays blank.
  if (nodeType.type.startsWith("step:")) return {};
  const settings: Record<string, unknown> = {};
  for (const [name, property] of Object.entries(nodeType.settings.properties ?? {})) {
    const value = (property as { default?: unknown }).default;
    if (value !== undefined) settings[name] = value;
  }
  return settings;
}

/** Required settings that are still blank and that the step before does not fill in. */
export function missingSettingsOf(nodeType: NodeType, input: Record<string, unknown>): string[] {
  return (nodeType.settings.required ?? []).filter((name) => {
    if (name === nodeType.automatic) return false;
    const value = input[name];
    return value === undefined || value === null || value === "";
  });
}

/**
 * The registry as short text for a model: one line per type with what it takes and gives.
 * The full settings of one type come from `getNodeType(type).settings`.
 */
export function nodeTypeIndex(): string {
  return NODE_TYPES.map(
    (nodeType) =>
      `${nodeType.type} (${GROUP_LABELS[nodeType.group]}; takes ${nodeType.takes}, gives ${nodeType.gives}${
        nodeType.makes ? `, makes ${nodeType.makes.join(" and ")}` : ""
      }${
        nodeType.fills ? `, uses an earlier ${Object.values(nodeType.fills).join(" and ")}` : ""
      }): ${nodeType.title}. ${nodeType.description}`,
  ).join("\n");
}
