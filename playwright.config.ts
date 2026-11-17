import { defineConfig } from "@playwright/test";

// Browser tests: the real screens against a real local Convex backend, with stand-ins
// for the toolkit and its files (e2e/stand-ins.mjs). Run with `pnpm test:e2e`.
// Servers already running on these ports are reused, so it also works beside `pnpm dev`.
const CONVEX = "http://127.0.0.1:3210";
const CONVEX_SITE = "http://127.0.0.1:3211";
const APP = "http://localhost:3000";

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
      // Starts a local backend, pushes the functions to it, and keeps it running.
      command: "npx convex dev",
      env: { CONVEX_AGENT_MODE: "anonymous" },
      url: `${CONVEX}/version`,
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: "pnpm dev",
      env: {
        NEXT_PUBLIC_CONVEX_URL: CONVEX,
        NEXT_PUBLIC_CONVEX_SITE_URL: CONVEX_SITE,
        NEXT_PUBLIC_SITE_URL: APP,
      },
      url: `${APP}/sign-in`,
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
