// A stand-in for Slack's Web API, for the browser tests and local runs.
// Its constants match e2e/slack-shared.ts. Any bot token
// that starts with "xoxb-stand-in-" is a workspace of its own (so each test run gets a
// fresh one); it answers the calls the dashboard and the agent make, and keeps what was
// posted so a test can read it back. Nothing here is used by the product.
//
//   GET  /stand-in/posted          messages the bot posted, oldest first
//   POST /stand-in/users           {id, email, name} a Slack user users.info will know
//   POST /stand-in/reset           forget posted messages
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export const SLACK_PORT = 8768;
export const SLACK_API = `http://127.0.0.1:${SLACK_PORT}/api/`;
export const TOKEN_PREFIX = "xoxb-stand-in-";
export const BOT_USER = "U0AGENTBOT";
export const WORKSPACE_NAME = "Salt House";

/** The workspace a stand-in token belongs to. */
export function teamOfToken(token) {
  return `T${token
    .slice(TOKEN_PREFIX.length)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")}`;
}

// The bot itself, as Slack knows it: no email address, so the dashboard never matches it.
const users = new Map([[BOT_USER, { email: null, name: "Agent", bot: true }]]);
let posted = [];
let ts = 1_700_000_000;

function read(request) {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      if (!body) return resolve({});
      if ((request.headers["content-type"] ?? "").includes("json")) {
        try {
          return resolve(JSON.parse(body));
        } catch {
          return resolve({});
        }
      }
      resolve(Object.fromEntries(new URLSearchParams(body)));
    });
  });
}

function send(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

const nextTs = () => `${++ts}.000100`;

function method(name, params, token) {
  if (!token?.startsWith(TOKEN_PREFIX) || token.length < TOKEN_PREFIX.length + 4) {
    return { ok: false, error: "invalid_auth" };
  }
  const team = teamOfToken(token);
  switch (name) {
    case "auth.test":
      return {
        ok: true,
        team_id: team,
        team: WORKSPACE_NAME,
        user_id: BOT_USER,
        user: "agent",
        bot_id: "B0AGENTBOT",
      };
    case "users.info": {
      const user = users.get(params.user);
      if (!user) return { ok: false, error: "user_not_found" };
      return {
        ok: true,
        user: {
          id: params.user,
          team_id: team,
          name: user.name,
          real_name: user.name,
          is_bot: Boolean(user.bot),
          deleted: false,
          profile: {
            ...(user.email ? { email: user.email } : {}),
            real_name: user.name,
            display_name: user.name,
          },
        },
      };
    }
    case "chat.postMessage":
    case "chat.postEphemeral": {
      const message = {
        method: name,
        channel: params.channel,
        thread_ts: params.thread_ts ?? null,
        text: params.text ?? "",
        markdown_text: params.markdown_text ?? null,
        blocks: params.blocks ?? null,
        ts: nextTs(),
      };
      posted.push(message);
      return { ok: true, channel: params.channel, ts: message.ts, message };
    }
    case "chat.update": {
      const found = posted.find((m) => m.ts === params.ts);
      if (found) {
        found.text = params.text ?? found.text;
        found.markdown_text = params.markdown_text ?? found.markdown_text;
      }
      return { ok: true, channel: params.channel, ts: params.ts };
    }
    case "conversations.replies":
    case "conversations.history":
      return { ok: true, messages: [], has_more: false };
    case "conversations.info":
      return { ok: true, channel: { id: params.channel, name: "video-team", is_im: false } };
    default:
      // Reactions, typing status and the like: accepted and forgotten.
      return { ok: true };
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${SLACK_PORT}`);
  if (request.method === "GET" && url.pathname === "/stand-in/posted") {
    return send(response, 200, posted);
  }
  if (request.method === "POST" && url.pathname === "/stand-in/users") {
    const user = await read(request);
    users.set(user.id, { email: user.email, name: user.name });
    return send(response, 200, { ok: true });
  }
  if (request.method === "POST" && url.pathname === "/stand-in/reset") {
    posted = [];
    return send(response, 200, { ok: true });
  }
  if (url.pathname.startsWith("/api/")) {
    const params = await read(request);
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : params.token;
    return send(response, 200, method(url.pathname.slice(5), params, token));
  }
  send(response, 404, { ok: false, error: "unknown_method" });
});

// Started as a program; imported (for the constants above) it does nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(SLACK_PORT, "127.0.0.1", () => {
    console.log(`Slack stand-in on ${SLACK_API}`);
  });
}
