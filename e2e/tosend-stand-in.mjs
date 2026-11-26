// A stand-in for toSend's email API, for the browser tests and local runs. It takes
// single emails and batches, answers as toSend does, and keeps them so a test can read
// them back. Nothing here is used by the product.
//
//   GET  /v2/info            the account and its one verified domain
//   POST /v2/emails          one email; answers { message_id }
//   POST /v2/emails/batch    up to 100; answers { results: [{ status, message_id }] }
//   GET  /stand-in/sent      every email taken, oldest first, batches flattened
//   GET  /health             answers when the stand-in is up
import { createServer } from "node:http";

export const TOSEND_PORT = 8775;
export const TOSEND_API = `http://127.0.0.1:${TOSEND_PORT}`;

const sent = [];
let id = 0;

createServer((request, response) => {
  const url = new URL(request.url ?? "/", TOSEND_API);
  const reply = (status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (url.pathname === "/health") return reply(200, { ok: true });
  if (url.pathname === "/stand-in/sent") return reply(200, sent);
  if (url.pathname === "/v2/info") {
    return reply(200, {
      account: { id: 1, title: "Stand-in", status: "active" },
      domains: [{ domain_name: "example.test", verification_status: "verified" }],
    });
  }
  if (request.method !== "POST") return reply(404, { message: "Not found" });
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    let parsed;
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      return reply(400, { message: "Bad JSON" });
    }
    if (url.pathname === "/v2/emails") {
      sent.push(parsed);
      return reply(200, { message_id: `standin-${(id += 1)}` });
    }
    if (url.pathname === "/v2/emails/batch") {
      const emails = Array.isArray(parsed.emails) ? parsed.emails : [];
      sent.push(...emails);
      return reply(200, {
        results: emails.map(() => ({ status: "success", message_id: `standin-${(id += 1)}` })),
      });
    }
    return reply(404, { message: "Not found" });
  });
}).listen(TOSEND_PORT, "127.0.0.1");
