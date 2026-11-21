// A stand-in for Telegram's Bot API, for the browser tests and local runs. It answers
// what the dashboard sends (sendMessage, editMessageText) and keeps it so a test can read
// it back. The bot it plays is in privacy mode, as every new Telegram bot is, and is not
// an admin of any group. Nothing here is used by the product.
//
//   POST /bot<token>/<method>   a Bot API call; answers { ok: true, result: { message_id } }
//   GET  /stand-in/sent         the calls made, oldest first
//   GET  /health                answers when the stand-in is up
import { createServer } from "node:http";

export const TELEGRAM_PORT = 8774;
export const TELEGRAM_API = `http://127.0.0.1:${TELEGRAM_PORT}`;

const sent = [];
let messageId = 1000;

createServer((request, response) => {
  const url = new URL(request.url ?? "/", TELEGRAM_API);
  const reply = (status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (url.pathname === "/health") return reply(200, { ok: true });
  if (url.pathname === "/stand-in/sent") return reply(200, sent);
  const call = /^\/bot[^/]+\/(\w+)$/.exec(url.pathname);
  if (!call || request.method !== "POST")
    return reply(404, { ok: false, description: "Not found" });
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      return reply(400, { ok: false, description: "Bad JSON" });
    }
    if (call[1] === "getMe") {
      return reply(200, {
        ok: true,
        result: {
          id: 777,
          is_bot: true,
          username: "TakewonStandInBot",
          can_read_all_group_messages: false,
        },
      });
    }
    if (call[1] === "getChatMember") return reply(200, { ok: true, result: { status: "member" } });
    const result = { message_id: ++messageId };
    sent.push({ method: call[1], body: parsed, result });
    reply(200, { ok: true, result });
  });
}).listen(TELEGRAM_PORT, "127.0.0.1");
