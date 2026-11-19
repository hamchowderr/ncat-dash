/**
 * One description of every kind of node an automation can hold: what starts it, what it
 * takes from the step before, what it hands on, and the settings it needs. The canvas
 * builds its step list from this and the agent reads the same list, so a node added here
 * shows up for both.
 */
import {
  allSteps,
  currentTeamSteps,
  getStep,
  isHiddenStep,
  userInputJsonSchema,
} from "@ncat-dash/step-catalog";
import type { StepCategory, StepDefinition } from "@ncat-dash/step-catalog";

import type { Brand, BrandKey } from "./brand";
import { CAPTION_STYLE_SETTING, isCaptionStep } from "./captions";
import { FINISH_CHOICES } from "./chain";
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
import {
  BROLL_DEFAULTS,
  BROLL_LOOKS,
  BROLL_MATCH,
  BROLL_OFTEN,
  BROLL_SOURCES,
  MAX_BROLL_SECONDS,
  MAX_SKIP_OPENING,
  MIN_BROLL_SECONDS,
} from "./broll";
import { MAX_CHAPTERS, MAX_MOMENTS, MAX_PADDING, MOMENT_DEFAULTS, MOMENT_EDGES } from "./moments";
import { MOTION_PRESETS, SOUND_LEVELS, STYLE_SOUNDS, TEAM_STYLE } from "./motion";
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
   * Stable name: "trigger:upload", "approval", "clips", "moments", "chapters", "broll",
   * "broll-plan", "motion", "sound-effects", "export",
   * "if", "wait", "automation", or "step:<catalog id>".
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
   * Settings filled from the file that started the run when left empty, such as its name.
   * Nobody fills these in; they are not shown as settings.
   */
  fromStart?: Record<string, "file_name">;
  /**
   * Settings only the person can decide, such as which platform clips are for. The agent
   * asks for these before building rather than picking them itself.
   */
  ask?: string[];
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
  team: "Your team's steps",
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
  "team",
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
  {
    type: "trigger:finished",
    role: "trigger",
    group: "trigger",
    title: "Another automation finishes",
    description:
      "Starts by itself each time a run of another of the team's automations ends: after it works, after it fails, or both. The files that run finished with become the files to work on; after a failure, the files it started with.",
    takes: "nothing",
    gives: "files",
    settings: {
      type: "object",
      properties: {
        automationId: {
          type: "string",
          description:
            "The id of the automation to follow, from the team's list of automations. Not this automation itself.",
        },
        when: {
          type: "string",
          enum: [...FINISH_CHOICES],
          default: "done",
          description:
            "done: after its run works. failed: after it fails. either: after every run.",
        },
      },
      required: ["automationId", "when"],
    },
    automatic: null,
  },
];

/** Runs another automation, like a step; see chain.ts. */
const RUN_AUTOMATION: NodeType = {
  type: "automation",
  role: "action",
  group: "logic",
  title: "Run an automation",
  description:
    "Hands the files that reach it to another of the team's automations and starts that one's published version. It waits for that run to finish and hands on the files it finished with, or, with wait off, just starts it and hands its own files straight on. Automations cannot start each other in a loop.",
  takes: "files",
  gives: "files",
  settings: {
    type: "object",
    properties: {
      automation: {
        type: "string",
        description:
          "The id of the automation to run, from the team's list of automations. Not this automation itself.",
      },
      wait: {
        type: "boolean",
        default: true,
        description:
          "True: wait for the other run and hand on its finished files. False: start it and carry on at once.",
      },
    },
    required: ["automation"],
  },
  ask: ["automation"],
  automatic: null,
};

const APPROVAL: NodeType = {
  type: "approval",
  role: "action",
  group: "people",
  title: "Approval",
  description:
    "Stops the run until a reviewer approves. The files it was shown carry on to the next step. Reviewers are told in their Inbox and by email; it can decide by itself when nobody does in time.",
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
  ask: ["platform"],
  automatic: null,
};

