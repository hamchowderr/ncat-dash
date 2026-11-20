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

const KIND_LABELS: Record<string, string> = {
  client: "client work",
  ugc: "UGC and ads",
  own: "your own content",
  quick: "a quick personal job",
};

/** What a workflow set-up would change, one line each. */
function workflowLines(given: Args): string[] {
  const lines: string[] = [];
  if (isText(given?.name)) lines.push(`Called "${given.name}"`);
  if (isText(given?.kind) && KIND_LABELS[given.kind]) lines.push(`For ${KIND_LABELS[given.kind]}`);
  if (given?.clientId === null) lines.push("For your team, not a client");
  else if (isText(given?.clientId)) lines.push("For one of your clients");
  const review = (given?.review ?? {}) as Record<string, unknown>;
  if (review.on === false) lines.push("No review: the files go out as soon as they are made");
  else if (review.on === true) lines.push("One review just before the last files go out");
  if (Array.isArray(review.reviewers)) {
    lines.push(
      review.reviewers.length === 0
        ? "Anyone on the team can approve"
        : `${count(review.reviewers.length, "person", "people")} picked to approve`,
    );
  }
  if (typeof review.timeLimit === "number") {
    lines.push(
      review.timeLimit > 0
        ? `Decides by itself after ${review.timeLimit} ${isText(review.timeLimitUnit) ? review.timeLimitUnit : "hours"}`
        : "Waits until someone decides",
    );
  }
  return lines.length > 0 ? lines : ["Its automations become one workflow with one review"];
}

