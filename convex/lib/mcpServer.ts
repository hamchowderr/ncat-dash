/**
 * The dashboard's MCP server protocol, over Streamable HTTP, without a stream: each POST
 * carries one JSON-RPC message and gets one JSON answer, which fits a Convex HTTP action.
 *
 * It speaks the 2026-07-28 revision, where every request carries its own protocol version
 * and client capabilities in `_meta` and there is no handshake, and it still answers
 * older clients that start with `initialize` (2025-11-25 and before). Three extensions are
 * offered: MCP Apps (a tool can show a small page in the chat), Skills (instructions an
 * agent can load, as `skill://` resources), Tasks (a long job the chat app follows) and
 * Events (things that happened, which the chat app polls for).
 *
 * A tool can also ask the person something in the middle (elicitation): it answers
 * `input_required` with a form, and the chat app shows it and calls again with the
 * answers. That needs a 2026-07-28 client that can show forms; others go without.
 */

export const MODERN_VERSION = "2026-07-28";
export const MODERN_VERSIONS = [MODERN_VERSION];
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export const APPS_EXTENSION = "io.modelcontextprotocol/ui";
export const SKILLS_EXTENSION = "io.modelcontextprotocol/skills";
export const TASKS_EXTENSION = "io.modelcontextprotocol/tasks";
export const EVENTS_EXTENSION = "io.modelcontextprotocol/events";
export const APP_MIME_TYPE = "text/html;profile=mcp-app";

const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Whether the tool only reads, for clients that ask before running a tool that acts. */
  readOnly: boolean;
  /** Whether running it twice with the same arguments does nothing more. */
  idempotent?: boolean;
  /**
   * For a tool that acts: false when it only adds things (a new draft, a new run) and changes or
   * stops nothing that is there already. Left out, a tool that acts counts as changing things, so
   * chat apps ask before running it.
   */
  destructive?: boolean;
  /** The `ui://` page that shows the tool's result, for clients with MCP Apps. */
  appUri?: string;
  /** The shape of what it returns (as `structuredContent`); a list is sent as `{ items }`. */
  outputSchema?: Record<string, unknown>;
  icons?: McpIcon[];
};

export type McpIcon = {
  src: string;
  mimeType?: string;
  sizes?: string[];
  theme?: "light" | "dark";
};

/** A slash command: a ready-made request the person picks from the chat app's menu. */
export type McpPrompt = {
  name: string;
  title: string;
  description: string;
  arguments?: { name: string; description: string; required?: boolean }[];
  icons?: McpIcon[];
  /** The request it puts in the chat, from the arguments the person gave. */
  text: (args: Record<string, string>) => string;
};

/** A link to a file a tool made, sent as a `resource_link` beside its result. */
export type McpLink = { uri: string; name: string; mimeType?: string };

/** One form for the person: a message and a few plain fields (strings, numbers, choices). */
export type McpForm = {
  message: string;
  fields: Record<string, Record<string, unknown>>;
  required?: string[];
};

/** What the person did with a form. */
export type McpAnswer = {
  action: "accept" | "decline" | "cancel";
  content: Record<string, unknown>;
};

/** What the client can do, for a tool to decide how to answer. */
export type McpCallContext = {
  /** It can show forms, so a tool may stop and ask the person. */
  forms: boolean;
  /** It follows tasks, so a long job may come back as one. */
  tasks: boolean;
  /** It shows MCP Apps pages. */
  apps: boolean;
  /** The person's answers to forms this call asked for before, by the form's key. */
  answers: Record<string, McpAnswer>;
};

/** A tool's answer meaning "ask the person first": the forms, by key. */
export class NeedsInput {
  constructor(readonly forms: Record<string, McpForm>) {}
}

/** A long job, as the chat app follows it. */
export type McpTask = {
  taskId: string;
  status: "working" | "input_required" | "completed" | "failed" | "cancelled";
  statusMessage?: string;
  createdAt: string;
  lastUpdatedAt: string;
  /** When completed: what the tool would have returned, and whether it went wrong. */
  result?: unknown;
  isError?: boolean;
  /** When input_required: forms for the person, by a key unique for the task's life. */
  forms?: Record<string, McpForm>;
};

