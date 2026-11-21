import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { AGENT_SECRET } from "../playwright.config";
import { DROPBOX, DROPBOX_SECRET } from "./dropbox-data.mjs";
import { SLACK_API } from "./slack-shared";
import { ZOOM_ACCOUNT_WEBHOOK_SECRET, ZOOM_WEBHOOK_SECRET } from "./zoom-shared";

const HOOK = "http://127.0.0.1:3211/automations/hook";

/**
 * Waits until the functions are on the local backend, then gives it the secrets the app
 * needs, unless it already has them.
 */
export default async function globalSetup() {
  const deadline = Date.now() + 180_000;
  for (;;) {
    // The route answers 400 for a call with no id once the functions are in place.
    const status = await fetch(HOOK, { method: "POST" }).then(
      (response) => response.status,
      () => 0,
    );
    if (status === 400) break;
    if (Date.now() > deadline) throw new Error("The Convex functions never became ready.");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const have = execSync("npx convex env list", { encoding: "utf8" });
  const set = (name: string, value: string) => {
    if (!new RegExp(`^${name}(=|$)`, "m").test(have)) {
      execSync(`npx convex env set ${name} ${value}`, { stdio: "ignore" });
    }
  };
  set("SITE_URL", "http://localhost:3000");
  set("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
  set("CONNECTIONS_SECRET", randomBytes(32).toString("hex"));
  // Where Convex asks the agent when someone tags @Agent in a review. Always the test
  // agent server's, even when `pnpm setup:agent` gave this backend other values.
  execSync("npx convex env set AGENT_URL http://127.0.0.1:4111", { stdio: "ignore" });
  execSync(`npx convex env set MASTRA_JWT_SECRET ${AGENT_SECRET}`, { stdio: "ignore" });
  // Slack's Web API, as the Slack stand-in (e2e/slack-stand-in.mjs) plays it.
  execSync(`npx convex env set SLACK_API_URL ${SLACK_API}`, { stdio: "ignore" });
  // Zoom, as the Zoom stand-in (e2e/zoom-stand-in.mjs) plays it.
  for (const [name, value] of [
    ["ZOOM_CLIENT_ID", "stand-in-zoom-client"],
    ["ZOOM_CLIENT_SECRET", "stand-in-zoom-secret"],
    ["ZOOM_WEBHOOK_SECRET", ZOOM_WEBHOOK_SECRET],
    ["ZOOM_ACCOUNT_CLIENT_ID", "stand-in-zoom-account-client"],
    ["ZOOM_ACCOUNT_CLIENT_SECRET", "stand-in-zoom-account-secret"],
    ["ZOOM_ACCOUNT_WEBHOOK_SECRET", ZOOM_ACCOUNT_WEBHOOK_SECRET],
    ["ZOOM_OAUTH_URL", "http://127.0.0.1:8770"],
    ["ZOOM_API_URL", "http://127.0.0.1:8770/v2"],
    // Microsoft, as the Microsoft stand-in (e2e/microsoft-stand-in.mjs) plays it.
    ["MICROSOFT_CLIENT_ID", "stand-in-microsoft-client"],
    ["MICROSOFT_CLIENT_SECRET", "stand-in-microsoft-secret"],
    ["MICROSOFT_LOGIN_URL", "http://127.0.0.1:8772/common"],
    ["MICROSOFT_GRAPH_URL", "http://127.0.0.1:8772/v1.0"],
    // The Teams bot, with its token from the same stand-in.
    ["TEAMS_APP_ID", "stand-in-teams-bot"],
    ["TEAMS_APP_PASSWORD", "stand-in-teams-password"],
    ["TEAMS_LOGIN_URL", "http://127.0.0.1:8772"],
    // The dashboard's Telegram bot, as the Telegram stand-in (e2e/telegram-stand-in.mjs)
    // plays it. The agent server in these tests has no Telegram, so nothing polls it.
    ["TELEGRAM_BOT_TOKEN", "123456:stand-in-telegram"],
    ["TELEGRAM_BOT_USERNAME", "KontentifiStandInBot"],
    ["TELEGRAM_API_URL", "http://127.0.0.1:8774"],
    // Dropbox, as the Dropbox stand-in (e2e/dropbox-stand-in.mjs) plays it.
    ["DROPBOX_APP_KEY", "stand-in-dropbox-key"],
    ["DROPBOX_APP_SECRET", DROPBOX_SECRET],
    ["DROPBOX_AUTH_URL", DROPBOX],
    ["DROPBOX_API_URL", DROPBOX],
    ["DROPBOX_CONTENT_URL", DROPBOX],
  ]) {
    execSync(`npx convex env set ${name} ${value}`, { stdio: "ignore" });
  }
  // Google, as the Google stand-in (e2e/google-meet-stand-in.mjs) plays it.
  for (const [name, value] of [
    ["GOOGLE_MEET_CLIENT_ID", "stand-in-google-client"],
    ["GOOGLE_MEET_CLIENT_SECRET", "stand-in-google-secret"],
    ["GOOGLE_MEET_STAND_IN_URL", "http://127.0.0.1:8771"],
  ]) {
    execSync(`npx convex env set ${name} ${value}`, { stdio: "ignore" });
  }
}
