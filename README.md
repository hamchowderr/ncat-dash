# ncat-dash

A dashboard for the [No-Code Architects Toolkit](https://github.com/stephengpope/no-code-architects-toolkit): build, test and run media automations (clips, captions, transcripts, posting) from the browser, with an agent that builds them for you.

Working name: NCA Toolkit Dashboard. Under active development.

## What is here

- `src/` is the Next.js app: sign-in, onboarding and the dashboard shell (open-source shadcn/ui).
- `convex/` is the backend: Better Auth with teams (`convex/betterAuth`), toolkit connections, jobs (one run of one step, finished by the toolkit's webhook), storage and uploads, the automation runner (`convex/lib/runner.ts`, with its triggers in `convex/automations.ts`), and the edition setting.
- `packages/automation-core/` holds the rules an automation follows: what makes a valid graph, which steps are ready, placeholders, schedules. It also holds the node registry and the building operations, described under Automations.
- `packages/step-catalog/` describes every toolkit endpoint once (inputs, outputs, how to call it). The app, the automation runner and the agent all read from it. Its tests compare every step with `test/toolkit-schemas.json`, the request schemas read out of the toolkit's own routes, because the toolkit rejects fields it does not know.
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

### Trying steps

Steps lists everything the toolkit can do. Each step has a form built from its schema in the catalog; running it creates a job that updates live when the toolkit posts the result back to `<your Convex site URL>/toolkit/webhook`. Jobs keeps every run and Outputs collects the files.

Recipes are ready-made FFmpeg jobs with a few blanks to fill in, such as cropping to vertical, adding a logo, or text with an outline. Each one builds a request for the toolkit's `/v1/ffmpeg/compose` route, so nobody writes a filter graph by hand. They live in `packages/step-catalog/src/recipes.ts`, come from the compose examples in the toolkit's Postman collection, and work as steps in automations too. The tests run every recipe through a real FFmpeg when one is installed.

Automations are built and read on a canvas that runs left to right: a trigger, then steps joined by lines, with a plus to carry on from the last one. Selecting a node opens its settings; a step that still needs a setting says so on the node and the automation will not switch on until it is filled in. A run shows the same canvas with each node's live state. New automations start from templates drawn as their steps (`packages/automation-core/src/starters.ts`): a handful of workflows, plus one per FFmpeg example in the toolkit's Postman collection. "Clips for social" uses a clips step that cuts each video at pauses in speech into the fewest clips that fit a platform's length limit and reframes them (`clips.ts`). The Steps and Jobs pages, under Builder in the sidebar, are a workbench for trying single steps.

Uploads sends files straight from the browser to a bucket you own (Cloudflare R2, AWS S3, DigitalOcean Spaces, MinIO). The bucket needs a CORS rule that allows `PUT` from the dashboard's address.

### Automations

An automation is a chain of steps drawn on a canvas at `/automations`. It starts by hand, when its webhook address is called, on a schedule, when a file is uploaded, or when a file lands in a watched folder of the team's bucket (checked every minute), and runs with nobody logged in. New automations can begin from a starter such as "Captioned clips from a watched folder". A step that takes one file runs once per file it receives, so a split that makes five clips is followed by five caption jobs. An approval step stops the run until someone on the team approves. `/settings` sets how many jobs a team sends to its toolkit at once; the rest wait their turn.

Every kind of node is described once, in `packages/automation-core/src/registry.ts`: the five ways an automation starts, every toolkit step and recipe, approval and clips. Each entry says what the node takes from the step before, what it hands on, and the settings it needs as JSON Schema. The step list on the canvas is drawn from it, and `nodeTypeIndex()` gives the same list as text for the agent. To add a kind of node, add it there.

Changes to an automation are plain data (`operations.ts`): add a step after another or on a line between two, remove, connect, disconnect, set settings, rename, change the start, tidy. The canvas makes its changes through `applyOperations`, and the agent sends the same operations to `automations.change`, which makes all of them or none and returns the automation as text (`outline`) with anything still missing. `automations.describe` returns that text without changing anything. An open editor shows a change made this way as it happens, unless the person has unsaved work.

Text fields in a step can hold placeholders such as `{{trigger.file_url}}`, `{{trigger.body.title}}` or `{{steps.caption_1.url}}`. The graph, placeholder and schedule rules live in `packages/automation-core` and are covered by its tests.

### Editions

One codebase serves both editions. Self-hosted is the default. `npx convex env set NCAT_EDITION hosted` switches a deployment to the hosted edition.

### Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

### UI

Everything is built on open-source [shadcn/ui](https://ui.shadcn.com) components and blocks, so the whole codebase can be passed on under the GPL.

```bash
npx shadcn add <component-or-block>
```

## Licence

GPL-2.0-or-later, the same licence as the NCA Toolkit. See [LICENSE](LICENSE).