/** A tool's answer meaning "this goes on for a while": the task to follow. */
export class StartedTask {
  constructor(readonly task: McpTask) {}
}

/** Team data an app can attach to the chat: listed entries, templates, and reading one. */
export type McpData = {
  list: () => Promise<Omit<McpResource, "text">[]>;
  templates: {
    uriTemplate: string;
    name: string;
    title: string;
    description: string;
    mimeType: string;
  }[];
  /** null when there is nothing at that address for this caller. */
  read: (uri: string) => Promise<McpResource | null>;
};

/** What to suggest for one argument of a prompt or a resource template. */
export type McpComplete = (
  ref: { type: "ref/prompt"; name: string } | { type: "ref/resource"; uri: string },
  argument: { name: string; value: string },
  known: Record<string, string>,
) => Promise<string[]>;

/** One kind of event, as events/list describes it. Only polling is offered. */
export type McpEventType = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  payloadSchema: Record<string, unknown>;
};

export type McpEventOccurrence = {
  eventId: string;
  name: string;
  timestamp: string;
  data: Record<string, unknown>;
};

/** An events/* refusal with its own code (NotFound -32023, Forbidden -32024 and so on). */
export class EventRefused extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export type McpEvents = {
  types: McpEventType[];
  /** Events after the cursor (null: start from now), oldest first, at most `most`. */
  poll: (request: {
    name: string;
    args: Record<string, unknown>;
    cursor: string | null;
    maxAgeMs: number | null;
    most: number;
  }) => Promise<{
    events: McpEventOccurrence[];
    cursor: string;
    truncated: boolean;
    hasMore: boolean;
  }>;
};

/** The server's side of tasks. Each throws ToolSaid when the task is not this caller's. */
export type McpTasks = {
  get: (taskId: string, context: McpCallContext) => Promise<McpTask | null>;
  update: (taskId: string, answers: Record<string, McpAnswer>) => Promise<void>;
  cancel: (taskId: string) => Promise<void>;
};

export type McpResource = {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType: string;
  text: string;
  _meta?: Record<string, unknown>;
};

/** A skill: its SKILL.md and any other files, all under `skill://<name>/`. */
export type McpSkill = {
  name: string;
  description: string;
  files: McpResource[];
};

export type McpServer = {
  info: { name: string; title: string; version: string; icons?: McpIcon[]; websiteUrl?: string };
  instructions: string;
  tools: McpTool[];
  /** `ui://` pages for MCP Apps. */
  apps: McpResource[];
  skills: McpSkill[];
  prompts?: McpPrompt[];
  /**
   * Runs a tool; throwing ToolSaid gives the agent the message as a tool error. It may
   * return NeedsInput to ask the person first (only when the context allows forms), or
   * StartedTask (only when it allows tasks).
   */
  call: (name: string, args: Record<string, unknown>, context: McpCallContext) => Promise<unknown>;
  /** The files a tool's result links to, sent beside it as resource links. */
  links?: (result: unknown) => McpLink[];
  tasks?: McpTasks;
  data?: McpData;
  complete?: McpComplete;
  events?: McpEvents;
};

/** A tool's own error, said to the agent in plain words rather than as a protocol error. */
export class ToolSaid extends Error {}

export type McpReply = { status: number; body: Record<string, unknown> | null };

type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
type Params = Record<string, unknown>;

const LIST_CACHE = { ttlMs: 300_000, cacheScope: "private" } as const;
const TASK_POLL_MS = 5_000;
const EVENT_POLL_MS = 30_000;
/** Team data changes all the time, so a client reads it again rather than keep it. */
const NO_CACHE = { ttlMs: 0, cacheScope: "private" } as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function failure(id: unknown, code: number, message: string, status: number, data?: unknown) {
  return {
    status,
    body: { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } },
  };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function header(headers: Headers, name: string): string | null {
  const value = headers.get(name);
  if (value === null) return null;
  const encoded = /^=\?base64\?(.*)\?=$/.exec(value.trim());
  if (!encoded) return value.trim();
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(encoded[1]), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

function toolEntry(tool: McpTool, apps: boolean) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.icons ? { icons: tool.icons } : {}),
    annotations: {
      title: tool.title,
      readOnlyHint: tool.readOnly,
      destructiveHint: !tool.readOnly && tool.destructive !== false,
      idempotentHint: tool.idempotent ?? tool.readOnly,
      openWorldHint: false,
    },
    ...(apps && tool.appUri ? { _meta: { ui: { resourceUri: tool.appUri } } } : {}),
  };
}

