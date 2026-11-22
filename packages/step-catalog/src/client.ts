import {
  type Beats,
  type FileFacts,
  type MediaFacts,
  type Pause,
  RUNNER_FIELDS,
  type SpokenWord,
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
  /**
   * The words heard in the files a step names in `readsWords`, by setting name. The runner
   * reads them from the team's transcripts; a file without any is cut as if nothing was said.
   */
  words?: Record<string, SpokenWord[]>;
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
  options: Pick<CallOptions, "signal" | "fetch" | "words"> = {},
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
    const length = facts[field]?.duration;
    if (step.readsBeats?.includes(field) && facts[field]?.hasAudio !== false) {
      if (length && length <= PAUSE_READ_LIMIT) {
        try {
          const res = await doFetch(joinUrl(connection.baseUrl, "/v1/audio/beats"), {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-Key": connection.apiKey },
            body: JSON.stringify({ media_url: url }),
            signal: options.signal,
          });
          if (res.ok) {
            const envelope = (await res.json()) as { response?: unknown } | null;
            const beats = readBeats(envelope?.response);
            if (beats) facts[field] = { ...facts[field], beats };
          }
        } catch {
          // Left out: the step says the beat could not be read.
        }
      }
    }
    if (step.readsCuts?.includes(field) && facts[field]?.hasVideo !== false) {
      if (length && length <= PAUSE_READ_LIMIT) {
        try {
          const res = await doFetch(joinUrl(connection.baseUrl, "/v1/media/look"), {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-Key": connection.apiKey },
            body: JSON.stringify({ media_url: url, cuts: true, frames: false }),
            signal: options.signal,
          });
          if (res.ok) {
            const envelope = (await res.json()) as { response?: unknown } | null;
            const cuts = readCuts(envelope?.response);
            if (cuts) facts[field] = { ...facts[field], cuts };
          }
        } catch {
          // Left out: the step says the shots could not be found.
        }
      }
    }
    if (!step.readsPauses?.includes(field)) continue;
    if (!length || length > PAUSE_READ_LIMIT || facts[field]?.hasAudio === false) continue;
    try {
      const res = await doFetch(joinUrl(connection.baseUrl, "/v1/media/silence"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": connection.apiKey },
        body: JSON.stringify({ media_url: url, duration: 0.3, noise: "-30dB", mono: true }),
        signal: options.signal,
      });
      if (!res.ok) continue;
      const envelope = (await res.json()) as { response?: unknown } | null;
      facts[field] = { ...facts[field], pauses: readPauses(envelope?.response) };
    } catch {
      // Without pauses the cuts land on the exact second instead.
    }
  }
  for (const field of step.readsWords?.(input) ?? []) {
    const words = options.words?.[field];
    if (words) facts[field] = { ...facts[field], words };
  }
  return facts;
}

/** The toolkit's /v1/audio/beats answer, with bad times dropped. Undefined when it has no beat. */
export function readBeats(raw: unknown): Beats | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const answer = raw as Record<string, unknown>;
  const times = (list: unknown) =>
    (Array.isArray(list) ? list : [])
      .filter((t): t is number => typeof t === "number" && Number.isFinite(t) && t >= 0)
      .sort((a, b) => a - b);
  const tempo = number(answer.tempo);
  const beats = times(answer.beats);
  if (!tempo || beats.length < 2) return undefined;
  const steadiness = number(answer.steadiness);
  return {
    tempo,
    steadiness: steadiness === undefined ? 1 : Math.min(1, steadiness),
    beats,
    downbeats: times(answer.downbeats),
  };
}

/** The camera cuts in a /v1/media/look answer, in order. Undefined when cuts were not found. */
export function readCuts(raw: unknown): number[] | undefined {
  const media = raw && typeof raw === "object" ? (raw as Record<string, unknown>).media : null;
  const cuts = media && typeof media === "object" ? (media as Record<string, unknown>).cuts : null;
  if (!Array.isArray(cuts)) return undefined;
  return cuts
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t) && t > 0)
    .sort((a, b) => a - b);
}

