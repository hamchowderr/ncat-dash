# syntax=docker/dockerfile:1.7
# The agent server, built from the repository root:
#   docker build -f packages/agent/Dockerfile -t ncat-dash-agent .
# It listens on 4111 and keeps its memory in /data, so mount a volume there.
#
# GitHub Actions builds this on every push to main and publishes it to GHCR
# (.github/workflows/agent-image.yml), so a server only pulls the finished image.
FROM node:22-bookworm-slim AS build
RUN corepack enable
# One pnpm store for both installs: ours, and the one `mastra build` runs inside its
# output folder. The cache mount keeps it between builds.
ENV npm_config_store_dir=/pnpm/store \
    CI=true
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# The image only ever runs on Linux with glibc, so skip the native binaries for
# macOS, Windows and musl. `mastra build` copies this setting into its own install.
RUN printf '\nsupportedArchitectures:\n  os: [current]\n  cpu: [current]\n  libc: [glibc]\n' >> pnpm-workspace.yaml
COPY packages/agent/package.json packages/agent/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @ncat-dash/agent
COPY packages/agent packages/agent
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @ncat-dash/agent build \
 && node packages/agent/scripts/slim-output.mjs packages/agent/.mastra/output

FROM node:22-bookworm-slim
# curl for the image's own health check, wget for Coolify's.
RUN apt-get update && apt-get install -y --no-install-recommends curl wget ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/packages/agent/.mastra/output ./
# The Takewon guide, synced into Knowledge (docs:takewon) at boot. KNOWLEDGE_DIR defaults
# to ./knowledge, which resolves against this WORKDIR (/app).
COPY --from=build /app/packages/agent/knowledge ./knowledge
# The agent's FFmpeg skills (lib/agent-skills.ts), found at ./skills against /app.
COPY --from=build /app/packages/agent/skills ./skills
ENV NODE_ENV=production \
    PORT=4111 \
    TURSO_DATABASE_URL=file:/data/mastra.db \
    WORKSPACE_ROOT=/data/workspace \
    WORKSPACE_BROWSER=false
VOLUME /data
EXPOSE 4111
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s CMD curl -fsS http://127.0.0.1:4111/health || exit 1
CMD ["node", "index.mjs"]
