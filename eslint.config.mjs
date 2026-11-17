import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated code and installed agent skills.
    "convex/_generated/**",
    "convex/betterAuth/_generated/**",
    ".agents/**",
    ".claude/**",
    // The agent server follows the chat kit's own conventions and has its own typecheck.
    "packages/agent/**",
    // The chat panel, installed as it ships from the mastra-chat-kit registry.
    "src/components/ai-elements/**",
    "src/components/chat/**",
    "src/components/chat-panel/**",
    "src/components/ui/carousel.tsx",
    "src/lib/agent-controller/**",
    "src/lib/mastra-proxy.ts",
    "src/app/api/agent-controller/**",
    "src/app/api/browser/**",
    "src/app/api/images/**",
    "src/app/api/workspace/**",
  ]),
]);

export default eslintConfig;
