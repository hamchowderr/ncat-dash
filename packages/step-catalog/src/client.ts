import {
  type FileFacts,
  type MediaFacts,
  RUNNER_FIELDS,
  type StepDefinition,
  userInputSchema,
} from "./define";

/** Where a team's toolkit lives. Works for the Python NCA Toolkit and ncat-engine alike. */
export interface ToolkitConnection {
  baseUrl: string;
  apiKey: string;
}

export interface CallOptions {
  /** When set, the toolkit queues the job, answers 202 and posts the result here. */
  webhookUrl?: string;
  /** Echoed back by the toolkit; the runner uses it to match a webhook to a step run. */
  id?: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

export class ToolkitError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "ToolkitError";
  }
}

function joinUrl(baseUrl: string, endpoint: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${endpoint}`;
}

/** Drops undefined and null values so optional fields are simply absent from the request. */
function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null),
  );
}

const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const flag = (value: unknown) => (typeof value === "boolean" ? value : undefined);

/** The facts in the toolkit's answer to /v1/media/metadata. */
export function readMediaFacts(answer: unknown): MediaFacts | undefined {
  if (!answer || typeof answer !== "object") return undefined;
  const raw = answer as Record<string, unknown>;
  const facts: MediaFacts = {
    duration: number(raw.duration),
    width: number(raw.width),
    height: number(raw.height),
    fps: number(raw.fps),
    hasVideo: flag(raw.has_video),
    hasAudio: flag(raw.has_audio),
  };
  const known = Object.fromEntries(
    Object.entries(facts).filter(([, value]) => value !== undefined),
  ) as MediaFacts;
  return Object.keys(known).length > 0 ? known : undefined;
}

/**
 * Reads the length, size and sound of the files a step names in `readsFirst`, by asking
 * the toolkit's metadata route straight away (no webhook, so it answers at once). A file
 * that cannot be read is left out; the step decides what to do without it.
 */
export async function readFacts(
  connection: ToolkitConnection,
  step: StepDefinition,
  input: Record<string, unknown>,
  options: Pick<CallOptions, "signal" | "fetch"> = {},
): Promise<FileFacts> {
  const facts: FileFacts = {};
  const doFetch = options.fetch ?? fetch;
  for (const field of step.readsFirst ?? []) {
    const url = input[field];
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) continue;
    try {
      const res = await doFetch(joinUrl(connection.baseUrl, "/v1/media/metadata"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": connection.apiKey },
        body: JSON.stringify({ media_url: url }),
        signal: options.signal,
      });
      if (!res.ok) continue;
      const envelope = (await res.json()) as { response?: unknown } | null;
      facts[field] = readMediaFacts(envelope?.response);
    } catch {
      // Left out: the step works without it or says what it needs.
    }
  }
  return facts;
}

/**
 * Validates the input against the step's schema, then sends it to the toolkit.
 * Returns the toolkit's response envelope as parsed JSON.
 */
export async function callStep(
  connection: ToolkitConnection,
  step: StepDefinition,
  input: unknown,
  options: CallOptions = {},
): Promise<unknown> {
  const parsed = userInputSchema(step).parse(input);
  const facts = step.readsFirst
    ? await readFacts(connection, step, parsed as Record<string, unknown>, options)
    : {};
  const body = compact(
    step.toRequest ? step.toRequest(parsed, facts) : (parsed as Record<string, unknown>),
  );
  if (options.webhookUrl) body[RUNNER_FIELDS[0]] = options.webhookUrl;
  if (options.id) body[RUNNER_FIELDS[1]] = options.id;

  const doFetch = options.fetch ?? fetch;
  const res = await doFetch(joinUrl(connection.baseUrl, step.endpoint), {
    method: step.method,
    headers: { "Content-Type": "application/json", "X-API-Key": connection.apiKey },
    body: step.method === "POST" ? JSON.stringify(body) : undefined,
    signal: options.signal,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ToolkitError(`Toolkit answered ${res.status} for ${step.endpoint}`, res.status, text);
  }
  return text ? JSON.parse(text) : null;
}

export type ConnectionTestResult =
  | { ok: true; buildNumber: string | null }
  | { ok: false; reason: "unreachable" | "unauthorized" | "not_a_toolkit"; detail: string };

/**
 * Checks that a URL and key reach a working toolkit, using GET /v1/toolkit/authenticate.
 * Never throws: the result says what went wrong in terms a person can act on.
 */
export async function testConnection(
  connection: ToolkitConnection,
  options: Pick<CallOptions, "signal" | "fetch"> = {},
): Promise<ConnectionTestResult> {
  const doFetch = options.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(joinUrl(connection.baseUrl, "/v1/toolkit/authenticate"), {
      method: "GET",
      headers: { "X-API-Key": connection.apiKey },
      signal: options.signal,
    });
  } catch (error) {
    return { ok: false, reason: "unreachable", detail: String(error) };
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "unauthorized", detail: text.slice(0, 300) };
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: "not_a_toolkit",
      detail: `HTTP ${res.status}: ${text.slice(0, 300)}`,
    };
  }
  // The toolkit answers {"response": "Authorized", "build_number": ...}. Anything else that
  // returns 200 (a login page, another API) is not a toolkit.
  let json: { response?: unknown; build_number?: unknown } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!json || typeof json !== "object" || json.response !== "Authorized") {
    return { ok: false, reason: "not_a_toolkit", detail: text.slice(0, 300) };
  }
  return { ok: true, buildNumber: json.build_number == null ? null : String(json.build_number) };
}

/**
 * What the toolkit knows about one of its jobs, from POST /v1/toolkit/job/status.
 * "finished" carries the same envelope the webhook would have posted.
 */
export type ToolkitJobState =
  | { state: "finished"; envelope: { code?: number; response?: unknown; message?: unknown } }
  | { state: "working" }
  | { state: "unknown" };

/**
 * Asks the toolkit about a job it was handed. Used when the job's webhook is late: the
 * toolkit may have finished and failed to reach us, or lost the job when it restarted.
 * Throws ToolkitError when the toolkit answers with anything but 200 or 404, and lets a
 * network error through, so the caller can simply ask again later.
 */
export async function jobStatus(
  connection: ToolkitConnection,
  toolkitJobId: string,
  options: Pick<CallOptions, "signal" | "fetch"> = {},
): Promise<ToolkitJobState> {
  const doFetch = options.fetch ?? fetch;
  const res = await doFetch(joinUrl(connection.baseUrl, "/v1/toolkit/job/status"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": connection.apiKey },
    body: JSON.stringify({ job_id: toolkitJobId }),
    signal: options.signal,
  });
  const text = await res.text();
  if (res.status === 404) return { state: "unknown" };
  if (!res.ok) {
    throw new ToolkitError(`Toolkit answered ${res.status} for its job status`, res.status, text);
  }
  let json: { response?: { job_status?: unknown; response?: unknown } } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const status = json?.response;
  if (!status || typeof status !== "object") return { state: "unknown" };
  if (status.job_status === "done") {
    const envelope = status.response;
    if (envelope && typeof envelope === "object") {
      return { state: "finished", envelope: envelope as Record<string, unknown> };
    }
    return { state: "unknown" };
  }
  if (status.job_status === "queued" || status.job_status === "running") {
    return { state: "working" };
  }
  // "failed" or anything else the toolkit may write: it will not send a result.
  return { state: "unknown" };
}
