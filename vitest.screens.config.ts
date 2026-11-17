import path from "node:path";

import { defineConfig } from "vitest/config";

// Tests for the screens and the web app's own code, run in a pretend browser (jsdom).
// The Convex functions and the packages have their own tests; `pnpm test` runs them all.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@convex": path.resolve(__dirname, "convex"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    // Stand-ins for the Convex hooks, the router and toasts (src/test/convex.ts).
    setupFiles: ["src/test/setup.ts"],
    restoreMocks: true,
  },
});
