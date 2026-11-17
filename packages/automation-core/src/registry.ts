/**
 * One description of every kind of node an automation can hold: what starts it, what it
 * takes from the step before, what it hands on, and the settings it needs. The canvas
 * builds its step list from this and the agent reads the same list, so a node added here
 * shows up for both.
 */
import { allSteps, getStep, userInputJsonSchema } from "@ncat-dash/step-catalog";
import type { StepCategory, StepDefinition } from "@ncat-dash/step-catalog";

import type { Brand, BrandKey } from "./brand";
import { PLATFORMS } from "./clips";
import type { AutomationNode } from "./graph";
import { TIME_LIMIT_UNITS, TIME_UP_CHOICES } from "./approval";
import {
  CHECK_NAMES,
  CHECKS,
  DEFAULT_CONDITION,
  IF_BRANCHES,
  PICTURE_SIZES,
  WAIT_UNITS,
} from "./logic";
import { MIN_INTERVAL_MINUTES } from "./schedule";
import type { StarterTrigger } from "./starters";

/** What moves along a connection. Only files do today; "data" is a step's JSON result. */
export type Carries = "nothing" | "file" | "files" | "data";

export type NodeGroup = "trigger" | "ready-made" | "logic" | "people" | StepCategory;

export interface JsonSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface NodeType {
  /**
   * Stable name: "trigger:upload", "approval", "clips", "export", "if", "wait", or
   * "step:<catalog id>".
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
  /** Settings filled from the team's brand in Settings when left empty. */
  brand?: Record<string, BrandKey>;
  /**
   * The ways out of it, when it has more than one. Every connection from it names one,
   * and each way hands on only the files that went that way.
   */
  branches?: string[];
}

