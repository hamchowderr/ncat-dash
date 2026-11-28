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
    "packages/support-tickets/src/component/_generated/**",
    ".agents/**",
    ".claude/**",
    // The desktop app's build output (Rust and the Connect screen's bundle).
    "apps/desktop/src-tauri/target/**",
    "apps/desktop/src-tauri/gen/**",
    "apps/desktop/dist/**",
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
    // The sign-in screens and account cards, installed as they ship from the Better Auth
    // UI registry (better-auth-ui.com). The dashboard's own files beside them are linted.
    "src/components/auth/**",
    "!src/components/auth/accept-invitation.tsx",
    "!src/components/auth/auth-card.tsx",
    "!src/components/auth/auth-view.tsx",
    "!src/components/auth/connect-agent.tsx",
    "!src/components/auth/connect-agent.test.tsx",
    "!src/components/auth/sign-up-note.tsx",
    "!src/components/auth/*.test.tsx",
    "src/lib/auth/**",
  ]),
]);

export default eslintConfig;
