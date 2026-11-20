// A stand-in for Microsoft, for the browser tests and local runs: its sign-in page (which
// signs in at once and sends the person back), its token requests, and the parts of
// Microsoft Graph the dashboard uses: who you are, the OneDrive Recordings folder, watches
// on the OneDrive, and the search that finds recordings other people shared with you.
// Nothing here is used by the product.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import {
  MICROSOFT,
  MICROSOFT_PORT,
  MICROSOFT_USER,
  recording,
  TEAMS_TEAM,
} from "./microsoft-data.mjs";

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

// Who is signed in, and what is in their Recordings folder. A browser test names its own
// account (POST /stand-in/user), since one account can be connected to only one team,
// and adds a recording as Teams would (POST /stand-in/recording).
let user = MICROSOFT_USER;
let files = [recording("past-1", "Client Kickoff", 2 * 24 * 60)];
// Recordings of other people's meetings, in their OneDrive, shared with the account.
let shared = [];
const watches = new Map();
// What the Teams bot posted.
const posts = [];

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", MICROSOFT);
  const path = url.pathname;
  if (path === "/common/oauth2/v2.0/authorize") {
    const back = new URL(url.searchParams.get("redirect_uri") ?? "");
    back.searchParams.set("code", "stand-in-code");
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    response.writeHead(302, { location: back.toString() });
    return response.end();
  }
  if (path === "/common/oauth2/v2.0/token" && request.method === "POST") {
    await read(request);
    // The id token names the account's organization, as Microsoft's does ("tid").
    const claims = Buffer.from(JSON.stringify({ tid: user.tid, oid: user.id })).toString(
      "base64url",
    );
    return send(response, 200, {
      access_token: "stand-in-access",
      refresh_token: "stand-in-refresh",
      id_token: `e30.${claims}.stand-in`,
      expires_in: 3600,
    });
  }
  // The Teams bot's own token, and the parts of the Bot Framework API the dashboard uses:
  // a team's channels, and posting to one. Posts are kept for the tests to read.
  if (path === "/botframework.com/oauth2/v2.0/token" && request.method === "POST") {
    await read(request);
    return send(response, 200, { access_token: "stand-in-bot", expires_in: 3600 });
  }
  if (path.startsWith("/bot/v3/teams/") && path.endsWith("/conversations")) {
    return send(response, 200, {
      conversations: [
        { id: TEAMS_TEAM.id, name: null },
        { id: "19:edits@thread.tacv2", name: "Edits" },
      ],
    });
  }
  if (path.startsWith("/bot/v3/conversations/") && request.method === "POST") {
    posts.push({ path, body: JSON.parse(await read(request)) });
    return send(response, 201, { id: String(posts.length) });
  }
  if (path === "/stand-in/posts") return send(response, 200, posts);
  if (path === "/v1.0/organization") {
    return send(response, 200, { value: [{ id: user.tid, displayName: "Harbour Films Ltd" }] });
  }
  if (path === "/stand-in/user" && request.method === "POST") {
    user = { ...MICROSOFT_USER, ...JSON.parse((await read(request)) || "{}") };
    files = [recording("past-1", "Client Kickoff", 2 * 24 * 60)];
    shared = [];
    return send(response, 200, user);
  }
  if (path === "/stand-in/recording" && request.method === "POST") {
    const { id, topic } = JSON.parse(await read(request));
    files.unshift(recording(id, topic, 0));
    // Microsoft tells every watch that the OneDrive changed.
    for (const [subscriptionId, watch] of watches) {
      await fetch(watch.notificationUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          value: [{ subscriptionId, clientState: watch.clientState, changeType: "updated" }],
        }),
      });
    }
    return send(response, 200, { watches: watches.size });
  }
  if (path === "/stand-in/shared" && request.method === "POST") {
    const { id, topic, size } = JSON.parse(await read(request));
    shared.unshift({ ...recording(id, topic, 0), size });
    return send(response, 200, { shared: shared.length });
  }
  if (path === "/v1.0/me") return send(response, 200, user);
  if (path.startsWith("/v1.0/me/drive/search(")) {
    return send(response, 200, {
      value: shared.map((file) => ({
        id: `hit-${file.id}`,
        name: file.name,
        remoteItem: { id: file.id, parentReference: { driveId: "drive-colleague" } },
      })),
    });
  }
  if (path.startsWith("/v1.0/drives/drive-colleague/items/")) {
    const id = decodeURIComponent(path.slice("/v1.0/drives/drive-colleague/items/".length));
    const file = shared.find((one) => one.id === id);
    if (!file) return send(response, 404, { error: { code: "itemNotFound" } });
    return send(response, 200, {
      ...file,
      "@microsoft.graph.downloadUrl": "http://127.0.0.1:8766/clip.webm",
    });
  }
  if (path === "/v1.0/me/drive/special/recordings") {
    return send(response, 200, { id: "folder-rec", name: "Recordings", folder: {} });
  }
  if (path === "/v1.0/me/drive/items/folder-rec/children") {
    return send(response, 200, { value: files });
  }
  if (path.startsWith("/v1.0/me/drive/items/")) {
    const id = decodeURIComponent(path.slice("/v1.0/me/drive/items/".length));
    const file = files.find((one) => one.id === id);
    if (!file) return send(response, 404, { error: { code: "itemNotFound" } });
    return send(response, 200, {
      ...file,
      "@microsoft.graph.downloadUrl": "http://127.0.0.1:8766/clip.webm",
    });
  }
  if (path === "/v1.0/subscriptions" && request.method === "POST") {
    const body = JSON.parse(await read(request));
    // Microsoft checks the address answers with its token before agreeing to the watch.
    const check = await fetch(`${body.notificationUrl}?validationToken=stand-in-check`, {
      method: "POST",
    }).catch(() => null);
    if (!check || (await check.text()) !== "stand-in-check") {
      return send(response, 400, { error: { code: "ValidationError" } });
    }
    const id = randomUUID();
    watches.set(id, body);
    return send(response, 201, { id, expirationDateTime: body.expirationDateTime });
  }
  if (path.startsWith("/v1.0/subscriptions/")) {
    const id = decodeURIComponent(path.slice("/v1.0/subscriptions/".length));
    if (request.method === "DELETE") watches.delete(id);
    return send(response, watches.has(id) || request.method === "DELETE" ? 200 : 404, { id });
  }
  if (path === "/health") return send(response, 200, { ok: true });
  send(response, 404, { error: { code: "unknown" } });
});

server.listen(MICROSOFT_PORT, "127.0.0.1");
