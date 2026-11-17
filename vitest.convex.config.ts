import { defineConfig } from "vitest/config";

// Tests for the Convex functions, run in memory by convex-test. The packages have
// their own tests; `pnpm test` runs both.
export default defineConfig({
  test: {
    include: ["convex/**/*.test.ts"],
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
  },
});
