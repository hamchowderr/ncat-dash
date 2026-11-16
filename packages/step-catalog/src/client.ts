import { RUNNER_FIELDS, type StepDefinition, userInputSchema } from "./define";

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
  const body = compact(
    step.toRequest ? step.toRequest(parsed) : (parsed as Record<string, unknown>),
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
