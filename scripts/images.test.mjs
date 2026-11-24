// Keeps the self-hosted images working on any machine. Run with `node --test` (part of
// `pnpm test`).
//
// - Every image Takewon publishes is built for Intel/AMD and for ARM (Apple-chip Macs),
//   each on its own kind of GitHub runner, and joined under one tag.
// - The web app's image and its start script agree on the stand-in addresses, and the
//   start script swaps them for the real ones.
// - deploy/compose.yml runs the web app from its image.
// - The setup image pushes the backend and makes its secrets once, never replacing them.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  const app = mkdtempSync(join(tmpdir(), "takewon-web-"));
  const chunk = join(app, ".next/static/chunk.js");
  const pristine = join(app, ".pristine", chunk);
  mkdirSync(dirname(chunk), { recursive: true });
  mkdirSync(dirname(pristine), { recursive: true });
  const built =
    'new C("https://convex-url.takewon.invalid");fetch("https://convex-site-url.takewon.invalid/mcp")';
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
    /^  web:\n    image: \$\{WEB_IMAGE:-ghcr\.io\/hamchowderr\/takewon-web:latest\}/m,
  );
  assert.match(compose, /127\.0\.0\.1:3000:3000/);
  assert.match(compose, /NEXT_PUBLIC_CONVEX_URL: \$\{CONVEX_URL/);
  assert.match(compose, /MASTRA_SERVER_URL: \$\{MASTRA_SERVER_URL:-http:\/\/agent:4111\}/);
});

test("the web app only builds a standalone server for the image", () => {
  assert.match(read("next.config.ts"), /NEXT_OUTPUT === "standalone"/);
  assert.match(read("Dockerfile"), /NEXT_OUTPUT=standalone/);
});

test("compose runs the setup image only when asked, on the web image's commit", () => {
  const compose = read("deploy/compose.yml");
  assert.match(
    compose,
    /^  setup:\n    image: \$\{SETUP_IMAGE:-ghcr\.io\/hamchowderr\/takewon-setup:latest\}\n    profiles: \[setup\]/m,
  );
  assert.match(compose, /CONVEX_SELF_HOSTED_ADMIN_KEY: \$\{CONVEX_ADMIN_KEY/);
  assert.match(read("Dockerfile"), /^FROM source AS setup$/m);
  // The web image stays the default target.
  assert.match(read("Dockerfile"), /^FROM node:22-bookworm-slim AS web$(?![\s\S]*^FROM )/m);
  const workflow = read(".github/workflows/web-image.yml");
  assert.match(workflow, /target: setup/);
  assert.match(workflow, /SETUP_IMAGE: takewon-setup:check/);
});

describe("the setup script", () => {
  // A stand-in Convex command that keeps its settings in a file, and a Convex that answers.
  function setUp() {
    const dir = mkdtempSync(join(tmpdir(), "takewon-setup-"));
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const settings = join(dir, "settings");
    writeFileSync(settings, "");
    const fake = (name, body) => {
      writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    fake(
      "convex",
      `log=${join(dir, "log")}
echo "$*" >> "$log"
case "$1 $2" in
  "env list") cat ${settings} ;;
  "env set") grep -v "^$3=" ${settings} > ${settings}.new; echo "$3=$4" >> ${settings}.new; mv ${settings}.new ${settings} ;;
  "deploy -y") [ "$(pwd)" = "${dir}" ] || exit 9 ;;
  *) exit 2 ;;
esac`,
    );
    const script = join(dir, "setup.sh");
    writeFileSync(
      script,
      read("deploy/setup/setup.sh")
        .replaceAll("/app/node_modules/.bin/convex", join(bin, "convex"))
        .replace(/^answers\(\) \{.*\}$/m, "answers() { true; }")
        .replace(/^cd \/app$/m, `cd ${dir}`),
    );
    const env = {
      PATH: `${bin}:${process.env.PATH}`,
      CONVEX_SELF_HOSTED_ADMIN_KEY: "takewon|key",
      SITE_URL: "https://app.example.com/",
      MASTRA_JWT_SECRET: "jwt",
    };
    const run = (extra = {}) =>
      execFileSync("sh", [script], {
        env: { ...env, ...extra },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    const values = () =>
      Object.fromEntries(
        readFileSync(settings, "utf8")
          .trim()
          .split("\n")
          .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
      );
    return { run, values, log: () => readFileSync(join(dir, "log"), "utf8") };
  }

  test("gives Convex its settings and pushes the backend", () => {
    const setup = setUp();
    const said = setup.run({ AGENT_URL: "https://agent.example.com" });
    const values = setup.values();
    assert.equal(values.SITE_URL, "https://app.example.com");
    assert.equal(values.AGENT_URL, "https://agent.example.com");
    assert.equal(values.MASTRA_JWT_SECRET, "jwt");
    assert.equal(values.SIGN_UPS, "invite-only");
    assert.ok(values.BETTER_AUTH_SECRET.length >= 40);
    assert.ok(values.CONNECTIONS_SECRET.length >= 40);
    assert.notEqual(values.BETTER_AUTH_SECRET, values.CONNECTIONS_SECRET);
    assert.match(setup.log(), /^deploy -y --typecheck disable$/m);
    assert.match(said, /Made CONNECTIONS_SECRET/);
  });

  test("run again after an update, keeps every secret and the sign-up choice", () => {
    const setup = setUp();
    setup.run();
    const first = setup.values();
    const said = setup.run({ SITE_URL: "https://new.example.com", SIGN_UPS: "open" });
    const again = setup.values();
    assert.equal(again.CONNECTIONS_SECRET, first.CONNECTIONS_SECRET);
    assert.equal(again.BETTER_AUTH_SECRET, first.BETTER_AUTH_SECRET);
    assert.equal(again.SIGN_UPS, "invite-only");
    assert.equal(again.SITE_URL, "https://new.example.com");
    assert.match(said, /Kept the CONNECTIONS_SECRET/);
  });

  test("stops with a plain message when a setting is missing", () => {
    const setup = setUp();
    assert.throws(() => setup.run({ CONVEX_SELF_HOSTED_ADMIN_KEY: "" }), /generate_admin_key/);
    assert.throws(() => setup.run({ SITE_URL: "app.example.com" }), /full address/);
    assert.throws(() => setup.log(), /ENOENT/);
  });
});
