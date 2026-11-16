# ncat-dash

A dashboard for the [No-Code Architects Toolkit](https://github.com/stephengpope/no-code-architects-toolkit): build, test and run media automations (clips, captions, transcripts, posting) from the browser, with an agent that builds them for you.

Working name: NCA Toolkit Dashboard. Under active development.

## What is here

- `src/` is the Next.js app: sign-in, onboarding and the dashboard shell (shadcn/ui with blocks from shadcnuikit).
- `convex/` is the backend: Better Auth with teams (`convex/betterAuth`), toolkit connections, and the edition setting.
- `packages/step-catalog/` describes every toolkit endpoint once (inputs, outputs, how to call it). The app, the automation runner and the agent all read from it.
- `.agents/skills/` holds the official agent skills for Convex, Better Auth, Mastra, Vercel and shadcn.

## Run it locally

Needs Node 22 and pnpm.

```bash
pnpm install
npx convex dev            # creates your Convex deployment and writes .env.local
```

Add `NEXT_PUBLIC_SITE_URL=http://localhost:3000` to `.env.local`, then set the backend's secrets once:

```bash
npx convex env set SITE_URL http://localhost:3000
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
npx convex env set CONNECTIONS_SECRET "$(openssl rand -base64 32)"
```

With `npx convex dev` still running, start the app in a second terminal:

```bash
pnpm dev
```

Open http://localhost:3000, create an account, name your team, then paste your toolkit's address and API key. The key is tested before it is saved and stored encrypted.

`CONNECTIONS_SECRET` encrypts saved toolkit keys. If it changes, teams reconnect their toolkit.

### Editions

One codebase serves both editions. Self-hosted is the default. `npx convex env set NCAT_EDITION hosted` switches a deployment to the hosted edition.

### Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

### UI blocks

Blocks come from the shadcnuikit registry, which needs a licence key in `SHADCNUIKIT_API_KEY`:

```bash
npx shadcn add @shadcnuikit/<block-name>
```

## Licence

GPL-2.0-or-later, the same licence as the NCA Toolkit. See [LICENSE](LICENSE).