const resourceEntry = (resource: Omit<McpResource, "text">) => ({
  uri: resource.uri,
  name: resource.name,
  ...(resource.title ? { title: resource.title } : {}),
  ...(resource.description ? { description: resource.description } : {}),
  mimeType: resource.mimeType,
});

async function skillEntry(skill: McpSkill) {
  return {
    uri: `skill://${skill.name}/SKILL.md`,
    frontmatter: { name: skill.name, description: skill.description },
    resources: await Promise.all(
      skill.files.map(async (file) => ({
        uri: file.uri,
        digest: `sha256:${await sha256(file.text)}`,
        size: new TextEncoder().encode(file.text).length,
      })),
    ),
  };
}

/** Whether the client says it can show MCP Apps pages. */
function showsApps(capabilities: unknown): boolean {
  if (!isObject(capabilities) || !isObject(capabilities.extensions)) return false;
  const ui = capabilities.extensions[APPS_EXTENSION];
  if (!isObject(ui)) return false;
  return !Array.isArray(ui.mimeTypes) || ui.mimeTypes.includes(APP_MIME_TYPE);
}

/** Whether the client says it can show forms (an empty elicitation entry means forms). */
function showsForms(capabilities: unknown): boolean {
  if (!isObject(capabilities) || !isObject(capabilities.elicitation)) return false;
  const elicitation = capabilities.elicitation;
  return Object.keys(elicitation).length === 0 || "form" in elicitation;
}

/** Whether the client says it follows tasks. */
function followsTasks(capabilities: unknown): boolean {
  return (
    isObject(capabilities) &&
    isObject(capabilities.extensions) &&
    isObject(capabilities.extensions[TASKS_EXTENSION])
  );
}

function capabilities(server: McpServer, modern: boolean) {
  return {
    tools: { listChanged: false },
    resources: { subscribe: false, listChanged: false },
    ...(server.prompts?.length ? { prompts: { listChanged: false } } : {}),
    ...(server.complete ? { completions: {} } : {}),
    extensions: {
      [APPS_EXTENSION]: { mimeTypes: [APP_MIME_TYPE] },
      ...(server.skills.length > 0 ? { [SKILLS_EXTENSION]: {} } : {}),
      // Tasks as 2026-07-28 has them; older clients knew an earlier, different kind.
      ...(server.tasks && modern ? { [TASKS_EXTENSION]: {} } : {}),
      ...(server.events && modern ? { [EVENTS_EXTENSION]: {} } : {}),
    },
  };
}

/** A form as an elicitation request. */
function elicitation(form: McpForm) {
  return {
    method: "elicitation/create",
    params: {
      mode: "form",
      message: form.message,
      requestedSchema: {
        type: "object",
        properties: form.fields,
        ...(form.required?.length ? { required: form.required } : {}),
      },
    },
  };
}

const formRequests = (forms: Record<string, McpForm>) =>
  Object.fromEntries(Object.entries(forms).map(([key, form]) => [key, elicitation(form)]));

/** The person's answers, as the client sent them back, keeping only well-formed ones. */
function answersOf(value: unknown): Record<string, McpAnswer> {
  if (!isObject(value)) return {};
  const answers: Record<string, McpAnswer> = {};
  for (const [key, answer] of Object.entries(value)) {
    if (!isObject(answer)) continue;
    const action = answer.action;
    if (action !== "accept" && action !== "decline" && action !== "cancel") continue;
    answers[key] = { action, content: isObject(answer.content) ? answer.content : {} };
  }
  return answers;
}

/** A tool's result as MCP sends it: as text, as structured content, and its file links. */
function toolResult(server: McpServer, result: unknown, isError = false) {
  const links = isError ? [] : (server.links?.(result) ?? []);
  return {
    content: [
      { type: "text", text: JSON.stringify(result, null, 2) },
      ...links.map((link) => ({ type: "resource_link", ...link })),
    ],
    structuredContent: Array.isArray(result) ? { items: result } : result,
    isError,
  };
}

