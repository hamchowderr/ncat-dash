// Drives the built desktop app through tauri-driver: connect to a Kontifi, get turned
// away by a site that isn't one, and come straight back to the Kontifi on the next start.
//
//   pnpm tauri build --debug --no-bundle
//   pnpm test:e2e            (Linux needs webkit2gtk-driver and a display, e.g. xvfb-run)

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { Session } from "./webdriver";

const application = path.resolve(
  __dirname,
  "../src-tauri/target/debug",
  process.platform === "win32" ? "kontifi-desktop.exe" : "kontifi-desktop",
);
const DRIVER_PORT = 4444;
const driverUrl = `http://127.0.0.1:${DRIVER_PORT}`;

let driver: ChildProcess;
let kontifi: Server;
let notKontifi: Server;
let kontifiAddress: string;
let notKontifiAddress: string;

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
  // A stand-in Kontifi: answers the address check and serves a page.
  [kontifi, kontifiAddress] = await listen((req, res) => {
    if (req.url === "/api/kontifi") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"app":"kontifi"}');
    } else {
      res
        .writeHead(200, { "content-type": "text/html" })
        .end(
          "<!doctype html><title>Stand-in Kontifi</title><h1 id=signed-in>Your automations</h1>",
        );
    }
  });
  [notKontifi, notKontifiAddress] = await listen((_req, res) => {
    res.writeHead(404).end("not found");
  });
  // A fresh settings folder, so the app starts as if newly installed.
  const home = mkdtempSync(path.join(tmpdir(), "kontifi-desktop-"));
  driver = spawn("tauri-driver", ["--port", String(DRIVER_PORT)], {
    stdio: "inherit",
    env: { ...process.env, XDG_CONFIG_HOME: home, APPDATA: home, HOME: home },
  });
  await waitForDriver();
}, 30000);

afterAll(() => {
  driver?.kill();
  kontifi?.close();
  notKontifi?.close();
});

describe("connecting the desktop app to a Kontifi", () => {
  test("turns away a site that isn't a Kontifi, then opens the real one", async () => {
    const app = await Session.start(driverUrl, application);
    try {
      await app.waitFor("h1", (text) => text === "Connect to your Kontifi");
      const input = await app.find("#address");

      await app.type(input, notKontifiAddress);
      await app.click(await app.find(".address-form button"));
      await app.waitFor(".error", (text) => text.includes("isn't a Kontifi"));

      await app.type(input, kontifiAddress);
      await app.click(await app.find(".address-form button"));
      await app.waitFor("#signed-in", (text) => text === "Your automations");
      expect(await app.title()).toBe("Stand-in Kontifi");
      expect(await app.url()).toBe(`http://${kontifiAddress}/`);
    } finally {
      await app.end();
    }
  }, 60000);

  test("opens the same Kontifi straight away on the next start", async () => {
    const app = await Session.start(driverUrl, application);
    try {
      await app.waitFor("#signed-in", (text) => text === "Your automations");
    } finally {
      await app.end();
    }
  }, 60000);
});