export function toolWords(name: string | undefined, args: unknown): ToolWords {
  const given = (args && typeof args === "object" ? args : undefined) as Args;
  switch (name) {
    case "dash_overview":
      return { title: "Looking at your automations", question: "", lines: [] };
    case "describe_automation":
      return { title: "Reading the automation", question: "", lines: [] };
    case "list_step_types":
      return { title: "Checking the steps available", question: "", lines: [] };
    case "platform_guide": {
      const asked = Array.isArray(given?.platforms) ? given.platforms.filter(isText) : [];
      return {
        title: asked.length
          ? `Checking what ${listWords(asked)} ${asked.length === 1 ? "takes" : "take"}`
          : "Checking what each platform takes",
        question: "",
        lines: [],
      };
    }
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
    case "list_uploads":
      return { title: "Looking at your uploads", question: "", lines: [] };
    case "check_run":
      return { title: "Checking how the run went", question: "", lines: [] };
    case "try_automation":
      return {
        title: "Trying the automation",
        question: "Try this automation on a file?",
        lines: [
          "It runs the real steps on your toolkit, so it takes a while and uses your server.",
          "It runs whether or not the automation is switched on.",
        ],
      };
    case "try_team_step": {
      const step = (given?.step ?? {}) as { title?: unknown };
      return {
        title: "Trying a new FFmpeg step",
        question: "Try this step on a file?",
        lines: [
          isText(step.title) ? `"${step.title}"` : "A step written for you",
          "It runs once on your toolkit, so it takes a moment and uses your server.",
        ],
      };
    }
    case "check_job":
      return { title: "Checking how the step went", question: "", lines: [] };
    case "save_team_step": {
      const step = (given?.step ?? {}) as { title?: unknown; blanks?: unknown };
      const settings = Array.isArray(step.blanks)
        ? (step.blanks as { label?: unknown }[]).map((blank) => blank.label).filter(isText)
        : [];
      return {
        title: given?.stepId ? "Changing your team's step" : "Saving a step for your team",
        question: given?.stepId ? "Change this step?" : "Add this step to your team's steps?",
        lines: [
          isText(step.title) ? `"${step.title}"` : "A step written for you",
          settings.length ? `Settings: ${settings.join(", ")}` : "No settings to fill in",
          "It runs as plain FFmpeg, with no AI each time.",
        ],
      };
    }
    case "list_folder":
      return {
        title: folderText(given?.folder)
          ? `Looking in ${folderText(given?.folder)}`
          : "Looking at your files",
        question: "",
        lines: [],
      };
    case "make_folder":
      return {
        title: "Making a folder",
        question: "Make this folder?",
        lines: [
          folderText(given?.path) || "A new folder",
          "Folders above it are made too if missing.",
        ],
      };
    case "move_files": {
      const keys = Array.isArray(given?.keys) ? given.keys.filter(isText) : [];
      const into = folderText(given?.toFolder) || "the top of your storage";
      return {
        title: "Moving files",
        question: keys.length === 1 ? "Move this file?" : "Move these files?",
        lines: [
          ...keys.slice(0, 5).map(fileName),
          ...(keys.length > 5 ? [`and ${keys.length - 5} more`] : []),
          `Into ${into}`,
        ],
      };
    }
    case "rename_file":
      return {
        title: "Renaming a file",
        question: "Rename this file?",
        lines: [
          `${isText(given?.key) ? fileName(given.key) : "The file"} becomes "${isText(given?.name) ? given.name : ""}"`,
        ],
      };
    case "describe_workflow":
      return { title: "Reading the workflow", question: "", lines: [] };
    case "set_up_workflow":
      return {
        title: "Setting up the workflow",
        question: "Set up this workflow?",
        lines: workflowLines(given),
      };
    case "switch_workflow":
      return {
        title: given?.on ? "Switching the workflow on" : "Switching the workflow off",
        question: given?.on ? "Switch this whole workflow on?" : "Switch this whole workflow off?",
        lines: [
          given?.on
            ? "Every automation in it will then start by itself, with nobody logged in."
            : "None of its automations will start by themselves.",
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
      return { title: plainTitle(name), question: "", lines: [] };
  }
}

/**
 * Tools the agent has beyond the dashboard's own: its plan, its notes, schedules, the
 * library, the web and its workspace. Each gets a plain line, never its tool id.
 */
const PLAIN_TITLES: Record<string, string> = {
  task_write: "Planned the steps",
  task_update: "Updated the plan",
  task_complete: "Ticked off a step",
  task_check: "Checked the plan",
  updateWorkingMemory: "Saved a note",
  find_in_library: "Looking in your library",
  moments: "Finding the best moments",
  run_on_library_file: "Running an automation on a library file",
  list_schedules: "Looking at your schedules",
  start_schedule: "Setting up a schedule",
  stop_schedule: "Stopping a schedule",
  doltHistory: "Looking at past changes",
  doltQuery: "Looking up saved data",
  doltWrite: "Saving data",
  firecrawl_search: "Searching the web",
  firecrawl_scrape: "Reading a web page",
  firecrawl_map: "Looking through a website",
  firecrawl_crawl: "Reading a website",
  firecrawl_extract: "Picking facts out of a web page",
  getWeather: "Checking the weather",
  searchKnowledge: "Looking it up",
};

/** Families of tools named by what they share, for names not listed above. */
const PLAIN_PREFIXES: [prefix: string, title: string][] = [
  ["browser_", "Using the browser"],
  ["firecrawl_", "Looking on the web"],
  ["mastra_workspace_", "Working on files"],
  ["task_", "Updated the plan"],
  ["subagent", "Asking a helper"],
  ["dolt", "Looking up saved data"],
];

/** A plain line for any tool, so a tool id never reaches the person. */
export function plainTitle(name: string | undefined): string {
  if (!name) return "Working on it";
  if (Object.hasOwn(PLAIN_TITLES, name)) return PLAIN_TITLES[name];
  const family = PLAIN_PREFIXES.find(([prefix]) => name.startsWith(prefix));
  return family ? family[1] : "Working on it";
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
  if (name === "platform_guide") {
    const unknown = Array.isArray(value.unknown) ? value.unknown.filter(isText) : [];
    return unknown.length ? [`Not in the guide: ${unknown.join(", ")}`] : [];
  }
  if (name === "list_folder") {
    const folders = Array.isArray(value.folders) ? value.folders.length : 0;
    const files = Array.isArray(value.files) ? value.files.length : 0;
    if (folders + files === 0) return ["Nothing here yet."];
    return [
      [
        folders ? count(folders, "folder", "folders") : "",
        files ? count(files, "file", "files") : "",
      ]
        .filter(Boolean)
        .join(", "),
    ];
  }
  if (name === "make_folder") {
    const made = Array.isArray(value.made) ? value.made.filter(isText) : [];
    return made.length ? [`Made ${made.map(folderText).join(", ")}`] : ["It was already there."];
  }
  if (name === "move_files" && typeof value.moved === "number") {
    return [`Moved ${count(value.moved, "file", "files")}`];
  }
  if (name === "list_uploads") {
    const rows = Array.isArray(value.uploads) ? value.uploads : [];
    return rows.length === 0 ? ["No uploads yet."] : [count(rows.length, "file", "files")];
  }
  if (name === "try_automation" && typeof value.fileName === "string") {
    return [`Started on ${value.fileName}`];
  }
  if (name === "check_job") {
    if (value.status === "done") {
      const made = Array.isArray(value.made) ? value.made.filter(isText) : [];
      return made.length ? [`Made ${made.join(", ")}`] : ["It finished."];
    }
    if (value.status === "failed") {
      return [`It failed${isText(value.error) ? `: ${String(value.error).slice(0, 200)}` : "."}`];
    }
    return ["Still going."];
  }
  if (name === "save_team_step" && isText(value.title)) {
    return [`"${value.title}" is now in your step list`];
  }
  if (name === "check_run") {
    const steps = (Array.isArray(value.steps) ? value.steps : []) as {
      type?: string;
      name?: string | null;
      status?: string;
      madeCount?: number;
      error?: string | null;
    }[];
    const lines = steps.map((step) => {
      const label = step.name ?? (step.type ? typeTitle(step.type) : "A step");
      if (step.status === "failed") return `${label}: failed${step.error ? `: ${step.error}` : ""}`;
      if (step.status === "done")
        return `${label}: made ${count(step.madeCount ?? 0, "file", "files")}`;
      if (step.status === "waiting_approval") return `${label}: waiting for someone to approve`;
      return `${label}: ${step.status === "running" ? "running" : "not started yet"}`;
    });
    const head =
      value.status === "done"
        ? "The run finished."
        : value.status === "failed"
          ? "The run failed."
          : value.status === "waiting"
            ? "The run is waiting."
            : value.status === "cancelled"
              ? "The run was cancelled."
              : "The run is still going.";
    return [head, ...lines];
  }
  return [];
}

/**
 * What a failed turn says to the person. The raw error can be a whole provider response
 * (the request it sent included), which means nothing to them.
 */
export function errorWords(error: string): string {
  if (/\b(401|403)\b|api[_ -]?key|authentication/i.test(error)) {
    return "The agent could not reach its model: the model key is missing or wrong. Whoever runs the agent server needs to check it.";
  }
  if (/\b(429|529)\b|rate limit|overloaded/i.test(error)) {
    return "The agent's model is busy right now. Wait a minute and send your message again.";
  }
  return "Something went wrong and the agent stopped. Send your message again; if it keeps happening, whoever runs the agent server can see why in its log.";
}

const isText = (item: unknown): item is string => typeof item === "string" && item.length > 0;

/** "TikTok", "TikTok and X", "TikTok, X and LinkedIn". */
function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** A folder as people write it: "Podcasts/Raw", never with slashes at the ends. */
function folderText(path: unknown): string {
  return isText(path)
    ? path
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean)
        .join("/")
    : "";
}

/** The last part of a storage key: "Podcasts/Raw/ep12.mp4" is "ep12.mp4". */
function fileName(key: string): string {
  return key.split("/").filter(Boolean).pop() ?? key;
}