const MOMENTS: NodeType = {
  type: "moments",
  role: "action",
  group: "ready-made",
  title: "Best moments",
  description:
    "Finds the strongest moments in each video from its transcript and cuts each one as a clip for a platform. Every clip starts and ends on whole words, from the words' own timestamps. The AI only picks, once per video; the cutting is plain editing. Moments already picked from a video are skipped next time, so running it again finds new ones.",
  takes: "file",
  gives: "files",
  settings: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        enum: PLATFORMS.map((platform) => platform.name),
        default: "Instagram Reels",
        description:
          "Where the clips will be posted. Sets the frame and the longest a clip can be.",
      },
      count: {
        type: "number",
        minimum: 1,
        maximum: MAX_MOMENTS,
        default: MOMENT_DEFAULTS.count,
        description: "How many moments to cut from each video, at most.",
      },
      minSeconds: {
        type: "number",
        minimum: 1,
        default: MOMENT_DEFAULTS.minSeconds,
        description: "The shortest a clip can be, in seconds.",
      },
      maxSeconds: {
        type: "number",
        minimum: 1,
        default: MOMENT_DEFAULTS.maxSeconds,
        description: "The longest a clip can be, in seconds. Never more than the platform takes.",
      },
      topics: {
        type: "string",
        default: "",
        description: "Subjects to favour, in plain words. Empty picks from the whole video.",
      },
      lookFor: {
        type: "string",
        default: "",
        description:
          "What makes a good moment for this team, in plain words, such as a strong opinion, a story or a tip that stands on its own.",
      },
      padding: {
        type: "number",
        minimum: 0,
        maximum: MAX_PADDING,
        default: MOMENT_DEFAULTS.padding,
        description:
          "Seconds of room kept before the first word and after the last. Never reaches into the next word.",
      },
      edges: {
        type: "string",
        enum: [...MOMENT_EDGES],
        default: MOMENT_DEFAULTS.edges,
        description:
          "sentence: each clip starts and ends on a whole sentence. word: on the exact words picked.",
      },
      skipPicked: {
        type: "boolean",
        default: MOMENT_DEFAULTS.skipPicked,
        description:
          "Leave out moments already picked from the same video, so a new run finds new ones.",
      },
    },
    required: ["platform"],
  },
  ask: ["platform"],
  automatic: null,
};

const CHAPTERS: NodeType = {
  type: "chapters",
  role: "action",
  group: "ready-made",
  title: "Chapters and show notes",
  description:
    "Groups a long video into chapters by topic, each with a title and a few bullets. Every chapter starts at the start of a sentence, from the transcript's timestamps, the first at 0:00. The run page shows them to copy as YouTube chapters or download as show notes. The video carries on to the next step unchanged.",
  takes: "file",
  gives: "files",
  settings: {
    type: "object",
    properties: {
      count: {
        type: "number",
        minimum: 0,
        maximum: MAX_CHAPTERS,
        default: 0,
        description: "How many chapters at most. 0 lets it decide from the video.",
      },
      bullets: {
        type: "number",
        minimum: 0,
        maximum: 6,
        default: 3,
        description: "How many bullets of show notes under each chapter.",
      },
    },
  },
  automatic: null,
};

const BROLL: NodeType = {
  type: "broll",
  role: "action",
  group: "video",
  title: "Add B-Roll",
  description:
    "Lays short cutaway footage over each video while the voice carries on, where what is said can be shown: a garage when someone says garage. No AI: footage is matched to the words by a picture model on the team's own toolkit, from the team's Content Library first and then free stock (Pixabay, Pexels). Footage that does not look enough like the words is not used. When a Plan B-Roll step comes before it, it follows that plan instead.",
  takes: "file",
  gives: "file",
  settings: {
    type: "object",
    properties: {
      often: {
        type: "string",
        enum: [...BROLL_OFTEN],
        default: BROLL_DEFAULTS.often,
        description:
          "How many cutaways: light keeps about 15 seconds on the speaker between them, medium about 7, busy about 3.",
      },
      seconds: {
        type: "number",
        minimum: MIN_BROLL_SECONDS,
        maximum: MAX_BROLL_SECONDS,
        default: BROLL_DEFAULTS.seconds,
        description: "How long each cutaway lasts, in seconds.",
      },
      skipOpening: {
        type: "number",
        minimum: 0,
        maximum: MAX_SKIP_OPENING,
        default: BROLL_DEFAULTS.skipOpening,
        description: "Seconds at the start kept on the speaker, so the hook stays on the face.",
      },
      look: {
        type: "string",
        enum: [...BROLL_LOOKS],
        default: BROLL_DEFAULTS.look,
        description:
          "full: the cutaway fills the frame. window: it sits in a box over the speaker.",
      },
      sources: {
        type: "string",
        enum: [...BROLL_SOURCES],
        default: BROLL_DEFAULTS.sources,
        description:
          "Where footage comes from: the team's library and then free stock, the library only, or stock only.",
      },
      match: {
        type: "string",
        enum: [...BROLL_MATCH],
        default: BROLL_DEFAULTS.match,
        description:
          "How closely footage must look like the words to be used. close uses fewer, surer cutaways; loose uses more.",
      },
    },
  },
  automatic: null,
};