/** Pauses are read only for files up to this long, in seconds, so a read stays quick. */
export const PAUSE_READ_LIMIT = 20 * 60;

/** "00:01:02.500" or 62.5 as seconds; NaN when it is neither. */
export function clockSeconds(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number.NaN;
  const parts = value.trim().split(":").map(Number);
  if (parts.length === 0 || parts.some((part) => Number.isNaN(part))) return Number.NaN;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** The toolkit's silence answer as pauses in seconds, in order. Bad entries are dropped. */
export function readPauses(raw: unknown): Pause[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { silences?: unknown })?.silences)
      ? (raw as { silences: unknown[] }).silences
      : [];
  return list
    .map((item) => {
      const entry = (item ?? {}) as Record<string, unknown>;
      return { start: clockSeconds(entry.start), end: clockSeconds(entry.end) };
    })
    .filter(
      (pause) =>
        Number.isFinite(pause.start) && Number.isFinite(pause.end) && pause.end > pause.start,
    )
    .sort((a, b) => a.start - b.start);
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
  const facts =
    step.readsFirst || step.readsWords
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

/** How busy the toolkit's server is, from GET /v1/toolkit/health (the toolkit fork). */
export type ToolkitHealth = {
  buildNumber: string | null;
  /** CPUs the toolkit may use, and how much of them it is using, 0 to 100. */
  cpus: number;
  cpuPercent: number;
  /** Bytes. The limit is the container's, or the machine's when it has none. */
  memory: { used: number; limit: number };
  /** Space for the files the toolkit works on, in bytes. */
  disk: { free: number; total: number } | null;
  uptimeSeconds: number;
  /** The shared Redis queue: jobs waiting, workers and how many are busy. Null counts
   * when each toolkit process keeps its own queue. */
  queue: { shared: boolean; waiting: number | null; workers: number | null; busy: number | null };
  /** Every team's jobs in the toolkit's last hour. */
  jobs: { queued: number; running: number; done: number };
};

export type ToolkitHealthResult =
  | { ok: true; health: ToolkitHealth }
  | { ok: false; reason: "unreachable" | "unauthorized" | "no_health" | "error"; detail: string };

const num = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const numOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Reads the toolkit's health. "no_health": a toolkit build from before the request. */
export async function toolkitHealth(
  connection: ToolkitConnection,
  options: Pick<CallOptions, "signal" | "fetch"> = {},
): Promise<ToolkitHealthResult> {
  const doFetch = options.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(joinUrl(connection.baseUrl, "/v1/toolkit/health"), {
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
  if (res.status === 404) return { ok: false, reason: "no_health", detail: text.slice(0, 300) };
  let json: { response?: Record<string, unknown> } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const report = json?.response;
  if (!res.ok || !report || typeof report !== "object" || !("cpu_percent" in report)) {
    return { ok: false, reason: "error", detail: `HTTP ${res.status}: ${text.slice(0, 300)}` };
  }
  const memory = (report.memory ?? {}) as Record<string, unknown>;
  const disk = report.disk as Record<string, unknown> | null | undefined;
  const queue = (report.queue ?? {}) as Record<string, unknown>;
  const jobs = (report.jobs ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    health: {
      buildNumber: report.build_number == null ? null : String(report.build_number),
      cpus: num(report.cpus, 1),
      cpuPercent: num(report.cpu_percent),
      memory: { used: num(memory.used), limit: num(memory.limit) },
      disk:
        disk && typeof disk === "object" ? { free: num(disk.free), total: num(disk.total) } : null,
      uptimeSeconds: num(report.uptime_seconds),
      queue: {
        shared: queue.shared === true,
        waiting: numOrNull(queue.waiting),
        workers: numOrNull(queue.workers),
        busy: numOrNull(queue.busy),
      },
      jobs: { queued: num(jobs.queued), running: num(jobs.running), done: num(jobs.done) },
    },
  };
}
