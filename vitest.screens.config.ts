import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests for the screens, rendered in jsdom with the Convex hooks replaced by stand-ins
// (see src/test/convex.ts). `pnpm test` runs these after the package and Convex tests.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@convex": fileURLToPath(new URL("./convex", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    restoreMocks: true,
  },
});
