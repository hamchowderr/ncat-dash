import { defineConfig } from "vitest/config";

// The app's own pages (the Connect screen). Tauri loads them from dist/ in a build and
// from this dev server while developing.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true, target: "es2021" },
  test: { environment: "jsdom", include: ["src/**/*.test.ts", "test/**/*.test.ts"] },
});
