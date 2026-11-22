// A step's log on the run page: every job it sent, earlier tries too, with what was sent,
// how long it waited and worked, and how each try ended.
import { getStep } from "@ncat-dash/step-catalog";
import type { Doc } from "../_generated/dataModel";

/** Settings whose value is kept out of the log: keys, secrets, passwords, tokens. */
const SECRET = /key|secret|password|token|credential|cookie/i;
/** Text longer than this is cut in the log, so a transcript does not bury it. */
export const LOG_TEXT_LIMIT = 400;

/** A job's settings as the log shows them: secrets hidden, long text cut. */
export function shownInput(value: unknown, name = ""): unknown {
  if (name && SECRET.test(name) && value !== undefined && value !== null && value !== "") {
    return "hidden";
  }
  if (typeof value === "string") {
    return value.length > LOG_TEXT_LIMIT
      ? `${value.slice(0, LOG_TEXT_LIMIT)}… (${value.length} characters)`
      : value;
  }
  if (Array.isArray(value)) return value.map((each) => shownInput(each));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, each]) => [
        key,
        shownInput(each, key),
      ]),
    );
  }
  return value;
}

export interface LoggedJob {
  _id: string;
  /** What the job did, by the catalog step's name. */
  title: string;
  status: Doc<"jobs">["status"];
  /** The file it worked on, when it had one. */
  file: string | null;
  input: unknown;
  error: string | null;
  /** The toolkit refused it in a way another try cannot fix. */
  permanent: boolean;
  /** The toolkit's own id for it, to find it in the toolkit's logs. */
  toolkitJobId: string | null;
  queuedAt: number;
  sentAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  outputs: string[];
}

export function loggedJob(job: Doc<"jobs">): LoggedJob {
  const step = getStep(job.stepId);
  const input = (job.input ?? {}) as Record<string, unknown>;
  const field = step?.primaryInput;
  const file = field && typeof input[field] === "string" ? (input[field] as string) : null;
  return {
    _id: job._id,
    title: step?.title ?? job.stepId,
    status: job.status,
    file,
    input: shownInput(input),
    error: job.error,
    permanent: job.permanent ?? false,
    toolkitJobId: job.toolkitJobId,
    queuedAt: job._creationTime,
    sentAt: job.dispatchedAt ?? null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    outputs: job.outputs,
  };
}
