import { defineConfig } from "vitest/config";

// Browser tests of the built app. One app at a time, since tauri-driver drives one window.
export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60000,
  },
});
