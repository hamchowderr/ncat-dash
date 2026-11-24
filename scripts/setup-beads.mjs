#!/usr/bin/env node
// Gets this clone's Beads issues from DoltHub (chowderr/takewon).
//
// Dolt does not read a DoltHub API token. It signs in with a credential key
// (a JWK file in ~/.dolt/creds). In a cloud session the key comes in as two
// environment variables, DOLT_CREDS_KEY_ID and DOLT_CREDS_JWK. This script
// writes that file, tells Dolt to use it, then clones or pulls the issues.
//
//   pnpm setup:beads
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Where Dolt looks for a key, or an error message if the key id is unusable. */
export function credsFile(home, keyId) {
  if (!keyId || !/^[a-z0-9]+$/.test(keyId)) {
    throw new Error(
      "DOLT_CREDS_KEY_ID should be the key id Dolt printed (lowercase letters and digits).",
    );
  }
  return join(home, ".dolt", "creds", `${keyId}.jwk`);
}

/** True when the JWK text looks like a Dolt key and not, say, an API token. */
export function looksLikeJwk(text) {
  try {
    const key = JSON.parse(text);
    return typeof key === "object" && key !== null && typeof key.d === "string";
  } catch {
    return false;
  }
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", ...opts });
}

function main() {
  const { DOLT_CREDS_KEY_ID: keyId, DOLT_CREDS_JWK: jwk } = process.env;
  if (keyId || jwk) {
    if (!jwk || !looksLikeJwk(jwk)) {
      throw new Error(
        "DOLT_CREDS_JWK should hold the whole JWK file from `dolt creds new` or `dolt login`.",
      );
    }
    const file = credsFile(homedir(), keyId);
    mkdirSync(join(homedir(), ".dolt", "creds"), { recursive: true, mode: 0o700 });
    if (!existsSync(file) || readFileSync(file, "utf8") !== jwk)
      writeFileSync(file, jwk, { mode: 0o600 });
    chmodSync(file, 0o600);
    run("dolt", ["creds", "use", keyId]);
    console.log(
      "Dolt signs in to DoltHub as: " + run("dolt", ["creds", "check"]).match(/User:\s*(\S+)/)?.[1],
    );
  } else {
    console.log("No DOLT_CREDS_KEY_ID / DOLT_CREDS_JWK set; using whatever key Dolt already has.");
  }

  const root = fileURLToPath(new URL("..", import.meta.url));
  const env = { ...process.env, BD_NON_INTERACTIVE: "1" };
  if (existsSync(join(root, ".beads", "embeddeddolt"))) {
    run("bd", ["dolt", "pull"], { cwd: root, env });
  } else {
    // Clones from sync.remote in .beads/config.yaml. --skip-agents keeps AGENTS.md and CLAUDE.md as committed.
    run("bd", ["init", "--non-interactive", "--skip-agents", "--skip-hooks"], { cwd: root, env });
  }
  const issues = JSON.parse(run("bd", ["list", "--all", "--json"], { cwd: root, env }));
  console.log(`Beads ready: ${issues.length} issues. Try \`bd ready\`.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (err) {
    console.error(err.stderr?.toString().trim() || err.message);
    process.exit(1);
  }
}
