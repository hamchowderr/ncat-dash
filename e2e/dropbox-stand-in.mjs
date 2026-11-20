// A stand-in for Dropbox, for the browser tests and local runs: its sign-in page (which
// signs in at once and sends the person back), its token requests, and the parts of its
// API the dashboard uses: who you are, folder listings and their changes, download links,
// and sending files in. It signs its notices with the app secret, as Dropbox does.
// Nothing here is used by the product.
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

import {
  DROPBOX,
  DROPBOX_ACCOUNT,
  DROPBOX_PORT,
  DROPBOX_SECRET,
  dropboxFile,
  dropboxFolder,
} from "./dropbox-data.mjs";

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

function startingTree() {
  return [
    dropboxFolder("/Raw footage"),
    dropboxFolder("/Raw footage/Day 1"),
    dropboxFolder("/Marketing", true),
    dropboxFile("/Raw footage/Day 1/Interview.mov", 48_000_000, 3),
    dropboxFile("/Raw footage/Voiceover.wav", 9_000_000, 5),
    dropboxFile("/Raw footage/Brief.pdf", 90_000, 5),
    dropboxFile("/Marketing/Logo.png", 40_000, 2),
  ];
}

// Who is signed in, and what is in their Dropbox. A browser test names its own account
// (POST /stand-in/account), since one Dropbox can be connected to only one team, and adds
// a file as someone dropping it into a folder would (POST /stand-in/file).
let account = DROPBOX_ACCOUNT;
let tree = startingTree();
// Changes not yet read through a folder's cursor.
let pending = [];
// Where the dashboard's notices go, learned from its sign-in.
let notify = null;
const received = [];

const under = (path, entry) => {
  const p = String(path).toLowerCase();
  return p === "" || entry.path_lower.startsWith(`${p}/`);
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", DROPBOX);
  const path = url.pathname;
  if (path === "/oauth2/authorize") {
    const back = new URL(url.searchParams.get("redirect_uri") ?? "");
    notify = `${back.origin}/dropbox/events`;
    back.searchParams.set("code", "stand-in-code");
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    response.writeHead(302, { location: back.toString() });
    return response.end();
  }
  if (path === "/oauth2/token" && request.method === "POST") {
    await read(request);
    return send(response, 200, {
      access_token: "stand-in-access",
      refresh_token: "stand-in-refresh",
      expires_in: 14_400,
      account_id: account.account_id,
    });
  }
  if (path === "/stand-in/account" && request.method === "POST") {
    account = { ...DROPBOX_ACCOUNT, ...JSON.parse((await read(request)) || "{}") };
    tree = startingTree();
    pending = [];
    return send(response, 200, account);
  }
  if (path === "/stand-in/file" && request.method === "POST") {
    const { path: filePath, size } = JSON.parse(await read(request));
    const added = dropboxFile(filePath, size);
    tree.push(added);
    pending.push(added);
    // Dropbox tells the app which accounts changed, signed with the app's secret.
    const body = JSON.stringify({ list_folder: { accounts: [account.account_id] } });
    const answer = notify
      ? await fetch(notify, {
          method: "POST",
          headers: {
            "x-dropbox-signature": createHmac("sha256", DROPBOX_SECRET).update(body).digest("hex"),
          },
          body,
        }).catch(() => null)
      : null;
    return send(response, 200, { told: answer?.status ?? 0 });
  }
  if (path === "/stand-in/received") return send(response, 200, received);

  if (path.startsWith("/2/")) {
    const call = path.slice(3);
    const raw = await read(request);
    if (call.startsWith("files/upload")) {
      const arg = JSON.parse(request.headers["dropbox-api-arg"] ?? "{}");
      received.push({ call, arg, bytes: raw.length });
      if (call === "files/upload_session/start") return send(response, 200, { session_id: "s1" });
      if (call === "files/upload_session/append_v2") return send(response, 200, null);
      return send(response, 200, { path_display: (arg.commit ?? arg).path });
    }
    const body = raw ? JSON.parse(raw) : {};
    if (call === "users/get_current_account") return send(response, 200, account);
    if (call === "auth/token/revoke") return send(response, 200, null);
    if (call === "files/get_metadata") {
      const found = tree.find((one) => one.path_lower === String(body.path).toLowerCase());
      return found
        ? send(response, 200, found)
        : send(response, 409, { error_summary: "path/not_found/" });
    }
    if (call === "files/list_folder") {
      const entries = body.recursive
        ? tree.filter((one) => under(body.path, one))
        : tree.filter(
            (one) =>
              under(body.path, one) &&
              !one.path_lower.slice(String(body.path).length + 1).includes("/"),
          );
      return send(response, 200, { entries, cursor: `list:${body.path}`, has_more: false });
    }
    if (call === "files/list_folder/get_latest_cursor") {
      pending = pending.filter((one) => !under(body.path, one));
      // A folder watched on its own (not the folders inside it) gets a "flat" cursor.
      return send(response, 200, { cursor: `watch${body.recursive ? "" : "flat"}:${body.path}` });
    }
    if (call === "files/list_folder/continue") {
      const flat = String(body.cursor).startsWith("watchflat:");
      const at = String(body.cursor).replace(/^watch(flat)?:/, "");
      const mine = pending.filter(
        (one) => under(at, one) && (!flat || !one.path_lower.slice(at.length + 1).includes("/")),
      );
      pending = pending.filter((one) => !mine.includes(one));
      return send(response, 200, { entries: mine, cursor: body.cursor, has_more: false });
    }
    if (call === "files/get_temporary_link") {
      return send(response, 200, { link: "http://127.0.0.1:8766/clip.webm" });
    }
  }
  if (path === "/health") return send(response, 200, { ok: true });
  send(response, 404, { error_summary: "unknown/" });
});

server.listen(DROPBOX_PORT, "127.0.0.1");