export const GROUP_LABELS: Record<NodeGroup, string> = {
  trigger: "Starts the automation",
  "ready-made": "Ready-made",
  logic: "Logic",
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
  "logic",
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
    description:
      "Starts by itself each time someone on the team uploads a file. The run is handed the file's details (duration, width, height, fps, codecs, whether it has sound), and can be limited to files of a certain length.",
    takes: "nothing",
    gives: "file",
    settings: {
      type: "object",
      properties: {
        fileType,
        minSeconds: {
          type: "number",
          minimum: 0,
          description:
            "Only files at least this many seconds long start the automation. The length is read from the file when it is uploaded; a file whose length cannot be read does not start it.",
        },
        maxSeconds: {
          type: "number",
          minimum: 0,
          description: "Only files at most this many seconds long start the automation.",
        },
      },
      required: ["fileType"],
    },
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
    "Stops the run until a reviewer approves. The files it was shown carry on to the next step. Reviewers are told in the bell and by email; it can decide by itself when nobody does in time.",
  takes: "files",
  gives: "files",
  settings: {
    type: "object",
    properties: {
      reviewers: {
        type: "array",
        items: { type: "string" },
        default: [],
        description:
          "The user ids of the team members asked to approve. Empty means anyone on the team. Team owners and admins can always decide.",
      },
      timeLimit: {
        type: "number",
        exclusiveMinimum: 0,
        description:
          "How long to wait for a decision, in timeLimitUnit. Leave it out to wait until someone decides. 6 days at most.",
      },
      timeLimitUnit: { type: "string", enum: [...TIME_LIMIT_UNITS], default: "hours" },
      whenTimeUp: {
        type: "string",
        enum: [...TIME_UP_CHOICES],
        default: "reject",
        description: "What happens when the time limit passes with no decision.",
      },
    },
  },
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

const IF: NodeType = {
  type: "if",
  role: "action",
  group: "logic",
  title: "If",
  description:
    "Sends each file one of two ways. A file leaves by Yes when it passes a check on its length, type, shape, picture size or sound, and by No when it does not.",
  takes: "files",
  gives: "files",
  settings: {
    type: "object",
    properties: {
      check: {
        type: "string",
        enum: CHECK_NAMES,
        default: DEFAULT_CONDITION.check,
        description: "What to look at on each file.",
      },
      is: {
        type: "string",
        enum: CHECK_NAMES.flatMap((check) => CHECKS[check].choices.map((choice) => choice.value)),
        default: DEFAULT_CONDITION.is,
        description: `What it has to be to leave by Yes. ${CHECK_NAMES.map(
          (check) =>
            `For ${check}: ${CHECKS[check].choices.map((choice) => choice.value).join(", ")}.`,
        ).join(" ")}`,
      },
      value: {
        type: "number",
        exclusiveMinimum: 0,
        default: DEFAULT_CONDITION.value,
        description: `The number to compare against. For length: seconds. For size: pixels on the shorter side (${PICTURE_SIZES.map((size) => size.value).join(", ")}). Not used by the other checks.`,
      },
    },
    required: ["check", "is"],
  },
  automatic: null,
  branches: [...IF_BRANCHES],
};

const WAIT: NodeType = {
  type: "wait",
  role: "action",
  group: "logic",
  title: "Wait",
  description:
    "Holds the run for a length of time, then hands the files it was given to the next step. Six days at most.",
  takes: "files",
  gives: "files",
  settings: {
    type: "object",
    properties: {
      amount: {
        type: "number",
        exclusiveMinimum: 0,
        default: 30,
        description: "How many minutes, hours or days to wait.",
      },
      unit: { type: "string", enum: [...WAIT_UNITS], default: "minutes" },
    },
    required: ["amount", "unit"],
  },
  automatic: null,
};

const EXPORT: NodeType = {
  type: "export",
  role: "action",
  group: "ready-made",
  title: "Export for editors",
  description:
    "Makes timeline files that open this run's cuts in Premiere Pro, DaVinci Resolve and Final Cut Pro, with every cut still adjustable. Put it after Clips for a platform. It has nothing to set up: the editors are picked once in Settings. CapCut cannot open a timeline, so it uses the finished clips.",
  takes: "files",
  gives: "files",
  settings: { type: "object", properties: {} },
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
    ...(step.brandInputs ? { brand: step.brandInputs } : {}),
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
  EXPORT,
  IF,
  WAIT,
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
  if (
    type === "approval" ||
    type === "clips" ||
    type === "export" ||
    type === "if" ||
    type === "wait"
  ) {
    return { kind: type };
  }
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

/**
 * Required settings that are still blank and that nothing fills in: not the step before,
 * and not the team's brand. Pass the brand to count what it supplies.
 */
export function missingSettingsOf(
  nodeType: NodeType,
  input: Record<string, unknown>,
  brand?: Brand,
): string[] {
  return (nodeType.settings.required ?? []).filter((name) => {
    if (name === nodeType.automatic) return false;
    const value = input[name];
    if (!(value === undefined || value === null || value === "")) return false;
    const key = nodeType.brand?.[name];
    return !(key && brand?.[key]);
  });
}

/** The brand items a node still needs set in Settings: required, blank, and not set there. */
export function missingBrandOf(
  nodeType: NodeType,
  input: Record<string, unknown>,
  brand: Brand,
): BrandKey[] {
  return missingSettingsOf(nodeType, input, brand).flatMap((name) => nodeType.brand?.[name] ?? []);
}

/** A node's settings with every blank brand setting filled from the team's brand. */
export function withBrand(
  nodeType: NodeType,
  input: Record<string, unknown>,
  brand: Brand,
): Record<string, unknown> {
  const filled = { ...input };
  for (const [name, key] of Object.entries(nodeType.brand ?? {})) {
    const value = filled[name];
    if ((value === undefined || value === null || value === "") && brand[key]) {
      filled[name] = brand[key];
    }
  }
  return filled;
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
        nodeType.brand
          ? `, takes the team's ${Object.values(nodeType.brand).join(" and ")} from Settings`
          : ""
      }${
        nodeType.fills ? `, uses an earlier ${Object.values(nodeType.fills).join(" and ")}` : ""
      }${nodeType.branches ? `, ways out: ${nodeType.branches.join(" and ")}` : ""}): ${nodeType.title}. ${nodeType.description}`,
  ).join("\n");
}
