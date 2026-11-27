/**
 * Page recordings on a storyboard: a take marked "Page recording" made into a video of a
 * web page by the agent (packages/agent/src/mastra/ncat/page-recording.ts). These rules
 * are shared by the backend and the screens, so both read a recording the same way. The
 * agent server keeps its own copy of the step shapes (walkthrough.ts there); the two
 * must name the same steps.
 */

/** What a step acts on: an element by its role and name on the page, the nth of them. */
export type StepTarget = { role: string; name: string; nth: number };

/** One step of a take's click path, as the agent server sends it back. */
export type WalkStep =
  | { do: "goto"; url: string }
  | { do: "click"; target: StepTarget }
  | { do: "hover"; target: StepTarget }
  | { do: "type"; target: StepTarget; text: string; clear: boolean }
  | { do: "press"; key: string }
  | { do: "select"; target: StepTarget; label: string }
  | { do: "scroll"; direction: "up" | "down"; amount: number }
  | { do: "back" }
  | { do: "pause"; ms: number };

export const STEP_KINDS = [
  "goto",
  "click",
  "hover",
  "type",
  "press",
  "select",
  "scroll",
  "back",
  "pause",
] as const;

export const RECORDING_LIMITS = {
  steps: 60,
  url: 2000,
  notes: 2000,
  signInName: 80,
  signIns: 30,
} as const;

export const RECORDING_STATUSES = [
  "queued",
  "finding",
  "found",
  "asking",
  "recording",
  "saving",
  "done",
  "failed",
] as const;
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

/** Where a recording stands, in words. */
export const STATUS_WORDS: Record<RecordingStatus, string> = {
  queued: "Waiting its turn",
  finding: "Finding the page",
  found: "Found a page. Check it before it is recorded",
  asking: "Which site is this about?",
  recording: "Recording the page",
  saving: "Making the video",
  done: "Recorded",
  failed: "Not recorded",
};

/** Whether a recording is still being made, so another for the same take must wait. */
export const isUnderWay = (status: RecordingStatus) =>
  status === "queued" || status === "finding" || status === "recording" || status === "saving";

const quoted = (target: StepTarget) => (target.name ? `"${target.name}"` : `the ${target.role}`);

/** A step in words, for the list of clicks shown under a take. */
export function describeStep(step: WalkStep): string {
  switch (step.do) {
    case "goto":
      return `Open ${step.url}`;
    case "click":
      return `Click ${quoted(step.target)}`;
    case "hover":
      return `Point at ${quoted(step.target)}`;
    case "type":
      return `Type "${step.text}" into ${quoted(step.target)}`;
    case "press":
      return `Press ${step.key}`;
    case "select":
      return `Pick "${step.label}" in ${quoted(step.target)}`;
    case "scroll":
      return `Scroll ${step.direction}`;
    case "back":
      return "Go back";
    case "pause":
      return `Wait ${Math.round(step.ms / 100) / 10} seconds`;
  }
}

/** A page address a recording may start on: http or https, nothing else. */
export function cleanPageUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > RECORDING_LIMITS.url) return null;
  try {
    const parsed = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** The file name a take's recording is kept under: "Take 4 - Open the pricing page.mp4". */
export function recordingFileName(takeNumber: number, line: string): string {
  const words = line
    .replace(/[\\/:*?"<>|#%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // A line ending in "." would otherwise give "..mp4".
  const ended = words.replace(/[.\s…]+$/, "");
  const short = ended.length > 48 ? `${ended.slice(0, 48).replace(/\s+\S*$/, "")}…` : ended;
  return `Take ${takeNumber}${short ? ` - ${short}` : ""}.mp4`;
}

/** The folder in the team's storage that page recordings are kept in. */
export const RECORDINGS_FOLDER = "Page Recordings/";

/**
 * A Firecrawl profile name for one of a team's saved sign-ins: letters, digits, "-" and
 * "_" only, and never the same for two teams.
 */
export function profileName(organizationId: string, id: string): string {
  const clean = (text: string) => text.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  return `takewon-${clean(organizationId)}-${clean(id)}`;
}
