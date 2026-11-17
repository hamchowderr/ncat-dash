#!/usr/bin/env node
// Connects the dashboard and the agent server in one go, so nobody makes or copies a
// secret by hand:
//
//   pnpm setup:agent                                   # agent server on this computer
//   pnpm setup:agent --agent-url https://agent.example.com
//
// It makes MASTRA_JWT_SECRET (once; an existing one is kept) and APP_SECRET for the agent,
// then puts each value where it is read:
//   .env.local             MASTRA_SERVER_URL, MASTRA_JWT_SECRET   (the web app's chat)
//   packages/agent/.env    MASTRA_JWT_SECRET, APP_SECRET, CONVEX_URL   (the agent server)
//   Convex                 AGENT_URL, MASTRA_JWT_SECRET   (@Agent in review rooms)
// Secrets are never printed.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_ENV = join(root, ".env.local");
const AGENT_ENV = join(root, "packages/agent/.env");
const AGENT_EXAMPLE = join(root, "packages/agent/.env.example");

/** Reads KEY=value lines; the last one wins, as dotenv does. */
export function readEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2").trim();
  }
  return values;
}

/** Sets KEY=value in place (the first line for it, even a blank one), or adds it at the end. */
export function setEnv(text, key, value) {
  const pattern = new RegExp(`^\\s*#?\\s*${key}\\s*=.*$`, "m");
  const active = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
  const line = `${key}=${value}`;
  if (active.test(text)) return text.replace(active, () => line);
  if (pattern.test(text)) return text.replace(pattern, () => line);
  return `${text.replace(/\n*$/, "")}${text ? "\n" : ""}${line}\n`;
}

const secret = () => randomBytes(32).toString("base64");

function agentUrlFromArgs(argv) {
  const index = argv.indexOf("--agent-url");
  if (index === -1) return null;
  const url = argv[index + 1];
  if (!url || !/^https?:\/\//.test(url)) {
    throw new Error(
      "--agent-url takes the agent server's address, such as https://agent.example.com",
    );
  }
  return url.replace(/\/+$/, "");
}

function main() {
  const webText = existsSync(WEB_ENV) ? readFileSync(WEB_ENV, "utf8") : "";
  const web = readEnv(webText);
  const convexUrl = web.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error(
      "Start Convex first (npx convex dev), so .env.local has NEXT_PUBLIC_CONVEX_URL.",
    );
  }
  if (!existsSync(AGENT_ENV)) copyFileSync(AGENT_EXAMPLE, AGENT_ENV);
  const agentText = readFileSync(AGENT_ENV, "utf8");
  const agent = readEnv(agentText);

  const agentUrl =
    agentUrlFromArgs(process.argv.slice(2)) ?? web.MASTRA_SERVER_URL ?? "http://127.0.0.1:4111";
  const jwt = web.MASTRA_JWT_SECRET || agent.MASTRA_JWT_SECRET || secret();
  const appSecret = agent.APP_SECRET || secret();

  let nextWeb = setEnv(webText, "MASTRA_SERVER_URL", agentUrl);
  nextWeb = setEnv(nextWeb, "MASTRA_JWT_SECRET", jwt);
  writeFileSync(WEB_ENV, nextWeb);

  let nextAgent = setEnv(agentText, "MASTRA_JWT_SECRET", jwt);
  nextAgent = setEnv(nextAgent, "APP_SECRET", appSecret);
  nextAgent = setEnv(nextAgent, "CONVEX_URL", convexUrl);
  writeFileSync(AGENT_ENV, nextAgent);

  for (const [key, value] of [
    ["AGENT_URL", agentUrl],
    ["MASTRA_JWT_SECRET", jwt],
  ]) {
    execFileSync("npx", ["convex", "env", "set", key, value], { cwd: root, stdio: "ignore" });
  }

  console.log(`The dashboard and the agent server are connected (agent at ${agentUrl}).`);
  console.log(
    "Written: .env.local, packages/agent/.env, and AGENT_URL and MASTRA_JWT_SECRET in Convex.",
  );
  if (
    /^https?:\/\/(127\.0\.0\.1|localhost)/.test(agentUrl) &&
    !/127\.0\.0\.1|localhost/.test(convexUrl)
  ) {
    console.log(
      "Your Convex runs in the cloud and cannot reach an agent on this computer. Once the agent server is online, run this again with --agent-url and its address.",
    );
  }
  if (!agent.ANTHROPIC_API_KEY && !agent.USE_AIMOCK) {
    console.log("Still to do: put the model key in packages/agent/.env (ANTHROPIC_API_KEY).");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
