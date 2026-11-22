// Drives the built desktop app through tauri-driver: connect to a dashboard, get turned
// away by a site that isn't one, and come straight back to the dashboard on the next start.
//
//   pnpm tauri build --debug --no-bundle
//   pnpm test:e2e            (Linux needs webkit2gtk-driver and a display, e.g. xvfb-run)

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { NAME } from "../src/product";
import { Session } from "./webdriver";

const application = path.resolve(
  __dirname,
  "../src-tauri/target/debug",
  process.platform === "win32" ? "ncat-dash-desktop.exe" : "ncat-dash-desktop",
);
const DRIVER_PORT = 4444;
const driverUrl = `http://127.0.0.1:${DRIVER_PORT}`;

// The stand-in dashboard's page. Like the real one (src/lib/desktop.ts), it asks the app
// to show the unseen count and a notification, and writes down whether the app allowed it.
const STAND_IN_PAGE = `<!doctype html><title>Stand-in dashboard</title>
<h1 id=signed-in>Your automations</h1><p id=bridge>waiting</p>
<script>
  const say = (text) => (document.getElementById("bridge").textContent = text);
  const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
  if (!invoke) say("no bridge");
  else
    invoke("set_unseen", { count: 3 })
      .then(() => invoke("notify", { title: "Weekly clips failed", body: "Captions: the toolkit is offline" }))
      .then((shown) => say("allowed, notification " + (shown ? "shown" : "skipped")))
      .catch((error) => say("refused: " + error));
</script>`;

let driver: ChildProcess;
let server: Server;
let otherSite: Server;
let elsewhere: Server;
let elsewhereAddress: string;
let serverAddress: string;
let otherSiteAddress: string;

function listen(handler: Parameters<typeof createServer>[1]): Promise<[Server, string]> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve([server, `127.0.0.1:${port}`]);
    });
  });
}

async function waitForDriver() {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${driverUrl}/status`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("tauri-driver did not start");
}

beforeAll(async () => {
  // A stand-in dashboard: answers the address check and serves a page.
  [server, serverAddress] = await listen((req, res) => {
    if (req.url === "/api/desktop") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"app":"ncat-dash"}');
    } else {
      res.writeHead(200, { "content-type": "text/html" }).end(STAND_IN_PAGE);
    }
  });
  // Another site with the same page, to check it gets nothing from the app.
  [elsewhere, elsewhereAddress] = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" }).end(STAND_IN_PAGE);
  });
  [otherSite, otherSiteAddress] = await listen((_req, res) => {
    res.writeHead(404).end("not found");
  });
  // A fresh settings folder, so the app starts as if newly installed.
  const home = mkdtempSync(path.join(tmpdir(), "ncat-dash-desktop-"));
  // On Windows tauri-driver drives Edge's WebView2 through msedgedriver (see the workflow).
  const native = process.env.NATIVE_DRIVER ? ["--native-driver", process.env.NATIVE_DRIVER] : [];
  driver = spawn("tauri-driver", ["--port", String(DRIVER_PORT), ...native], {
    stdio: "inherit",
    env: { ...process.env, XDG_CONFIG_HOME: home, APPDATA: home, HOME: home },
  });
  await waitForDriver();
}, 30000);

afterAll(() => {
  driver?.kill();
  server?.close();
  otherSite?.close();
  elsewhere?.close();
});

describe("connecting the desktop app to a dashboard", () => {
  test("turns away a site that isn't the dashboard, then opens the real one", async () => {
    const app = await Session.start(driverUrl, application);
    try {
      await app.waitFor("h1", (text) => text === `Connect to your ${NAME}`);
      const input = await app.find("#address");

      await app.type(input, otherSiteAddress);
      await app.click(await app.find(".address-form button"));
      await app.waitFor(".error", (text) => text.includes(`isn't ${NAME}`));

      await app.type(input, serverAddress);
      await app.click(await app.find(".address-form button"));
      await app.waitFor("#signed-in", (text) => text === "Your automations");
      expect(await app.title()).toBe("Stand-in dashboard");
      expect(await app.url()).toBe(`http://${serverAddress}/`);
      // The dashboard may ask for the unseen count and notifications, and nothing else.
      await app.waitFor("#bridge", (text) => text.startsWith("allowed"));
    } finally {
      await app.end();
    }
  }, 60000);

  test("opens the same dashboard straight away on the next start", async () => {
    const app = await Session.start(driverUrl, application);
    try {
      await app.waitFor("#signed-in", (text) => text === "Your automations");

      // A site the dashboard links to gets none of the app's commands.
      await app.navigate(`http://${elsewhereAddress}/`);
      await app.waitFor("#bridge", (text) => text !== "waiting" && !text.startsWith("allowed"));
    } finally {
      await app.end();
    }
  }, 60000);
});
