/**
 * The dashboard's MCP server protocol, over Streamable HTTP, without a stream: each POST
 * carries one JSON-RPC message and gets one JSON answer, which fits a Convex HTTP action.
 *
 * It speaks the 2026-07-28 revision, where every request carries its own protocol version
 * and client capabilities in `_meta` and there is no handshake, and it still answers
 * older clients that start with `initialize` (2025-11-25 and before). Two extensions are
 * offered: MCP Apps (a tool can show a small page in the chat) and Skills (instructions
 * an agent can load, as `skill://` resources).
 */

export const MODERN_VERSION = "2026-07-28";
export const MODERN_VERSIONS = [MODERN_VERSION];
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export const APPS_EXTENSION = "io.modelcontextprotocol/ui";
export const SKILLS_EXTENSION = "io.modelcontextprotocol/skills";
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
  /** The `ui://` page that shows the tool's result, for clients with MCP Apps. */
  appUri?: string;
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
  info: { name: string; title: string; version: string };
  instructions: string;
  tools: McpTool[];
  /** `ui://` pages for MCP Apps. */
  apps: McpResource[];
  skills: McpSkill[];
  /** Runs a tool; throwing ToolSaid gives the agent the message as a tool error. */
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

/** A tool's own error, said to the agent in plain words rather than as a protocol error. */
export class ToolSaid extends Error {}

export type McpReply = { status: number; body: Record<string, unknown> | null };

type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
type Params = Record<string, unknown>;

const LIST_CACHE = { ttlMs: 300_000, cacheScope: "private" } as const;

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
    annotations: {
      title: tool.title,
      readOnlyHint: tool.readOnly,
      destructiveHint: false,
      idempotentHint: tool.idempotent ?? tool.readOnly,
      openWorldHint: false,
    },
    ...(apps && tool.appUri ? { _meta: { ui: { resourceUri: tool.appUri } } } : {}),
  };
}

const resourceEntry = (resource: McpResource) => ({
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

function capabilities(server: McpServer) {
  return {
    tools: { listChanged: false },
    resources: { subscribe: false, listChanged: false },
    extensions: {
      [APPS_EXTENSION]: { mimeTypes: [APP_MIME_TYPE] },
      ...(server.skills.length > 0 ? { [SKILLS_EXTENSION]: {} } : {}),
    },
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
        capabilities: capabilities(server),
        instructions: server.instructions,
        ...LIST_CACHE,
      });
    case "initialize": {
      const wanted = typeof given.protocolVersion === "string" ? given.protocolVersion : "";
      return answer({
        protocolVersion: LEGACY_VERSIONS.includes(wanted) ? wanted : LEGACY_VERSIONS[0],
        capabilities: capabilities(server),
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
      try {
        const result = await server.call(name, args);
        return answer({
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: Array.isArray(result) ? { items: result } : result,
          isError: false,
        });
      } catch (caught) {
        if (!(caught instanceof ToolSaid)) throw caught;
        return answer({ content: [{ type: "text", text: caught.message }], isError: true });
      }
    }
    case "resources/list":
      return cached({
        resources: [...server.apps, ...server.skills.flatMap((skill) => skill.files)].map(
          resourceEntry,
        ),
      });
    case "resources/templates/list":
      return cached({ resourceTemplates: [] });
    case "resources/read": {
      const uri = typeof given.uri === "string" ? given.uri : "";
      const found = [...server.apps, ...server.skills.flatMap((skill) => skill.files)].find(
        (resource) => resource.uri === uri,
      );
      if (!found) return failure(id, -32602, `There is no resource at ${uri || "(none)"}.`, 400);
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
      return cached({ prompts: [] });
    case "skills/list":
      return cached({ skills: await Promise.all(server.skills.map(skillEntry)) });
    case "skills/get": {
      const uri = typeof given.uri === "string" ? given.uri : "";
      const skill = server.skills.find((each) => `skill://${each.name}/SKILL.md` === uri);
      if (!skill) return failure(id, -32602, `There is no skill at ${uri || "(none)"}.`, 400);
      return cached({ skill: await skillEntry(skill) });
    }
    default:
      // 404 tells a 2026-07-28 client this is a modern server that lacks the method.
      return failure(id, -32601, `This server does not do ${method}.`, modern ? 404 : 200);
  }
}
