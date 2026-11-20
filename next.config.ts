import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Docker image (Dockerfile) builds a self-contained server that needs no pnpm
  // install where it runs. Vercel and `pnpm start` keep the usual output.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  cacheComponents: true,
  transpilePackages: [
    "@ncat-dash/step-catalog",
    "@ncat-dash/automation-core",
    "@ncat-dash/timeline-export",
    "@ncat-dash/review-core",
  ],
  partialPrefetching: true,
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
