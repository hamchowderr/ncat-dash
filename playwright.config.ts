import os from "node:os";
import path from "node:path";

import { defineConfig } from "@playwright/test";

// Browser tests: the real screens against a real local Convex backend, with stand-ins
// for the toolkit and its files (e2e/stand-ins.mjs). Run with `pnpm test:e2e`.
// Servers already running on these ports are reused, so it also works beside `pnpm dev`.
const CONVEX = "http://127.0.0.1:3210";
const CONVEX_SITE = "http://127.0.0.1:3211";
const APP = "http://localhost:3000";
const AGENT = "http://127.0.0.1:4111";
const AIMOCK = "http://127.0.0.1:4010";
const RECORD = process.env.RECORD_AGENT === "1";
/** Shared by the agent server and Convex, which signs its questions to the agent with it. */
export const AGENT_SECRET = "browser-tests-agent-secret-at-least-32-characters";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: APP,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM }
      : {},
  },
  webServer: [
    {
      command: "node e2e/stand-ins.mjs",
      url: "http://127.0.0.1:8767/v1/toolkit/authenticate",
      reuseExistingServer: true,
    },
    {
      command: "node e2e/zoom-stand-in.mjs",
      url: "http://127.0.0.1:8770/health",
      reuseExistingServer: true,
    },
    {
      command: "node e2e/google-meet-stand-in.mjs",
      url: "http://127.0.0.1:8771/health",
      reuseExistingServer: true,
    },
    {
      command: "node e2e/slack-stand-in.mjs",
      url: "http://127.0.0.1:8768/stand-in/posted",
      reuseExistingServer: true,
    },
    {
      // Starts a local backend, pushes the functions to it, and keeps it running.
      command: "npx convex dev",
      env: { CONVEX_AGENT_MODE: "anonymous" },
      url: `${CONVEX}/version`,
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      // The agent's model, played back from answers Sonnet 5.5 really gave
      // (packages/agent/fixtures/recorded), so the run is free and needs no key. With
      // RECORD_AGENT=1 and ANTHROPIC_API_KEY set, a question not recorded yet goes to the
      // real model and its answer is saved there.
      command: `pnpm --filter @ncat-dash/agent ${RECORD ? "dev:record" : "dev:replay"}`,
      url: `${AIMOCK}/health`,
      reuseExistingServer: true,
    },
    {
      // The real agent server, answering "@Agent" through the model above.
      command: "pnpm --filter @ncat-dash/agent dev",
      env: {
        APP_SECRET: "browser-tests-app-secret-at-least-32-characters",
        MASTRA_JWT_SECRET: AGENT_SECRET,
        CONVEX_URL: CONVEX,
        SLACK_API_URL: "http://127.0.0.1:8768/api/",
        USE_AIMOCK: "true",
        AIMOCK_URL: AIMOCK,
        ANTHROPIC_BASE_URL: `${AIMOCK}/v1`,
        OPENAI_BASE_URL: `${AIMOCK}/v1`,
        CHAT_MODEL: "anthropic/claude-sonnet-5-5",
        ANTHROPIC_API_KEY: (RECORD && process.env.ANTHROPIC_API_KEY) || "stand-in",
        OPENAI_API_KEY: "stand-in",
        // test-results/ is emptied by Playwright as it starts, so the database lives elsewhere.
        TURSO_DATABASE_URL: `file:${path.join(os.tmpdir(), "ncat-dash-e2e-agent.db")}`,
      },
      url: `${AGENT}/health`,
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      // On CI the built app is used: pages open at once instead of compiling on first visit.
      command: process.env.CI ? "pnpm build && pnpm start" : "pnpm dev",
      env: {
        NEXT_PUBLIC_CONVEX_URL: CONVEX,
        NEXT_PUBLIC_CONVEX_SITE_URL: CONVEX_SITE,
        NEXT_PUBLIC_SITE_URL: APP,
      },
      url: `${APP}/sign-in`,
      reuseExistingServer: true,
      timeout: 300_000,
    },
  ],
});
