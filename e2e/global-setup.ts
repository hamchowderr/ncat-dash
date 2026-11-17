import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { AGENT_SECRET } from "../playwright.config";

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
}