/** A task as tasks/get and tools/call send it. */
function taskEntry(server: McpServer, task: McpTask) {
  return {
    taskId: task.taskId,
    status: task.status,
    ...(task.statusMessage ? { statusMessage: task.statusMessage } : {}),
    createdAt: task.createdAt,
    lastUpdatedAt: task.lastUpdatedAt,
    ttlMs: null,
    pollIntervalMs: TASK_POLL_MS,
    ...(task.status === "completed"
      ? { result: toolResult(server, task.result, task.isError === true) }
      : {}),
    ...(task.status === "input_required" && task.forms
      ? { inputRequests: formRequests(task.forms) }
      : {}),
  };
}

/**
 * The answer to one JSON-RPC message, with the HTTP status to send it with. A body of
 * null is a notification, answered with a bare 202.
 */
export async function handleMcp(
  message: unknown,
  headers: Headers,
  server: McpServer,
): Promise<McpReply> {
  if (!isObject(message)) {
    return failure(null, -32600, "Send one JSON-RPC message as a JSON object.", 400);
  }
  const { id, method, params } = message as Message;
  if (typeof method !== "string") return failure(id, -32600, "The message has no method.", 400);
  const given: Params = isObject(params) ? params : {};
  const meta = isObject(given._meta) ? given._meta : {};
  const asked = typeof meta[META_VERSION] === "string" ? (meta[META_VERSION] as string) : null;
  const modern = asked !== null;

  // A notification (no id) needs no answer: initialized, cancelled and the like.
  if (id === undefined || id === null) return { status: 202, body: null };

  if (modern) {
    if (!MODERN_VERSIONS.includes(asked)) {
      return failure(id, -32022, "Unsupported protocol version", 400, {
        supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS],
        requested: asked,
      });
    }
    // 2026-07-28 clients repeat the version and method in headers, for proxies.
    const version = header(headers, "mcp-protocol-version");
    const sentMethod = header(headers, "mcp-method");
    if ((version !== null && version !== asked) || (sentMethod !== null && sentMethod !== method)) {
      return failure(
        id,
        -32020,
        "Header mismatch: MCP-Protocol-Version and Mcp-Method must match the body.",
        400,
      );
    }
    if (!isObject(meta[META_CAPABILITIES])) {
      return failure(id, -32602, `Every request needs _meta["${META_CAPABILITIES}"].`, 400);
    }
  } else if (method !== "initialize" && method !== "ping") {
    // An older client, after initialize. It names its version in this header.
    const version = header(headers, "mcp-protocol-version");
    if (version !== null && !LEGACY_VERSIONS.includes(version)) {
      return failure(id, -32022, "Unsupported protocol version", 400, {
        supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS],
        requested: version,
      });
    }
  }

  // Older clients name their MCP Apps support once, in initialize, and the server keeps no
  // session to remember it, so they are always offered the pages; a client that cannot
  // show one ignores `_meta.ui` and reads the text.
  const apps = modern ? showsApps(meta[META_CAPABILITIES]) : true;
  // Forms and tasks need a 2026-07-28 client: older ones would need a held-open stream.
  const forms = modern && showsForms(meta[META_CAPABILITIES]);
  const tasks = modern && Boolean(server.tasks) && followsTasks(meta[META_CAPABILITIES]);
  const answer = (result: Record<string, unknown>): McpReply => ({
    status: 200,
    body: {
      jsonrpc: "2.0",
      id,
      result: modern
        ? { resultType: "complete", ...result, _meta: { [META_SERVER_INFO]: server.info } }
        : result,
    },
  });
  const cached = (result: Record<string, unknown>) =>
    answer(modern ? { ...result, ...LIST_CACHE } : result);

  switch (method) {
    case "server/discover":
      return answer({
        supportedVersions: MODERN_VERSIONS,
        capabilities: capabilities(server, true),
        instructions: server.instructions,
        ...LIST_CACHE,
      });
    case "initialize": {
      const wanted = typeof given.protocolVersion === "string" ? given.protocolVersion : "";
      return answer({
        protocolVersion: LEGACY_VERSIONS.includes(wanted) ? wanted : LEGACY_VERSIONS[0],
        capabilities: capabilities(server, false),
        serverInfo: server.info,
        instructions: server.instructions,
      });
    }
    case "ping":
      return answer({});
    case "tools/list":
      return cached({ tools: server.tools.map((tool) => toolEntry(tool, apps)) });
    case "tools/call": {
      const name = typeof given.name === "string" ? given.name : "";
      const tool = server.tools.find((each) => each.name === name);
      if (!tool) return failure(id, -32602, `There is no tool called ${name || "(none)"}.`, 400);
      const args = isObject(given.arguments) ? given.arguments : {};
      const context = { forms, tasks, apps, answers: forms ? answersOf(given.inputResponses) : {} };
      try {
        const result = await server.call(name, args, context);
        if (result instanceof NeedsInput) {
          if (!forms) throw new Error(`${name} asked for a form the client cannot show.`);
          return answer({
            resultType: "input_required",
            inputRequests: formRequests(result.forms),
          });
        }
        if (result instanceof StartedTask) {
          if (!tasks) throw new Error(`${name} started a task the client does not follow.`);
          return answer({ resultType: "task", ...taskEntry(server, result.task) });
        }
        return answer(toolResult(server, result));
      } catch (caught) {
        if (!(caught instanceof ToolSaid)) throw caught;
        return answer({ content: [{ type: "text", text: caught.message }], isError: true });
      }
    }
    case "tasks/get":
    case "tasks/update":
    case "tasks/cancel": {
      if (!server.tasks) break;
      if (!tasks) {
        return failure(
          id,
          -32021,
          `Say you follow tasks (${TASKS_EXTENSION}) to use ${method}.`,
          400,
        );
      }
      const taskId = typeof given.taskId === "string" ? given.taskId : "";
      try {
        if (method === "tasks/update") {
          await server.tasks.update(taskId, answersOf(given.inputResponses));
          return answer({});
        }
        if (method === "tasks/cancel") {
          await server.tasks.cancel(taskId);
          return answer({});
        }
        const task = await server.tasks.get(taskId, {
          forms,
          tasks,
          apps,
          answers: {},
        });
        if (!task) return failure(id, -32602, `There is no task ${taskId || "(none)"}.`, 400);
        return answer(taskEntry(server, task));
      } catch (caught) {
        if (!(caught instanceof ToolSaid)) throw caught;
        return failure(id, -32602, caught.message, 400);
      }
    }
    case "resources/list": {
      const fixed = [...server.apps, ...server.skills.flatMap((skill) => skill.files)];
      const data = server.data ? await server.data.list() : [];
      const listed = { resources: [...fixed, ...data].map(resourceEntry) };
      return answer(modern ? { ...listed, ...(data.length ? NO_CACHE : LIST_CACHE) } : listed);
    }
    case "resources/templates/list":
      return cached({ resourceTemplates: server.data?.templates ?? [] });
    case "resources/read": {
      const uri = typeof given.uri === "string" ? given.uri : "";
      const found = [...server.apps, ...server.skills.flatMap((skill) => skill.files)].find(
        (resource) => resource.uri === uri,
      );
      if (!found) {
        let read: McpResource | null = null;
        try {
          read = server.data ? await server.data.read(uri) : null;
        } catch (caught) {
          if (!(caught instanceof ToolSaid)) throw caught;
        }
        if (!read) {
          return failure(id, -32602, `There is no resource at ${uri || "(none)"}.`, 400, { uri });
        }
        const contents = {
          contents: [{ uri: read.uri, mimeType: read.mimeType, text: read.text }],
        };
        return answer(modern ? { ...contents, ...NO_CACHE } : contents);
      }
      return cached({
        contents: [
          {
            uri: found.uri,
            mimeType: found.mimeType,
            text: found.text,
            ...(found._meta ? { _meta: found._meta } : {}),
          },
        ],
      });
    }
    case "prompts/list":
      return cached({
        prompts: (server.prompts ?? []).map((prompt) => ({
          name: prompt.name,
          title: prompt.title,
          description: prompt.description,
          ...(prompt.arguments ? { arguments: prompt.arguments } : {}),
          ...(prompt.icons ? { icons: prompt.icons } : {}),
        })),
      });
    case "prompts/get": {
      const name = typeof given.name === "string" ? given.name : "";
      const prompt = (server.prompts ?? []).find((each) => each.name === name);
      if (!prompt)
        return failure(id, -32602, `There is no prompt called ${name || "(none)"}.`, 400);
      const sent = isObject(given.arguments) ? given.arguments : {};
      const args: Record<string, string> = {};
      for (const [key, value] of Object.entries(sent)) {
        if (typeof value === "string" && value.trim()) args[key] = value.trim();
      }
      const missing = (prompt.arguments ?? []).find((each) => each.required && !args[each.name]);
      if (missing) return failure(id, -32602, `${missing.name} is needed for ${name}.`, 400);
      return answer({
        description: prompt.description,
        messages: [{ role: "user", content: { type: "text", text: prompt.text(args) } }],
      });
    }
    case "completion/complete": {
      if (!server.complete) break;
      const ref = isObject(given.ref) ? given.ref : {};
      const argument = isObject(given.argument) ? given.argument : {};
      const name = typeof argument.name === "string" ? argument.name : "";
      const value = typeof argument.value === "string" ? argument.value : "";
      const context =
        isObject(given.context) && isObject(given.context.arguments) ? given.context.arguments : {};
      const known: Record<string, string> = {};
      for (const [key, each] of Object.entries(context))
        if (typeof each === "string") known[key] = each;
      let target: Parameters<McpComplete>[0] | null = null;
      if (ref.type === "ref/prompt" && typeof ref.name === "string") {
        target = { type: "ref/prompt", name: ref.name };
      } else if (ref.type === "ref/resource" && typeof ref.uri === "string") {
        target = { type: "ref/resource", uri: ref.uri };
      }
      if (!target || !name) return failure(id, -32602, "Send ref and argument.name.", 400);
      const values = await server.complete(target, { name, value }, known);
      return answer({
        completion: {
          values: values.slice(0, 100),
          total: values.length,
          hasMore: values.length > 100,
        },
      });
    }
    case "events/list":
      if (!server.events || !modern) break;
      return answer({
        events: server.events.types.map((type) => ({ ...type, delivery: ["poll"] })),
      });
    case "events/poll": {
      if (!server.events || !modern) break;
      const name = typeof given.name === "string" ? given.name : "";
      if (!server.events.types.some((type) => type.name === name)) {
        return failure(id, -32023, "NotFound", 400, { kind: "event", name });
      }
      const most =
        typeof given.maxEvents === "number" && given.maxEvents >= 1
          ? Math.min(100, Math.floor(given.maxEvents))
          : 50;
      try {
        const polled = await server.events.poll({
          name,
          args: isObject(given.arguments) ? given.arguments : {},
          cursor: typeof given.cursor === "string" ? given.cursor : null,
          maxAgeMs:
            typeof given.maxAgeMs === "number" && given.maxAgeMs > 0 ? given.maxAgeMs : null,
          most,
        });
        return answer({ ...polled, nextPollMs: EVENT_POLL_MS });
      } catch (caught) {
        if (caught instanceof EventRefused) return failure(id, caught.code, caught.message, 400);
        throw caught;
      }
    }
    case "events/stream":
    case "events/subscribe":
    case "events/unsubscribe":
      if (!server.events || !modern) break;
      // Every event here is offered by polling only, which needs no stream or callback.
      return failure(id, -32026, "Unsupported", 400, { feature: "delivery", reason: "poll only" });
    case "skills/list":
      return cached({ skills: await Promise.all(server.skills.map(skillEntry)) });
    case "skills/get": {
      const uri = typeof given.uri === "string" ? given.uri : "";
      const skill = server.skills.find((each) => `skill://${each.name}/SKILL.md` === uri);
      if (!skill) return failure(id, -32602, `There is no skill at ${uri || "(none)"}.`, 400);
      return cached({ skill: await skillEntry(skill) });
    }
  }
  // 404 tells a 2026-07-28 client this is a modern server that lacks the method.
  return failure(id, -32601, `This server does not do ${method}.`, modern ? 404 : 200);
}
