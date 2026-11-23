/**
 * What a team pastes into any AI agent (Claude Code, Codex, Cursor and the like) so it
 * installs the toolkit, updates the one they run, or replaces one that is not the fork. It
 * carries this dashboard's address, which the bucket must allow uploads from.
 */
export const FORK_REPO = "https://github.com/hamchowderr/no-code-architects-toolkit";
export const TOOLKIT_IMAGE = "ghcr.io/hamchowderr/no-code-architects-toolkit:latest";

/** What our own toolkit runs on, shown on the page and handed to the agent. */
export const RECOMMENDED_SETUP: { label: string; detail: string }[] = [
  {
    label: "A Linux server or an always-on computer",
    detail:
      "With Docker, at least 4 CPU cores, 8 GB of memory and 60 GB of disk. Intel, AMD and Apple-chip machines all work.",
  },
  {
    label: "The ready-built image and Redis",
    detail: `${TOOLKIT_IMAGE}, never built on the server, with Redis 7 for the job queue.`,
  },
  {
    label: "Coolify or Docker Compose, with HTTPS",
    detail: "The Docker guide's compose file starts the toolkit, Redis and a certificate together.",
  },
  {
    label: "Cloudflare R2 for files",
    detail:
      "One bucket and an R2 API token with Object Read & Write on it. The bucket must allow uploads from this dashboard.",
  },
  {
    label: "Your own address through Cloudflare",
    detail:
      "An A record pointing a subdomain at the server. A computer at home or in an office uses a Cloudflare Tunnel instead of opening ports.",
  },
];

export function toolkitAgentPrompt(dashboard: string): string {
  const origin = dashboard || "this Takewon dashboard's address";
  return `Set up the NCA Toolkit (the Otaku Solutions fork) for my Takewon dashboard at ${origin}.

First find out what I have, tell me, then do the one that fits:
- No toolkit yet: install one.
- A toolkit already running from ${TOOLKIT_IMAGE.replace(":latest", "")}: update it to the latest image and keep its settings.
- Any other toolkit, such as Stephen Pope's original: replace it with this fork, because Takewon only works with the fork. Reuse its bucket and settings where they fit.
Ask me before you delete or stop anything.

Read these before you start:
- ${FORK_REPO}/blob/main/AGENTS.md
- ${FORK_REPO}/blob/main/docker-compose.md
- ${FORK_REPO}/blob/main/docs/storage/storage.md

Use the recommended setup, which is what Takewon's own toolkit runs on:
- A Linux server or an always-on computer with Docker: at least 4 CPU cores, 8 GB of memory and 60 GB of disk.
- The image ${TOOLKIT_IMAGE}. Never build the image on the server; it compiles FFmpeg for a long time.
- Redis 7 beside it, with REDIS_URL set on the toolkit, for the job queue.
- Coolify, or Docker Compose with the compose file from docker-compose.md, so the toolkit answers on HTTPS.
- A Cloudflare R2 bucket for files, with an R2 API token that has Object Read & Write on that bucket. Set S3_ENDPOINT_URL=https://<account id>.r2.cloudflarestorage.com, S3_REGION=auto, S3_BUCKET_NAME, S3_ACCESS_KEY and S3_SECRET_KEY on the toolkit.
- CORS on that bucket for ${origin}: allow the methods PUT, GET and HEAD and the header Content-Type, and expose the ETag header. Without it, uploads from Takewon fail.
- An HTTPS address on my own domain through Cloudflare: an A record pointing a subdomain at the server. On a computer at home or in an office, use a Cloudflare Tunnel instead of opening ports.
- API_KEY set to a long random value, for example from: openssl rand -hex 32

When it is running, check it:
- curl -H "x-api-key: $API_KEY" https://<toolkit address>/v1/toolkit/test answers "message":"success" and success.txt appears in the bucket.
- curl -X POST -H "x-api-key: $API_KEY" https://<toolkit address>/v1/storage/info answers with the bucket.

Finish by giving me the toolkit's HTTPS address and its API key, so I can put them in Takewon under Settings, Toolkit.`;
}
