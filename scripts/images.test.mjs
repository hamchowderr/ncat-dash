// Keeps the self-hosted images working on any machine. Run with `node --test` (part of
// `pnpm test`).
//
// - Every image Kontentifi publishes is built for Intel/AMD and for ARM (Apple-chip Macs),
//   each on its own kind of GitHub runner, and joined under one tag.
// - The web app's image and its start script agree on the stand-in addresses, and the
//   start script swaps them for the real ones.
// - deploy/compose.yml runs the web app from its image.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

for (const workflow of ["agent-image.yml", "web-image.yml"]) {
  test(`${workflow} builds for both processors on their own runners and joins them`, () => {
    const text = read(`.github/workflows/${workflow}`);
    assert.match(text, /arch: amd64\s+runner: ubuntu-latest/);
    assert.match(text, /arch: arm64\s+runner: ubuntu-24\.04-arm/);
    assert.match(text, /platforms: linux\/\$\{\{ matrix\.arch \}\}/);
    // Never through emulation: no QEMU set-up.
    assert.doesNotMatch(text, /setup-qemu-action/);
    assert.match(text, /imagetools create/);
    assert.match(text, /digests\/amd64.*digests\/arm64/s);
  });
}

test("the web image's stand-in addresses are the ones its start script replaces", () => {
  const dockerfile = read("Dockerfile");
  const start = read("deploy/web/start.sh");
  const standIns = [...dockerfile.matchAll(/NEXT_PUBLIC_CONVEX(?:_SITE)?_URL=(\S+)/g)].map(
    (m) => m[1],
  );
  assert.equal(standIns.length, 2);
  for (const address of standIns) {
    assert.ok(
      start.includes(address.replace(/\./g, "\\.")),
      `${address} is not replaced by start.sh`,
    );
  }
});

test("the start script writes the real addresses into a clean copy each time", () => {
  const app = mkdtempSync(join(tmpdir(), "kontentifi-web-"));
  const chunk = join(app, ".next/static/chunk.js");
  const pristine = join(app, ".pristine", chunk);
  mkdirSync(dirname(chunk), { recursive: true });
  mkdirSync(dirname(pristine), { recursive: true });
  const built =
    'new C("https://convex-url.kontentifi.invalid");fetch("https://convex-site-url.kontentifi.invalid/mcp")';
  writeFileSync(chunk, built);
  writeFileSync(pristine, built);
  writeFileSync(join(app, ".stand-ins"), `${chunk}\n`);
  // The script ends by starting the server; stop just before, with paths moved to the test folder.
  const script = read("deploy/web/start.sh")
    .replaceAll("/app/", `${app}/`)
    .replace(/^cd \/app\nexec node server\.js$/m, "exit 0");
  const path = join(app, "start.sh");
  writeFileSync(path, script);
  const run = (env) =>
    execFileSync("sh", [path], {
      env: { PATH: process.env.PATH, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

  run({
    NEXT_PUBLIC_CONVEX_URL: "https://api.example.com/",
    NEXT_PUBLIC_CONVEX_SITE_URL: "https://site.example.com",
  });
  assert.equal(
    readFileSync(chunk, "utf8"),
    'new C("https://api.example.com");fetch("https://site.example.com/mcp")',
  );
  // A restart with new addresses starts from the clean copy, not the last one.
  run({
    NEXT_PUBLIC_CONVEX_URL: "https://api.other.example",
    NEXT_PUBLIC_CONVEX_SITE_URL: "https://site.other.example",
  });
  assert.equal(
    readFileSync(chunk, "utf8"),
    'new C("https://api.other.example");fetch("https://site.other.example/mcp")',
  );
  // A missing or odd address stops it with a plain message, before anything is written.
  assert.throws(
    () => run({ NEXT_PUBLIC_CONVEX_SITE_URL: "https://site.example.com" }),
    /NEXT_PUBLIC_CONVEX_URL/,
  );
  assert.throws(
    () =>
      run({
        NEXT_PUBLIC_CONVEX_URL: "https://a.example|rm",
        NEXT_PUBLIC_CONVEX_SITE_URL: "https://b.example",
      }),
    /characters/,
  );
});

test("compose runs the web app from its image, beside the rest", () => {
  const compose = read("deploy/compose.yml");
  assert.match(
    compose,
    /^  web:\n    image: \$\{WEB_IMAGE:-ghcr\.io\/hamchowderr\/ncat-dash-web:latest\}/m,
  );
  assert.match(compose, /127\.0\.0\.1:3000:3000/);
  assert.match(compose, /NEXT_PUBLIC_CONVEX_URL: \$\{CONVEX_URL/);
  assert.match(compose, /MASTRA_SERVER_URL: \$\{MASTRA_SERVER_URL:-http:\/\/agent:4111\}/);
});

test("the web app only builds a standalone server for the image", () => {
  assert.match(read("next.config.ts"), /NEXT_OUTPUT === "standalone"/);
  assert.match(read("Dockerfile"), /NEXT_OUTPUT=standalone/);
});
