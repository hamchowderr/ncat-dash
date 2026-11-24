import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // The Docker image (Dockerfile) builds a self-contained server that needs no pnpm
  // install where it runs. Vercel and `pnpm start` keep the usual output.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  cacheComponents: true,
  transpilePackages: [
    "@takewon/step-catalog",
    "@takewon/automation-core",
    "@takewon/timeline-export",
    "@takewon/review-core",
  ],
  partialPrefetching: true,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
