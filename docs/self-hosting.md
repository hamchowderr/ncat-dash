# Self-Hosting Takewon

Takewon is a finished shell around the NCA Toolkit, the free and open-source media engine. The toolkit does the work (FFmpeg, transcription, captions, clips); Takewon is where a team builds, runs and reviews the automations that drive it, with an agent that sets them up. n8n is not needed: automations run inside Takewon. The toolkit can still be used from n8n or any HTTP client next to it.

This guide is for whoever runs a copy. It covers what to run, what machine to run it on, every setting, and how to update it. AI agents doing the same job should read the checklist in [AGENTS.md](../AGENTS.md) as well.

## What You Run

| Piece        | What it is                                                                                                                                                                                                                 | How it ships                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Toolkit      | [The NCA Toolkit fork](https://github.com/hamchowderr/no-code-architects-toolkit), with Redis for its job queue. Takewon needs this fork; the original toolkit lacks the storage, health and look endpoints Takewon calls. | `ghcr.io/hamchowderr/no-code-architects-toolkit` |
| Bucket       | Where every file lives: Cloudflare R2, AWS S3, DigitalOcean Spaces, Backblaze B2 or MinIO. Only the toolkit holds its keys.                                                                                                | Your storage account                             |
| Convex       | The backend: database, sign-in, the automation runner, webhooks, the MCP server. Self-host it, or use a Convex Cloud project.                                                                                              | `ghcr.io/convex/convex-backend`                  |
| Agent server | The Mastra server behind the agent, in the dashboard and in Slack, Discord, Telegram and Microsoft Teams.                                                                                                                  | `ghcr.io/hamchowderr/ncat-dash-agent`            |
| Web app      | The Next.js dashboard people sign in to.                                                                                                                                                                                   | `ghcr.io/hamchowderr/ncat-dash-web`, or Vercel   |

Every image is built by GitHub Actions and pulled ready-made, for both kinds of processor (see The Machine). Nothing is compiled on the machine that runs it, which matters: the toolkit's image compiles FFmpeg from source and takes 20 to 40 minutes to build.

## The Machine

Takewon runs on a rented server, or on a machine of your own that stays on around the clock, such as a Mac Mini. Automations run while nobody is signed in, so a laptop that is closed at night is not a good home for it. A server is required either way: something has to be on for the automations to run.

What the pieces use, measured on the published images:

|                              | Idle                               | Busy                                                                                                               |
| ---------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Toolkit                      | about 450 MB of memory             | about 0.5 GB per transcription at once with the default model, and every CPU core it is given while FFmpeg encodes |
| Convex                       | about 500 MB                       | grows with the data                                                                                                |
| Agent server                 | about 270 MB                       | more while it chats                                                                                                |
| Web app (when not on Vercel) | about 150 MB                       |                                                                                                                    |
| Images on disk               | about 9 GB (the toolkit's is 6 GB) |                                                                                                                    |

What to start with:

|        | Smallest                                          | Comfortable for a team |
| ------ | ------------------------------------------------- | ---------------------- |
| CPU    | 4 cores                                           | 8 cores                |
| Memory | 8 GB                                              | 16 GB or more          |
| Disk   | 60 GB SSD free (images, work files, the database) | 100 GB SSD or more     |

Video work is limited by CPU. More cores mean more jobs at once and faster encodes. Finished files go to the bucket, so the disk only holds work in progress.

**Any machine that runs Docker.** Every image is published for both kinds of processor, and Docker picks the right one by itself:

- Intel and AMD: most rented servers, Windows PCs, Intel Macs and Linux boxes.
- ARM: Apple-chip Macs (a Mac Mini with M1 or later), Ampere and AWS Graviton servers.

Each kind is built and tested on its own kind of machine, so nothing runs through slow emulation. On every change, GitHub Actions starts the images on both and signs up through the dashboard.

| Machine                   | What to install                         | Keep in mind                                                                                                                                                                                                            |
| ------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux server or PC        | Docker Engine with the Compose plugin   | Nothing else.                                                                                                                                                                                                           |
| Mac (Apple chip or Intel) | Docker Desktop                          | Give Docker enough memory in Docker Desktop, Settings, Resources (8 GB or more). Turn on "Start Docker Desktop when you sign in", and stop the Mac from sleeping (System Settings, Energy, Prevent automatic sleeping). |
| Windows 10 or 11          | Docker Desktop with WSL 2 (its default) | Run the commands in this guide in a WSL terminal (Ubuntu), which has `openssl` and `curl`. Docker's memory comes from WSL's limit, set in `.wslconfig` in your user folder. Set the PC never to sleep.                  |

The minimums above apply to each. A Windows PC or Mac also needs the memory for whatever else it runs.

## Before You Start

- A domain where you can add DNS records. Each public piece gets its own address, for example `toolkit.example.com`, `api.example.com`, `site.example.com`, `agent.example.com` and `app.example.com`.
- A bucket and an access key for it. For R2: create the bucket, then an R2 API token with Object Read & Write on it. If the token has an IP filter, it must allow the toolkit's machine.
- A key for the agent's model. The agent uses Anthropic (Claude Sonnet 5.5) out of the box; any provider Mastra supports works by changing `CHAT_MODEL`.
- Docker with Compose, and HTTPS in front of it: Coolify, Caddy, Traefik or nginx.
- This repository's `deploy/` folder at the version you are running (a clone, or the files downloaded). Node is only needed to push the backend from a clone instead of the setup image (step 3).

## Step By Step

### 1. Start the services

[`deploy/compose.yml`](../deploy/compose.yml) runs the toolkit with Redis, the Convex backend with its admin page, the agent server and the web app.

```bash
cp deploy/.env.example deploy/.env      # fill it in; make each secret with: openssl rand -hex 32
docker compose -f deploy/compose.yml --env-file deploy/.env up -d
```

Every service listens on `127.0.0.1` only. Point your reverse proxy at them:

| Address                                        | Port |
| ---------------------------------------------- | ---- |
| Dashboard, e.g. `https://app.example.com`      | 3000 |
| Toolkit, e.g. `https://toolkit.example.com`    | 8080 |
| Convex API, `CONVEX_URL`                       | 3210 |
| Convex HTTP actions, `CONVEX_SITE_URL`         | 3211 |
| Agent server, e.g. `https://agent.example.com` | 4111 |
| Convex admin page (optional; keep it private)  | 6791 |

Check each one:

```bash
curl https://api.example.com/version                                    # Convex answers with its version
curl https://agent.example.com/health                                   # {"success":true}
curl -H "x-api-key: $TOOLKIT_API_KEY" https://toolkit.example.com/v1/toolkit/test   # "message":"success"
```

The toolkit's test writes `success.txt` to the bucket, so a success there also proves the bucket keys work.

No reverse proxy? A [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/) works instead, with no ports opened on the router; it is what the [desktop app](desktop-app.md) sets up for a copy on a computer at home. Make a remotely-managed tunnel, give it a route for each address to its piece by name on Docker's network (`http://web:3000`, `http://convex:3210`, `http://convex:3211`, `http://agent:4111`, `http://toolkit:8080`), then set `TUNNEL_TOKEN` to the tunnel's token and `COMPOSE_PROFILES=tunnel` in `deploy/.env` so the `tunnel` service starts with the rest. `TUNNEL_IMAGE` pins its image.

On **Coolify**, make each piece its own resource rather than one big stack, so one can restart without the others: the toolkit as a Docker Compose service (toolkit plus Redis), Convex as a Docker Compose service, and the agent server as an application from this repository using `packages/agent/Dockerfile.release` on the `agent-release` branch (it only pulls the image GitHub Actions already published for that commit). Give each its domain in Coolify. Set Convex's `CONVEX_CLOUD_ORIGIN` and `CONVEX_SITE_ORIGIN` as literal addresses: Coolify's own `SERVICE_URL_*` values can end up pointing both at the same host.

### 2. Make the Convex admin key

```bash
docker compose -f deploy/compose.yml --env-file deploy/.env exec convex ./generate_admin_key.sh
```

Put the key in `CONVEX_ADMIN_KEY` in `deploy/.env`, and keep a copy somewhere safe, such as a secrets manager. It is the key to the whole database. The backend is pushed with it, and the admin page signs in with it.

On Convex Cloud instead, create a project at [convex.dev](https://www.convex.dev), and push from a clone (below) with a deploy key (`CONVEX_DEPLOY_KEY`) in place of the two `CONVEX_SELF_HOSTED_*` values. Its addresses end in `.convex.cloud` and `.convex.site`.

### 3. Push the backend and set its settings

```bash
docker compose -f deploy/compose.yml --env-file deploy/.env run --rm setup
```

The setup image (`ghcr.io/hamchowderr/ncat-dash-setup`) holds this version's backend. It gives Convex `SITE_URL`, `AGENT_URL` and `MASTRA_JWT_SECRET` from `deploy/.env`, makes `BETTER_AUTH_SECRET` and `CONNECTIONS_SECRET`, sets `SIGN_UPS` (`invite-only` unless `deploy/.env` says `open`), and pushes the functions. The machine needs nothing but Docker for it. Run it again after every update; it keeps the secrets and the sign-up choice Convex already has, and only writes the addresses again.

`CONNECTIONS_SECRET` encrypts every saved key (toolkit, Slack, Zoom and so on). The setup never replaces it: if it changed, every team would have to connect everything again.

`SIGN_UPS invite-only` keeps strangers out: the first account made (yours) is allowed, and after that only email addresses invited to a team can sign up. Set `SIGN_UPS=open` in `deploy/.env` before the first setup, or later with `npx convex env set SIGN_UPS open`, to let anyone who reaches the address make an account.

**From a clone instead** (also for Convex Cloud), with Node 22 and pnpm, and no `.env.local` in it (that file points the Convex command at a development deployment):

```bash
pnpm install
export CONVEX_SELF_HOSTED_URL=https://api.example.com
export CONVEX_SELF_HOSTED_ADMIN_KEY='takewon|...'

npx convex env set SITE_URL https://app.example.com
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
npx convex env set CONNECTIONS_SECRET "$(openssl rand -base64 32)"
npx convex env set MASTRA_JWT_SECRET "<the MASTRA_JWT_SECRET from deploy/.env>"
npx convex env set AGENT_URL https://agent.example.com
npx convex env set SIGN_UPS invite-only       # only you, then the people you invite

npx convex deploy -y
```

### 4. The web app

The web app is already running from step 1, on port 3000. It reads `CONVEX_URL`, `CONVEX_SITE_URL` and `MASTRA_JWT_SECRET` from `deploy/.env`, and reaches the agent server inside Docker. Check it: `https://app.example.com/sign-up` loads.

The web app can live elsewhere instead. Either way, set these:

| Variable                      | Value                                                         |
| ----------------------------- | ------------------------------------------------------------- |
| `NEXT_PUBLIC_CONVEX_URL`      | `CONVEX_URL`                                                  |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | `CONVEX_SITE_URL`                                             |
| `NEXT_PUBLIC_SITE_URL`        | the dashboard's own address, the same as `SITE_URL` in Convex |
| `MASTRA_SERVER_URL`           | the agent server's address                                    |
| `MASTRA_JWT_SECRET`           | the same value as everywhere else                             |

- **Vercel**: import this repository, set the variables above and deploy. Build command `pnpm build`. Stop the `web` service in compose (`docker compose ... stop web`) or leave its port unpublished.
- **From the code**: `pnpm install`, `pnpm build` (the `NEXT_PUBLIC_` values are built in, so build again when they change), then `pnpm start` on port 3000 under a process manager such as systemd or pm2.

The image needs no rebuild when an address changes: it writes the addresses in each time it starts, so a restart is enough.

Neither Vercel nor the web image pushes Convex functions. Each time you update, push the functions too (step 3), or the dashboard and backend drift apart and pages fail with "Could not find public function".

### 5. Sign up and connect the toolkit

Open the dashboard, create an account and name your team. When asked "Do you have a toolkit?", choose Yes and enter the toolkit's public address and its `TOOLKIT_API_KEY`. The dashboard tests the key, reads the bucket's details from the toolkit, and stores the key encrypted.

Test it end to end: under Builder, Steps, open Video Thumbnail, give it a link to a short video and press Run step. Jobs shows it Done within seconds once the toolkit has posted the result back to `CONVEX_SITE_URL/toolkit/webhook`. The Toolkit page shows the toolkit's CPU, memory, disk and queue.

With `SIGN_UPS invite-only` (step 3), the account you make here is the only one until you invite people from Settings, Team; an invitation's link lets that address sign up. Without it, anyone who can open the dashboard's address can create an account. Each account only sees the teams it belongs to.

### 6. Let browsers reach the bucket

Uploads go straight from the browser to the bucket on signed links the toolkit makes, so the bucket needs a CORS rule for the dashboard's address:

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"]
  }
]
```

`ETag` must be exposed: uploads of 100 MiB or more go up in parts and need it. Add every address the dashboard is opened from, including preview deployments you sign in to. Those previews also need their origin in Convex: `npx convex env set TRUSTED_ORIGINS "https://your-app-*-team.vercel.app"` (comma-separated, `*` allowed), or sign-in says "Invalid origin".

### 7. Optional pieces

Each integration below is off until its settings are present, and shows up in Settings once they are. The full setup steps for each are in the [README](../README.md).

| To turn on                                                                    | Set on Convex                                                                                                                                                                | Set on the agent server                                             | Register this address with the service                                                         |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Email (alerts, password resets, invitations) via [toSend](https://tosend.com) | `TOSEND_API_KEY`, `EMAIL_FROM`, optional `EMAIL_FROM_NAME`, `REQUIRE_EMAIL_VERIFICATION`. Or set it in Settings, Email                                                       |                                                                     |                                                                                                |
| Sign in with Google                                                           | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (a Google Cloud OAuth client, type Web application)                                                                               |                                                                     | `SITE_URL/api/auth/callback/google`                                                            |
| Slack                                                                         | nothing; each team connects its own Slack app in Settings                                                                                                                    | nothing                                                             | `https://app.example.com/api/slack/events`                                                     |
| Discord                                                                       | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`                                                                                                            | `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY` | `CONVEX_SITE_URL/discord/callback`                                                             |
| Telegram                                                                      | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`                                                                                                                                | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`                       | none                                                                                           |
| Microsoft 365 (Teams meeting recordings)                                      | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`                                                                                                                             |                                                                     | `CONVEX_SITE_URL/microsoft/callback`                                                           |
| Microsoft Teams (the agent and alerts in Teams)                               | `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD`, `TEAMS_APP_TENANT_ID`, optional `TEAMS_APP_NAME`                                                                                       | the same four                                                       | `https://agent.example.com/api/agent-controllers/chat-agent-controller/channels/teams/webhook` |
| Zoom                                                                          | `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET`; for whole accounts also `ZOOM_ACCOUNT_CLIENT_ID`, `ZOOM_ACCOUNT_CLIENT_SECRET`, `ZOOM_ACCOUNT_WEBHOOK_SECRET` |                                                                     | `CONVEX_SITE_URL/zoom/callback`, `/zoom/events`, `/zoom/account-events`                        |
| Google Meet                                                                   | `GOOGLE_MEET_CLIENT_ID`, `GOOGLE_MEET_CLIENT_SECRET`                                                                                                                         |                                                                     | `CONVEX_SITE_URL/google-meet/callback`                                                         |
| Dropbox                                                                       | `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`                                                                                                                                      |                                                                     | `CONVEX_SITE_URL/dropbox/callback`, webhook `CONVEX_SITE_URL/dropbox/events`                   |
| Free stock footage for B-Roll                                                 | `PIXABAY_API_KEY` (free at pixabay.com/api/docs), or `PEXELS_API_KEY`                                                                                                        |                                                                     |                                                                                                |

The MCP server needs nothing set. AI apps that speak MCP (ChatGPT, Claude, Cursor, VS Code, n8n and others) connect to `CONVEX_SITE_URL/mcp`; apps that can sign in use OAuth (Better Auth, at `SITE_URL/api/auth`), and the rest use a key a team owner makes under Settings, MCP.

Settings on Convex take effect at once; settings on the agent server need a restart of that container.

## Every Setting

### Convex (`npx convex env set NAME value`)

| Name                                                                                  | Needed               | What it does                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_URL`                                                                            | yes                  | The dashboard's address. Sign-in, email links and OAuth redirects are built from it.                                                                                                                                                               |
| `BETTER_AUTH_SECRET`                                                                  | yes                  | Signs sessions. Changing it signs everyone out.                                                                                                                                                                                                    |
| `CONNECTIONS_SECRET`                                                                  | yes                  | Encrypts saved keys. Changing it means reconnecting everything.                                                                                                                                                                                    |
| `MASTRA_JWT_SECRET`                                                                   | for the agent        | Shared with the agent server and the web app; signs the requests between them.                                                                                                                                                                     |
| `AGENT_CONVEX_SECRET`                                                                 | no                   | A second secret, held only by Convex and the agent server, for the agent's calls to Convex. Set the same value on both (at least 32 characters) and the web app's secret can no longer open those routes. Without it, `MASTRA_JWT_SECRET` is used. |
| `AGENT_URL`                                                                           | for the agent        | The agent server's address, for @Agent in review rooms and scheduled agent turns.                                                                                                                                                                  |
| `TRUSTED_ORIGINS`                                                                     | no                   | Extra addresses allowed to sign in, comma-separated, `*` allowed.                                                                                                                                                                                  |
| `SIGN_UPS`                                                                            | recommended          | `invite-only`: the first account, then only invited addresses. `open` (the default): anyone who reaches the address.                                                                                                                               |
| `NCAT_EDITION`                                                                        | no                   | `self-hosted` (the default) or `hosted`. Only the hosted edition has trials and sign-up limits.                                                                                                                                                    |
| `HOSTED_TOOLKIT_URL`, `HOSTED_TOOLKIT_API_KEY`                                        | no                   | A toolkit you lend to teams. Teams on it do not see the Toolkit page, and setting up offers "Just use ours for now".                                                                                                                               |
| `OUTBOUND_PRIVATE`                                                                    | no                   | `block` refuses addresses on a private network (`http://n8n:5678`, `10.0.0.5`) for toolkits, Send to a URL and callbacks; `allow` permits them. Blocked by default on the hosted edition and when `HOSTED_TOOLKIT_URL` is set.                     |
| `HOSTED_TOOLKIT_JOBS_AT_ONCE`                                                         | no                   | Overrides the most jobs all teams on that toolkit may have there at once. Unset: the number of workers the toolkit reports. Waiting teams take turns.                                                                                              |
| `TRIAL_DAYS`, `TRIALS_PER_NETWORK`, `BUY_URL`, `BLOCKED_EMAIL_DOMAINS`                | hosted edition       | Free trial length (3), trials per network in 30 days (2), where "Buy" goes, extra email domains refused at sign-up.                                                                                                                                |
| `TOSEND_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `REQUIRE_EMAIL_VERIFICATION`       | no                   | Email, as above.                                                                                                                                                                                                                                   |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                                            | Sign in with Google  |                                                                                                                                                                                                                                                    |
| `PIXABAY_API_KEY`, `PEXELS_API_KEY`                                                   | no                   | Stock footage for B-Roll.                                                                                                                                                                                                                          |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`                     | Discord              |                                                                                                                                                                                                                                                    |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`                                         | Telegram             |                                                                                                                                                                                                                                                    |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`                                      | Microsoft 365        |                                                                                                                                                                                                                                                    |
| `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD`, `TEAMS_APP_TENANT_ID`, `TEAMS_APP_NAME`         | Microsoft Teams      |                                                                                                                                                                                                                                                    |
| `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET`                         | Zoom                 |                                                                                                                                                                                                                                                    |
| `ZOOM_ACCOUNT_CLIENT_ID`, `ZOOM_ACCOUNT_CLIENT_SECRET`, `ZOOM_ACCOUNT_WEBHOOK_SECRET` | Zoom, whole accounts |                                                                                                                                                                                                                                                    |
| `GOOGLE_MEET_CLIENT_ID`, `GOOGLE_MEET_CLIENT_SECRET`                                  | Google Meet          |                                                                                                                                                                                                                                                    |
| `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`                                               | Dropbox              |                                                                                                                                                                                                                                                    |
| `OPENAI_APPS_CHALLENGE`                                                               | no                   | The token ChatGPT's app directory gives you to prove the MCP address is yours, served as plain text at `CONVEX_SITE_URL/.well-known/openai-apps-challenge`. Only for listing your own copy there.                                                  |

`CONVEX_SITE_URL` is provided by Convex itself (from `CONVEX_SITE_ORIGIN` when self-hosted); do not set it.

### Web app

In `deploy/compose.yml` the web app takes these from `deploy/.env` (`CONVEX_URL`, `CONVEX_SITE_URL`, `MASTRA_JWT_SECRET`) and needs nothing more. Elsewhere:

| Name                          | Needed        | What it does                                                                                                     |
| ----------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CONVEX_URL`      | yes           | The Convex API address. Built into the pages.                                                                    |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | yes           | The Convex HTTP actions address. Built into the pages.                                                           |
| `NEXT_PUBLIC_SITE_URL`        | yes           | The dashboard's own address.                                                                                     |
| `NEXT_PUBLIC_WATCH_URL`       | no            | Where the "Watch how" videos play from. Unset, they come from `https://takewon.com/watch`. Built into the pages. |
| `MASTRA_SERVER_URL`           | for the agent | The agent server's address. The web app talks to it from the server side.                                        |
| `MASTRA_JWT_SECRET`           | for the agent | The shared secret. Without it the agent chat stays signed out.                                                   |

### Agent server

| Name                                                                          | Needed           | What it does                                                                                               |
| ----------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `APP_SECRET`                                                                  | yes              | At least 32 characters. The server will not start without it.                                              |
| `MASTRA_JWT_SECRET`                                                           | yes              | The shared secret.                                                                                         |
| `AGENT_CONVEX_SECRET`                                                         | no               | Signs this server's calls to Convex instead of `MASTRA_JWT_SECRET`; the same value as in Convex.           |
| `CONVEX_URL`                                                                  | yes              | The Convex API address. The agent calls it as the signed-in person; it has no key of its own.              |
| `CONVEX_SITE_URL`                                                             | when self-hosted | The Convex HTTP actions address. Worked out from `CONVEX_URL` only for Convex Cloud and local development. |
| `CHAT_MODEL`                                                                  | no               | `provider/model`; `anthropic/claude-sonnet-5-5` in `deploy/compose.yml`.                                   |
| `SIMPLE_CHAT_MODEL`                                                           | no               | The cheaper model for simple turns and for translating subtitles (`anthropic/claude-haiku-5-5`).           |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`         | one of them      | The key for the provider `CHAT_MODEL` names.                                                               |
| `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`           | Discord          |                                                                                                            |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`                                 | Telegram         |                                                                                                            |
| `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD`, `TEAMS_APP_TENANT_ID`, `TEAMS_APP_NAME` | Microsoft Teams  |                                                                                                            |
| `TURSO_DATABASE_URL`                                                          | no               | Where the agent keeps its memory. The image uses `file:/data/mastra.db`, so keep `/data` on a volume.      |
| `WORKSPACE_SANDBOX`                                                           | no               | Lets the agent run shell commands on its own server. Off, and keep it off when more than one team uses it. |

The agent server takes many more optional settings from the chat kit it is built on; they are listed with their defaults in [`packages/agent/.env.example`](../packages/agent/.env.example).

### Toolkit

`API_KEY` and the `S3_*` settings are required. Queue, transcription and performance settings are in the toolkit's [README](https://github.com/hamchowderr/no-code-architects-toolkit#readme).

## Updating

1. Pull the new images. On a server you rely on, pin the Takewon images to a `sha-<commit>` tag in `deploy/.env` (`TOOLKIT_IMAGE`, `AGENT_IMAGE`, `WEB_IMAGE`, and `SETUP_IMAGE` on the same commit as `WEB_IMAGE`) and move the tags on purpose. A commit's image appears once its GitHub Actions run has finished.
2. `docker compose -f deploy/compose.yml --env-file deploy/.env pull`, then `... up -d`, which restarts only what changed.
3. Push the backend from the same commit: `docker compose -f deploy/compose.yml --env-file deploy/.env run --rm setup` (or `npx convex deploy -y` from a clone at that commit). If the web app is on Vercel instead, deploy it from that commit too.

Never set a service to build its image on the machine that serves people. The toolkit's build takes 20 to 40 minutes of full CPU; if a restart falls back to building, the toolkit stays down that long.

To see how long videos take on your machine, before and after an update or a change of hardware, run the [speed test](speed-test.md).

## Backups

- **Convex** holds everything except files. `npx convex export --path backup.zip` (with the two `CONVEX_SELF_HOSTED_*` values set) saves it; `npx convex import` brings one back. Or back up the `convex-data` volume while Convex is stopped.
- **Bucket**: use your storage provider's versioning or replication.
- **Agent server**: the `agent-data` volume holds its conversation memory.
- **On a computer run by the desktop app**, backups are made for you: see [the desktop app](desktop-app.md). The app brings one back with **Bring back a backup**. By hand: start the stack, run `npx convex import --replace-all -y database.zip` and `npx convex env set --force < convex-settings.env` (with the two `CONVEX_SELF_HOSTED_*` values set), stop `agent` and unpack `agent-memory.tgz` into the `agent-data` volume, then start it and run `setup` again. `settings.env` is the app's settings file from then, for a computer that has none.
- **Secrets**: keep `CONNECTIONS_SECRET`, `BETTER_AUTH_SECRET`, the Convex instance secret and admin key, and `MASTRA_JWT_SECRET` in a secrets manager. Without `CONNECTIONS_SECRET` a restored database cannot read its saved keys.

## When Something Is Wrong

| What you see                                  | Why, and what to do                                                                                                                                                                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-up hangs on a spinner                    | Convex's `CONVEX_CLOUD_ORIGIN` or `CONVEX_SITE_ORIGIN` is wrong or not a literal address. Fix it, restart Convex, push the functions again.                                                                                                        |
| "Invalid origin" at sign-in                   | The page's address is not `SITE_URL` or in `TRUSTED_ORIGINS`.                                                                                                                                                                                      |
| "Could not find public function"              | The web app is newer than the backend. Run the setup again (step 3) with `SETUP_IMAGE` on the same commit as `WEB_IMAGE`.                                                                                                                          |
| Pages time out on a busy machine              | Each call loads its code first, and a slow or busy CPU can pass Convex's 1 second limit. `deploy/compose.yml` already raises it to 5 seconds (`DATABASE_UDF_USER_TIMEOUT_SECONDS`); give the machine more CPU or cap the toolkit (`TOOLKIT_CPUS`). |
| Pushing functions times out while "analyzing" | Raise `ISOLATE_ANALYZE_USER_TIMEOUT_SECONDS` on Convex (compose sets 30).                                                                                                                                                                          |
| Uploads fail with a CORS error                | The dashboard's address is missing from the bucket's CORS rule, or `ETag` is not exposed.                                                                                                                                                          |
| "Connect" refuses the toolkit                 | It is the original toolkit, not the fork, or the key is wrong. The fork answers `/v1/storage/info`.                                                                                                                                                |
| Jobs stay "Running"                           | The toolkit cannot reach `CONVEX_SITE_URL/toolkit/webhook`. From the toolkit's machine, `curl` that address.                                                                                                                                       |
| The agent says it is not connected            | `CONVEX_URL`, `CONVEX_SITE_URL` or `MASTRA_JWT_SECRET` is missing or different on one of the three places it must match.                                                                                                                           |

## Licence

The licence and what it asks of anyone running a copy are in the Licence section of the [README](../README.md#licence) and in [LICENSE](../LICENSE). The NCA Toolkit has its own licence, GPL-2.0.
