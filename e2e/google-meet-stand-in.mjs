// A stand-in for Google, for the browser tests and local runs: its sign-in page (which
// signs in at once and sends the person back), its token and user requests, and one
// account's Meet recordings with their Drive files. Nothing here is used by the product.
import { createServer } from "node:http";

import {
  GOOGLE,
  GOOGLE_PORT,
  GOOGLE_USER,
  meeting,
  oldRecording,
  sharedRecording,
} from "./google-meet-data.mjs";

const SCOPES =
  "openid email profile https://www.googleapis.com/auth/meetings.space.readonly https://www.googleapis.com/auth/drive.meet.readonly";

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

// Who is signed in to Google. A browser test names its own account (POST /stand-in/user),
// since one Google account can be connected to only one team.
let user = GOOGLE_USER;
// The account's meetings: one from two days ago to start with; a test adds more.
let meetings = [meeting()];

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", GOOGLE);
  if (url.pathname === "/o/oauth2/v2/auth") {
    const back = new URL(url.searchParams.get("redirect_uri") ?? "");
    back.searchParams.set("code", "stand-in-code");
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    response.writeHead(302, { location: back.toString() });
    return response.end();
  }
  if (url.pathname === "/token" && request.method === "POST") {
    await read(request);
    return send(response, 200, {
      access_token: "stand-in-access",
      refresh_token: "stand-in-refresh",
      expires_in: 3599,
      scope: SCOPES,
    });
  }
  if (url.pathname === "/revoke") return send(response, 200, {});
  if (url.pathname === "/stand-in/user" && request.method === "POST") {
    user = { ...GOOGLE_USER, ...JSON.parse((await read(request)) || "{}") };
    meetings = [meeting()];
    return send(response, 200, user);
  }
  if (url.pathname === "/stand-in/meeting" && request.method === "POST") {
    const { id, title } = JSON.parse((await read(request)) || "{}");
    meetings.push(meeting(id, title, 0));
    return send(response, 200, { ok: true });
  }
  if (url.pathname === "/v1/userinfo") return send(response, 200, user);
  if (url.pathname === "/v2/conferenceRecords") {
    // Only end_time>="..." is understood, which is all the dashboard asks.
    const since = Date.parse(/end_time>="([^"]+)"/.exec(url.searchParams.get("filter") ?? "")?.[1]);
    return send(response, 200, {
      conferenceRecords: meetings
        .map((one) => one.conference)
        .filter((one) => !Number.isFinite(since) || Date.parse(one.endTime) >= since),
    });
  }
  const recordingsOf = /^\/v2\/(conferenceRecords\/[^/]+)\/recordings$/.exec(url.pathname);
  if (recordingsOf) {
    return send(response, 200, {
      recordings: meetings
        .filter((one) => one.conference.name === recordingsOf[1])
        .map((one) => one.recording),
    });
  }
  const oneRecording = /^\/v2\/(conferenceRecords\/.+\/recordings\/.+)$/.exec(url.pathname);
  if (oneRecording) {
    const found = meetings.find((one) => one.recording.name === oneRecording[1]);
    return found ? send(response, 200, found.recording) : send(response, 404, {});
  }
  // Drive's files Meet made: every meeting's recording, one from long ago, and one someone
  // else shared.
  const files = () => [...meetings.map((one) => one.file), oldRecording(), sharedRecording()];
  if (url.pathname === "/drive/v3/files") {
    // One page, newest first, is all the browser tests need.
    return send(response, 200, {
      files: files().sort((a, b) => b.createdTime.localeCompare(a.createdTime)),
    });
  }
  const file = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
  if (file) {
    const found = files().find((one) => one.id === file[1]);
    return found ? send(response, 200, found) : send(response, 404, {});
  }
  if (url.pathname === "/health") return send(response, 200, { ok: true });
  send(response, 404, { message: "unknown" });
});

server.listen(GOOGLE_PORT, "127.0.0.1");
