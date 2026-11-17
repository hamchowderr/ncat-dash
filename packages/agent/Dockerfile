# The agent server, built from the repository root:
#   docker build -f packages/agent/Dockerfile -t ncat-dash-agent .
# It listens on 4111 and keeps its memory in /data, so mount a volume there.
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/agent/package.json packages/agent/
RUN pnpm install --frozen-lockfile --filter @ncat-dash/agent
COPY packages/agent packages/agent
RUN pnpm --filter @ncat-dash/agent build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/packages/agent/.mastra/output ./
ENV NODE_ENV=production \
    PORT=4111 \
    TURSO_DATABASE_URL=file:/data/mastra.db \
    WORKSPACE_ROOT=/data/workspace \
    WORKSPACE_BROWSER=false
VOLUME /data
EXPOSE 4111
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s CMD curl -fsS http://127.0.0.1:4111/health || exit 1
CMD ["node", "index.mjs"]
