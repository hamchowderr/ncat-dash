# syntax=docker/dockerfile:1.7
# The web app (the dashboard people sign in to), built from the repository root:
#   docker build -t takewon-web .
# GitHub Actions builds it for Intel/AMD and ARM and publishes it to GHCR
# (.github/workflows/web-image.yml), so a machine only pulls the finished image.
#
# One image works for every copy. The Convex addresses are normally built into the
# pages, so the build uses stand-in addresses and deploy/web/start.sh writes the real
# ones in when the container starts, from:
#   NEXT_PUBLIC_CONVEX_URL, NEXT_PUBLIC_CONVEX_SITE_URL   (required)
#   MASTRA_SERVER_URL, MASTRA_JWT_SECRET                  (for the agent)
#
# The `setup` stage is a second image, ghcr.io/hamchowderr/takewon-setup: it pushes the
# backend (convex/) to a copy's Convex, so the machine needs no Node or clone of its own
# (deploy/setup/setup.sh). Build it with --target setup.
FROM node:22-bookworm-slim AS source
RUN corepack enable
ENV npm_config_store_dir=/pnpm/store \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN printf '\nsupportedArchitectures:\n  os: [current]\n  cpu: [current]\n  libc: [glibc]\n' >> pnpm-workspace.yaml
COPY packages/automation-core/package.json packages/automation-core/
COPY packages/email/package.json packages/email/
COPY packages/review-core/package.json packages/review-core/
COPY packages/step-catalog/package.json packages/step-catalog/
COPY packages/timeline-export/package.json packages/timeline-export/
COPY packages/agent/package.json packages/agent/
# Only the web app and the packages it uses; the agent server has its own image.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "takewon..."
COPY . .

FROM source AS build
ENV NEXT_OUTPUT=standalone \
    NEXT_PUBLIC_CONVEX_URL=https://convex-url.takewon.invalid \
    NEXT_PUBLIC_CONVEX_SITE_URL=https://convex-site-url.takewon.invalid
RUN pnpm build

FROM source AS setup
COPY deploy/setup/setup.sh /usr/local/bin/takewon-setup
RUN chmod +x /usr/local/bin/takewon-setup
ENV CONVEX_SELF_HOSTED_URL=http://convex:3210
CMD ["takewon-setup"]

FROM node:22-bookworm-slim AS web
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node deploy/web/start.sh /usr/local/bin/takewon-web
# Keep an untouched copy of every file that holds a stand-in address, so each start
# writes the addresses into a clean copy (and changing them only needs a restart).
RUN chmod +x /usr/local/bin/takewon-web \
 && grep -rlE 'convex(-site)?-url\.takewon\.invalid' /app --include='*' > /app/.stand-ins \
 && mkdir -p /app/.pristine \
 && while read -r f; do mkdir -p "/app/.pristine$(dirname "$f")"; cp -p "$f" "/app/.pristine$f"; done < /app/.stand-ins \
 && chown -R node:node /app/.pristine /app/.stand-ins
USER node
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s CMD curl -fsS -o /dev/null http://127.0.0.1:3000/ || exit 1
CMD ["takewon-web"]