const BROLL_PLAN: NodeType = {
  type: "broll-plan",
  role: "action",
  group: "video",
  title: "Plan B-Roll",
  description:
    "AI reads each video's transcript and says which moments deserve a cutaway and what it should show. Put it before Add B-Roll, which follows the plan; without it, Add B-Roll picks by plain rules. The AI only quotes the words; every quote is found in the transcript word for word. The video carries on unchanged.",
  takes: "file",
  gives: "file",
  settings: {
    type: "object",
    properties: {
      lookFor: {
        type: "string",
        default: "",
        description:
          "What the cutaways should favour, in plain words, such as the product, the places named, or anything with numbers.",
      },
    },
  },
  automatic: null,
};

const MOTION: NodeType = {
  type: "motion",
  role: "action",
  group: "video",
  title: "Add Motion Graphics",
  description:
    "Draws designed motion graphics onto each video in the team's style from Settings > Motion: an opening title, the speaker's name, the numbers that are said, a card at each chapter, a follow card at the end, each with its own sound. Placed by plain rules from the transcript, with no AI, unless a Plan Motion Graphics step comes before it. Put it after Chapters to get chapter cards.",
  takes: "file",
  gives: "files",
  settings: {
    type: "object",
    properties: {
      style: {
        type: "string",
        enum: [TEAM_STYLE, ...MOTION_PRESETS.map((preset) => preset.id)],
        default: TEAM_STYLE,
        description: `The style. ${TEAM_STYLE}: the team's style from Settings > Motion. Or one of the presets: ${MOTION_PRESETS.map((preset) => `${preset.id} (${preset.name})`).join(", ")}.`,
      },
      title: {
        type: "string",
        default: "",
        description: "The opening title. Empty uses the name of the file that started the run.",
      },
      sounds: {
        type: "string",
        enum: [STYLE_SOUNDS, ...SOUND_LEVELS],
        default: STYLE_SOUNDS,
        description: `How loud each piece's sound is. ${STYLE_SOUNDS}: as the style says. off, light or heavy.`,
      },
    },
  },
  automatic: null,
};

const SOUND_EFFECTS: NodeType = {
  type: "sound-effects",
  role: "action",
  group: "video",
  title: "Add Sound Effects",
  description:
    "Adds sound effects to each video by plain rules, with no AI: a hit as it opens, a whoosh at each chapter, a pop on the numbers that are said and a chime as it ends. The picture is not changed. Put it after Chapters for the whooshes.",
  takes: "file",
  gives: "files",
  settings: {
    type: "object",
    properties: {
      level: {
        type: "string",
        enum: [TEAM_STYLE, "light", "heavy"],
        default: TEAM_STYLE,
        description: `${TEAM_STYLE}: the level in Settings > Motion. light: a few. heavy: one on every number.`,
      },
    },
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
    "Makes timeline files that open this run's cuts in Premiere Pro, DaVinci Resolve and Final Cut Pro, with every cut still adjustable. Put it after Clips for a platform or Best moments. It has nothing to set up: the editors are picked once in Settings. CapCut cannot open a timeline, so it uses the finished clips.",
  takes: "files",
  gives: "files",
  settings: { type: "object", properties: {} },
  automatic: null,
};

function gives(step: StepDefinition): Carries {
  return step.output === "json" ? "data" : step.output;
}

/** A caption step also takes the name of one of the team's caption styles. */
function stepSettings(step: StepDefinition): JsonSchema {
  const settings = userInputJsonSchema(step) as JsonSchema;
  if (!isCaptionStep(step.id)) return settings;
  return {
    ...settings,
    properties: {
      ...settings.properties,
      [CAPTION_STYLE_SETTING]: {
        type: "string",
        description:
          "The name of a caption style from Settings. Leave it and settings blank to use the team's style for the video's shape.",
      },
    },
  };
}

function stepType(step: StepDefinition): NodeType {
  return {
    type: `step:${step.id}`,
    role: "action",
    group: step.category,
    title: step.title,
    description: isCaptionStep(step.id)
      ? `${step.description} Styles itself from the team's caption styles in Settings (one per video shape) and fixes the team's misheard words.`
      : step.description,
    takes: step.listInput ? "files" : step.primaryInput ? "file" : "nothing",
    gives: gives(step),
    settings: stepSettings(step),
    automatic: step.primaryInput ?? step.listInput?.field ?? null,
    ...(step.values ? { makes: Object.keys(step.values) } : {}),
    ...(step.brandInputs ? { brand: step.brandInputs } : {}),
    ...(step.startInputs ? { fromStart: step.startInputs } : {}),
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
  MOMENTS,
  CHAPTERS,
  BROLL,
  BROLL_PLAN,
  MOTION,
  SOUND_EFFECTS,
  EXPORT,
  IF,
  WAIT,
  RUN_AUTOMATION,
  ...allSteps.map(stepType),
  APPROVAL,
].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));

