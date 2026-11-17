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

Steps are wired by themselves (`wiring.ts`). A step is given the nearest files of the kind it wants before it: those from the step straight before if it made some, otherwise from further back, and last the file that started the run. So captions placed after a transcript step still get the video, and a logo placed after a thumbnail step gets the video before the thumbnail. The kind wanted comes from the step's file setting (`video_url`, `audio_urls`, `image_url`), and the kind made from the file's ending. Where someone wants a different file, the setting is a pick list: Automatic, the file that started the run, the file from an earlier step, or a fixed file. The agent makes the same choice with the `use` operation. What is saved is a reference such as `{{steps.caption_1.url}}` that the runner fills in (`templates.ts`); it is not shown or typed anywhere. Removing a step clears the settings that pointed at it. Text travels the same way. A step can say it makes a named value (`values` in the step catalog: Transcribe makes `transcript` and `captions`) and another that a setting takes one (`valueInputs`: Caption video takes `captions`). Left empty, that setting is filled from the nearest earlier step that makes it, and that step is told to make it (`include_srt`) only when something later is waiting. The toolkit accepts caption text only with the classic style, so with any other style the caption step is left to transcribe the video itself. The graph, wiring and schedule rules live in `packages/automation-core` and are covered by its tests.

Things a team sets once live in Settings, under Brand (`brand.ts`): its logo, brand colour, font and background music. A step says which of its settings take one (`brandInputs` in the step catalog: Add a logo takes the logo, the text recipes take the font and colour, Add background music takes the music). Left empty, that setting is filled from the team's brand when the step runs, so no step asks for a logo. A step that needs something the team has not set yet says so on the canvas and links to Settings, and the automation cannot be switched on until it is there. A file kept in settings is saved as a lasting pointer to the upload (`upload:<id>`), because a signed link stops working after a week; the pointer is swapped for a fresh link at the moment the job is sent to the toolkit. In the step panel only what a step cannot work out is asked for up front; what it takes care of is listed under "Handled for you" and the rest sits under "More options". Each step has its own icon (`step-icons.ts`).

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
