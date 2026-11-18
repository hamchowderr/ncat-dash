/**
 * A small MCP server over Streamable HTTP, without sessions: each POST carries one
 * JSON-RPC message and gets one JSON answer. That is all an MCP client needs to list
 * and call tools, and it fits a Convex HTTP action, which cannot hold a stream open.
 */

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Whether the tool only reads, for clients that ask before running a tool that acts. */
  readOnly: boolean;
};

/** A tool's own error, said to the agent in plain words rather than as a protocol error. */
export class ToolSaid extends Error {}

type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

const SERVER_INFO = { name: "ncat-dash", title: "Content automations", version: "1.0.0" };

function answer(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function failure(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

/**
 * The answer to one JSON-RPC message, or null for a notification (which gets a bare 202).
 * `call` runs a tool; throwing ToolSaid gives the agent the message as a tool error.
 */
export async function handleMcpMessage(
  message: unknown,
  tools: McpTool[],
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  instructions: string,
): Promise<Record<string, unknown> | null> {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return failure(null, -32600, "Send one JSON-RPC message as a JSON object.");
  }
  const { id, method, params } = message as Message;
  if (typeof method !== "string") return failure(id, -32600, "The message has no method.");
  // A notification (no id) needs no answer: initialized, cancelled and the like.
  if (id === undefined || id === null) return null;
  const given = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;

  switch (method) {
    case "initialize": {
      const asked = typeof given.protocolVersion === "string" ? given.protocolVersion : "";
      return answer(id, {
        protocolVersion: MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions,
      });
    }
    case "ping":
      return answer(id, {});
    case "tools/list":
      return answer(id, {
        tools: tools.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: {
            title: tool.title,
            readOnlyHint: tool.readOnly,
            destructiveHint: false,
            openWorldHint: false,
          },
        })),
      });
    case "tools/call": {
      const name = typeof given.name === "string" ? given.name : "";
      if (!tools.some((tool) => tool.name === name)) {
        return failure(id, -32602, `There is no tool called ${name || "(none)"}.`);
      }
      const args =
        given.arguments && typeof given.arguments === "object" && !Array.isArray(given.arguments)
          ? (given.arguments as Record<string, unknown>)
          : {};
      try {
        const result = await call(name, args);
        return answer(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: Array.isArray(result) ? { items: result } : result,
          isError: false,
        });
      } catch (caught) {
        if (!(caught instanceof ToolSaid)) throw caught;
        return answer(id, { content: [{ type: "text", text: caught.message }], isError: true });
      }
    }
    case "resources/list":
      return answer(id, { resources: [] });
    case "prompts/list":
      return answer(id, { prompts: [] });
    default:
      return failure(id, -32601, `This server does not do ${method}.`);
  }
}