const byType = new Map(NODE_TYPES.map((nodeType) => [nodeType.type, nodeType]));

/** The team's own steps (step-catalog's `setTeamSteps`), as node types. */
function teamNodeTypes(): NodeType[] {
  return currentTeamSteps().map(stepType);
}

/** Every node type, with the team's own steps after the recipes. */
export function allNodeTypes(): NodeType[] {
  const team = teamNodeTypes();
  if (team.length === 0) return NODE_TYPES;
  return [...NODE_TYPES, ...team].sort(
    (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group),
  );
}

export function getNodeType(type: string): NodeType | undefined {
  const found = byType.get(type);
  if (found || !type.startsWith("step:")) return found;
  const step = getStep(type.slice("step:".length));
  return step ? stepType(step) : undefined;
}

/** The types that can be added as steps, grouped for the step list. */
export function actionTypesByGroup(): { group: NodeGroup; label: string; types: NodeType[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    types: allNodeTypes().filter(
      (nodeType) => nodeType.role === "action" && nodeType.group === group,
    ),
  })).filter((entry) => entry.types.length > 0);
}

/** The registry name of a saved node. */
export function typeNameOf(node: Pick<AutomationNode, "kind" | "stepId">): string {
  return node.kind === "step" ? `step:${node.stepId ?? ""}` : node.kind;
}

export function nodeTypeOf(node: Pick<AutomationNode, "kind" | "stepId">): NodeType | undefined {
  return getNodeType(typeNameOf(node));
}

export function triggerTypeOf(trigger: StarterTrigger): NodeType {
  return byType.get(`trigger:${trigger.kind}`)!;
}

/** The saved shape of a node of this type: its kind and, for a toolkit step, the step id. */
export function savedKind(type: string): Pick<AutomationNode, "kind" | "stepId"> | null {
  if (
    type === "approval" ||
    type === "clips" ||
    type === "moments" ||
    type === "chapters" ||
    type === "broll" ||
    type === "broll-plan" ||
    type === "motion" ||
    type === "sound-effects" ||
    type === "export" ||
    type === "if" ||
    type === "wait" ||
    type === "automation"
  ) {
    return { kind: type };
  }
  if (type.startsWith("step:")) {
    const stepId = type.slice("step:".length);
    return getStep(stepId) && !isHiddenStep(stepId) ? { kind: "step", stepId } : null;
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
 * A node's settings with every blank setting that comes from the file that started the run
 * filled in from it, such as that file's name for a title.
 */
export function withStart(
  nodeType: NodeType,
  input: Record<string, unknown>,
  trigger: Record<string, unknown>,
): Record<string, unknown> {
  const filled = { ...input };
  for (const [name, key] of Object.entries(nodeType.fromStart ?? {})) {
    const value = filled[name];
    if (
      (value === undefined || value === null || value === "") &&
      typeof trigger[key] === "string"
    ) {
      filled[name] = trigger[key];
    }
  }
  return filled;
}

/**
 * The registry as short text for a model: one line per type with what it takes and gives.
 * The full settings of one type come from `getNodeType(type).settings`.
 */
export function nodeTypeIndex(): string {
  return allNodeTypes()
    .map(
      (nodeType) =>
        `${nodeType.type} (${GROUP_LABELS[nodeType.group]}; takes ${nodeType.takes}, gives ${nodeType.gives}${
          nodeType.makes ? `, makes ${nodeType.makes.join(" and ")}` : ""
        }${
          nodeType.brand
            ? `, takes the team's ${Object.values(nodeType.brand).join(" and ")} from Settings`
            : ""
        }${nodeType.fills ? `, uses an earlier ${Object.values(nodeType.fills).join(" and ")}` : ""}${
          nodeType.fromStart
            ? ", fills an empty title from the name of the file that started the run"
            : ""
        }${nodeType.branches ? `, ways out: ${nodeType.branches.join(" and ")}` : ""}${
          nodeType.ask ? `, ask the person for its ${nodeType.ask.join(" and ")}` : ""
        }): ${nodeType.title}. ${nodeType.description}`,
    )
    .join("\n");
}
