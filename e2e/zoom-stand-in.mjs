// A stand-in for Zoom, for the browser tests and local runs: its sign-in page (which
// signs in at once and sends the person back), its token and user requests, and one
// account's cloud recordings. Nothing here is used by the product.
import { createServer } from "node:http";

import { meeting, ZOOM, ZOOM_PORT, ZOOM_USER } from "./zoom-data.mjs";

function read(request) {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => resolve(body));
  });
}

function send(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

// Who is signed in to Zoom. A browser test names its own account (POST /stand-in/user),
// since one Zoom account can be connected to only one team.
let user = ZOOM_USER;

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", ZOOM);
  if (url.pathname === "/oauth/authorize") {
    const back = new URL(url.searchParams.get("redirect_uri") ?? "");
    back.searchParams.set("code", "stand-in-code");
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    response.writeHead(302, { location: back.toString() });
    return response.end();
  }
  if (url.pathname === "/oauth/token" && request.method === "POST") {
    await read(request);
    return send(response, 200, {
      access_token: "stand-in-access",
      refresh_token: "stand-in-refresh",
      expires_in: 3600,
    });
  }
  if (url.pathname === "/oauth/revoke") return send(response, 200, {});
  if (url.pathname === "/stand-in/user" && request.method === "POST") {
    user = { ...ZOOM_USER, ...JSON.parse((await read(request)) || "{}") };
    return send(response, 200, user);
  }
  if (url.pathname === "/v2/users/me") return send(response, 200, user);
  // Like real Zoom: the one-call account list is only for master accounts.
  if (url.pathname.startsWith("/v2/accounts/")) {
    return send(response, 400, { code: 200, message: "Only available for master account." });
  }
  // The whole account, host by host: a colleague as well as the signed-in admin.
  if (url.pathname === "/v2/users") {
    return send(response, 200, { users: [{ id: user.id }, { id: `${user.id}-colleague` }] });
  }
  if (url.pathname === `/v2/users/${user.id}-colleague/recordings`) {
    return send(response, 200, {
      meetings: [meeting(`team-meeting-${user.id}==`, "Team Standup", `${user.id}-colleague`)],
    });
  }
  if (url.pathname === `/v2/users/${user.id}/recordings`) {
    return send(response, 200, { meetings: [meeting(undefined, undefined, user.id)] });
  }
  if (url.pathname === "/v2/users/me/recordings") {
    return send(response, 200, {
      meetings: [meeting(undefined, undefined, user.id)],
    });
  }
  if (url.pathname === "/health") return send(response, 200, { ok: true });
  send(response, 404, { message: "unknown" });
});

server.listen(ZOOM_PORT, "127.0.0.1");
