# ncat-dash

A dashboard for the [No-Code Architects Toolkit](https://github.com/stephengpope/no-code-architects-toolkit): build, test and run media automations (clips, captions, transcripts, posting) from the browser, with an agent that builds them for you.

Working name: NCA Toolkit Dashboard. Under active development.

## What is here

- `src/` is the Next.js app: sign-in, onboarding and the dashboard shell (open-source shadcn/ui).
- `convex/` is the backend: Better Auth with teams (`convex/betterAuth`), toolkit connections, jobs (one run of one step, finished by the toolkit's webhook), storage and uploads, the automation runner (`convex/lib/runner.ts`, with its triggers in `convex/automations.ts`), and the edition setting.
- `packages/automation-core/` holds the rules an automation follows: what makes a valid graph, which steps are ready, placeholders, schedules. It also holds the node registry and the building operations, described under Automations.
- `packages/email/` holds the emails the app sends (as plain data) and a small client for toSend, the service that delivers them.
- `packages/step-catalog/` describes every toolkit endpoint once (inputs, outputs, how to call it). The app, the automation runner and the agent all read from it. Its tests compare every step with `test/toolkit-schemas.json`, the request schemas read out of the toolkit's own routes, because the toolkit rejects fields it does not know.
- `packages/agent/` is the agent server: a Mastra server that chats with a signed-in person and builds automations for them. See The agent.
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

An automation that is switched on keeps running its live version while it is edited (`draft` on the automation). Saving, from the canvas or through `automations.change`, goes to the draft; triggers keep starting the live version, and Run now runs what the canvas shows so a draft can be tried first. `automations.publish` makes the draft live and refuses one that could not run, so a live automation is never switched off by an edit; `automations.discardDraft` throws it away. The bar above the canvas lists what publishing would change (`draftChanges` in `history.ts`), and the list marks automations with a draft. An automation that is off and has no draft saves straight to its live version, as before.

Every version an automation has had as its live version is kept, numbered from 1 (`automationVersions`, `convex/lib/versions.ts`): when it is made or imported, each save while it is off, and each publish, with who did it. A save that only moves steps around, or runs the same as the version before, adds none, and the newest 100 are kept. The Versions tab beside Runs lists them with what changed from the one before (`versions.list`), shows a version's steps on a still canvas (`versions.get`), exports one as a file, and brings one back as the draft (`versions.restore`), so nothing that runs changes until someone publishes it. The draft bar then says which version it came from, and the version published from it is marked as brought back.

The canvas has undo and redo (the buttons beside the name, Ctrl+Z and Ctrl+Shift+Z). Every state of the automation is kept as plain data (`history.ts`: up to 100 steps, with changes made in quick succession, such as typing, counted as one). A change that arrives from the agent or a teammate is a step of its own, so it can be undone too.

Steps are wired by themselves (`wiring.ts`). A step is given the nearest files of the kind it wants before it: those from the step straight before if it made some, otherwise from further back, and last the file that started the run. So captions placed after a transcript step still get the video, and a logo placed after a thumbnail step gets the video before the thumbnail. The kind wanted comes from the step's file setting (`video_url`, `audio_urls`, `image_url`), and the kind made from the file's ending. Where someone wants a different file, the setting is a pick list: Automatic, the file that started the run, the file from an earlier step, or a fixed file. The agent makes the same choice with the `use` operation. What is saved is a reference such as `{{steps.caption_1.url}}` that the runner fills in (`templates.ts`); it is not shown or typed anywhere. Removing a step clears the settings that pointed at it. Text travels the same way. A step can say it makes a named value (`values` in the step catalog: Transcribe makes `transcript` and `captions`) and another that a setting takes one (`valueInputs`: Caption video takes `captions`). Left empty, that setting is filled from the nearest earlier step that makes it, and that step is told to make it (`include_srt`) only when something later is waiting. The toolkit accepts caption text only with the classic style, so with any other style the caption step is left to transcribe the video itself. The graph, wiring and schedule rules live in `packages/automation-core` and are covered by its tests.

Things a team sets once live in Settings, under Brand (`brand.ts`): its logo, brand colour, font and background music. A step says which of its settings take one (`brandInputs` in the step catalog: Add a logo takes the logo, the text recipes take the font and colour, Add background music takes the music). Left empty, that setting is filled from the team's brand when the step runs, so no step asks for a logo. A step that needs something the team has not set yet says so on the canvas and links to Settings, and the automation cannot be switched on until it is there. A file kept in settings is saved as a lasting pointer to the upload (`upload:<id>`), because a signed link stops working after a week; the pointer is swapped for a fresh link at the moment the job is sent to the toolkit. In the step panel only what a step cannot work out is asked for up front; what it takes care of is listed under "Handled for you" and the rest sits under "More options". Each step has its own icon (`step-icons.ts`). Music is a library rather than one track (`teamSettings.music`): a team adds as many tracks as it likes, a step that adds music uses the first unless it picks another by name, and `automations.describe` lists the tracks for the agent. A logo or track sent from Settings is marked `purpose: "brand"` so it never starts an automation. The brand is asked for while setting up (team, toolkit, storage, brand; the last two can be skipped), the same form is in Settings, and the logo is shown wherever it is used, including beside the team name.

Step settings that are lists or groups (cuts, clips to make, find-and-replace pairs, caption styling, headers) are edited as rows and fields (`structured-field.tsx`, with the screen-free parts in `automation-core/src/structured.ts`); nobody types raw data, and a time typed as `1:30` or `90` is tidied to `00:01:30`.

Every upload is read once it finishes (`storage.readDetails`): the toolkit's `/v1/media/metadata` runs FFprobe on the file, and what it finds (`FileDetails` in `details.ts`: length, picture size, frame rate, codecs, whether it has sound, format, bitrate) is kept with the upload and shown on the Uploads page in the same columns for every file (`fileDetailColumns`), with a dash where one does not apply; clicking a file name lists everything that was read (`fileDetailRows`). The automations waiting for an upload start only after that, so a run begins with the details in its trigger data (`trigger.details`), and an upload trigger can be limited to files of a certain length (`minSeconds`, `maxSeconds`). A file the toolkit cannot read still starts automations that set no limit.

Two steps decide where files go rather than making anything (`logic.ts`, the Logic group on the canvas). An If has two ways out, Yes and No, and sorts each file it is given by one check on the file's details: its length, type, shape, picture size or whether it has sound. The check is made from pick lists; nothing is typed but a number. A line leaving an If remembers its way (`branch` on the edge), a step only receives the files sent toward it, and steps on a way no file took are marked Skipped. The details come from the upload that started the run, and for a file made during the run from one `/v1/media/metadata` job per file. A file that cannot be read goes out by No. A Wait holds the run for a number of minutes, hours or days, six days at most because a signed link lasts a week, then hands on the files it was given; the run shows when it carries on.

An automation can be saved as a file and brought into another team (`transfer.ts`). Export on the editor, or "Export as a file" in the list, downloads `<name>.automation.json`: the steps, lines and start, without the team's own uploads, connection details or webhook address. Import on the Automations page reads one back. Everything in the file is checked and rebuilt rather than trusted: settings a step does not have are dropped and listed, a step this version does not know or a file from a newer version is refused in plain words, and the imported automation arrives switched off with a new webhook address.

Files (`/files`, `convex/files.ts`) shows everything in the team's bucket as folders and files, whether or not it came in through this app: open folders, make folders and subfolders, upload into the open folder, rename, move (a picker, or drag a row onto a folder), delete, play a file, download it or copy a link. A bucket has no folders and no rename, so a folder is a key prefix, an empty folder is a zero-byte object whose key ends in a slash, and a rename or move copies each object to its new key, moves the pointers, then deletes the originals. Nothing is overwritten: a name already taken stops the change. What follows a moved file: its upload record (so `upload:<id>` pointers in the brand, the music library and step settings keep working untouched), what a watched folder has already seen (a renamed file does not run twice), the folder a watched-folder automation looks in, and plain links to the bucket in the outputs of recent jobs and run steps (`followMoves` in `packages/automation-core/src/bucket.ts`). A link handed out under a public address is followed too, once that address (the toolkit's `S3_PUBLIC_URL`) is entered with the storage settings; signed links are not, since they stop working after a week anyway. Files that reached the bucket without going through this app (dropped in by another tool, or made by a step) have their details read as well: opening a folder sends up to 25 unread video, audio and picture files to the toolkit's `/v1/media/metadata`, keeps what comes back in `bucketFiles` against the file's etag, and shows each one as it arrives (`files.detailsIn`). A file replaced under the same name is read again. A file the brand uses cannot be deleted until it is taken out of Settings. One change touches at most 2,000 objects. Files of 4 GiB or more are copied in parts by the toolkit, so there is no 5 GB limit. Uploads of 100 MiB or more go up in parts, four side by side, with each part tried up to three times (`src/lib/send-file.ts`); files can be up to 4.9 TB (R2's limit). The bucket's CORS rule must expose the `ETag` header for those.

A step that fails in a run tries again before the run is given up on (`retry.ts`, and `bookRetry` in the runner). Only the jobs that failed are sent again, exactly as they were, after a wait that grows each time: 30 seconds, then 2, 5, 10 and 15 minutes. `/settings` sets how many times, from 0 to 5; a team that has not chosen gets 2. A failure that would end the same way every time is not tried again: a request the toolkit refuses (HTTP 4xx other than 408 and 429), a file that is gone, a step that is no longer in the catalog. A run shows the step as "Trying again" with the time left and why the last try failed, and the list of runs says how often a run tried again. When a run still fails, every member of the team gets an alert (`convex/alerts.ts`): a notice on screen straight away and an entry under the bell at the top of every page, which links to the run and stays marked until that person has seen it. Rejecting at an approval step or stopping a run alerts nobody; an approval that runs out of time has its own alert (below). A finished run has "Run again", which starts it over with the same file and data and the automation as it is now. The same alert goes out by email once email is set up (below), as each member chose under Notifications.

### Email

Email goes out through [toSend](https://tosend.com), a hosted email delivery service: failed-run alerts, password resets, address confirmations and team invitations. It is set up once and everything uses it.

1. Create a toSend account, add your sending domain there and add the DNS records it shows (DKIM, SPF and MX) until the domain reads Verified. toSend only sends from a verified domain.
2. Create a sending API key in toSend (it starts with `tsend_`).
3. In the dashboard open Settings, Email. Paste the key, enter the address to send from (on the verified domain) and the sender name, then "Check and save". The key and the domain are checked with toSend before anything is saved, and the key is stored encrypted. "Send me a test email" proves it end to end.

Whoever runs the deployment can set it from the outside instead, which wins over Settings and is how the hosted edition is set up:

```bash
npx convex env set TOSEND_API_KEY tsend_...
npx convex env set EMAIL_FROM alerts@yourdomain.com
npx convex env set EMAIL_FROM_NAME "Your Company"   # optional
```

What uses it:

- **Notifications.** Failed runs, approvals waiting, approvals that ran out of time, and mentions in a review are emailed to the people they are for (`email.sendAlert`, scheduled by `notify` in `convex/lib/alerts.ts`), as each member chose under Notifications (next section).
- **Password reset.** The sign-in page shows "Forgot your password?" once email is set up. The link works once, for one hour.
- **Address confirmation.** A new account is sent a link to confirm its address. Signing in does not wait for it unless you set `npx convex env set REQUIRE_EMAIL_VERIFICATION true`; only do that once email works, or nobody new can sign in.
- **Team invitations.** Settings, Team invites someone by email as a member or admin. The link (`/accept-invitation/<id>`) works for 48 hours and takes the person through signing in or creating an account first. With no email set up the invitation is still made and its link can be copied and sent by hand.

With no email set up nothing is sent and nothing breaks. If toSend refuses to send (a wrong key, an unpaid account, an unverified domain), Settings says so in plain words. There is one sending account per deployment because sign-in emails go out before anyone is on a team; in the self-hosted edition it belongs to the team that set it up. The messages and the toSend client are in `packages/email` (fetch only, no SDK); the functions are in `convex/email.ts`.

Two things in toSend's own rules matter here: it is for email people expect (alerts, account email, invitations), not cold outreach, and it needs a paid toSend plan once its trial ends.

### Notifications

Everything the dashboard tells people about goes through one helper, `notify` in `convex/lib/alerts.ts`, which writes an `alerts` row and books its email. There are four kinds (`NOTIFICATION_KINDS` in `convex/lib/notifications.ts`):

| Kind | Who | Raised by |
| --- | --- | --- |
| A run fails | everyone on the team | `alertTeam` in the runner, once a step has used all its tries |
| An approval is waiting for me | the reviewers named on the step, or the whole team | `startApproval` in the runner |
| An approval ran out of time | the same people as the approval | `decideApproval` when its time limit decides; this replaces the failed-run alert a timed-out reject used to raise |
| Someone mentions me in a review | the people named after "@", not the author | `reviews.comment`; links to `/review/<id>?clip=<clip>&comment=<thread>` |

Settings, Notifications lets each member choose, for themselves and per team, whether each kind shows under the bell and whether it is emailed (`convex/notifications.ts`, table `notificationPreferences`). Everything starts on. A kind switched off for the bell is left out of that person's bell, count and pop-up notices (`alerts.list`); the row stays, so switching it back on shows it again. Emails can come as they happen, or as one summary a day at an hour the member picks in their own time zone (taken from the browser): an hourly cron (`notifications.bookDigests`) books `email.sendDigest` for each member whose hour it is. Approvals waiting are always emailed at once, because they have a deadline.

### Slack

People can tag the agent in a Slack channel or message it directly, and it answers in that thread. Each team runs it on its own Slack app, so nothing goes through an outside service and there is nothing to pay for. It is a regular self-managed Mastra channel (`packages/agent/src/mastra/ncat/slack.ts`), not Mastra Connect.

1. Open the dashboard at its public address (Slack cannot reach `localhost`), then Settings, Slack, and press "Create the Slack app". Slack opens with the app's manifest filled in (`src/lib/slack-manifest.ts`): its name, the bot permissions, and this dashboard's `/api/slack/events` as the address for events and button presses. Pick the workspace and press Create.
2. In the app, open Install App and press Install to Workspace.
3. Paste the Bot User OAuth Token (`xoxb-...`, under OAuth & Permissions) and the Signing Secret (under Basic Information) into Settings and press "Connect Slack". The token is checked with Slack before anything is saved, and both are stored encrypted (`convex/slack.ts`). One workspace belongs to one team.

How it works: Slack posts to the dashboard's `/api/slack/events`, which passes the request as it came to the agent server. The agent server asks the dashboard for that workspace's token and signing secret (`POST /slack/installation` on the Convex site, signed with `MASTRA_JWT_SECRET`), checks Slack's signature with that workspace's own secret, and answers with its own token. Whoever wrote is found on the team by the email address on their Slack profile (`POST /slack/person`), and the agent works in the dashboard as them, with their rights and nothing more. Someone the team does not have is told to ask an owner for an invitation, and nothing else happens. The agent server needs `MASTRA_JWT_SECRET` and the Convex address (`CONVEX_URL`, or `CONVEX_SITE_URL` when the HTTP actions live elsewhere); without them the Slack channel is off.

Review activity: once Slack is connected, an owner picks a channel under "Review activity" in the same card. New reviews, client feedback (comments and the client's verdict) and mentions are posted there, and the person mentioned is tagged when their Slack email matches. Each comment thread becomes one Slack thread: what follows in the review room (a client's next comment, a teammate's reply) goes into that Slack thread, and a teammate's reply written in the Slack thread comes back into the review as their reply, which a client sees as they would any team reply. Someone in Slack who is not on the team gets a note only they see, and their reply stays in Slack. The app joins a public channel by itself; for a private one, invite the app in Slack first. The dashboard's `/api/slack/events` passes replies in threads to Convex (`POST /slack/events`, checked with the workspace's signing secret) as well as to the agent server. The code is in `convex/slackReview.ts` and `convex/lib/slackPosts.ts`.

The browser tests play Slack with a stand-in (`e2e/slack-stand-in.mjs`, port 8768), which the dashboard and the agent server reach through `SLACK_API_URL`.

### Discord

People can tag the agent in their Discord server or message it directly, and it answers there. Unlike Slack, the dashboard has ONE Discord bot that every team uses: Discord only sends normal messages over a live connection per bot, so one bot that joins many servers is simpler. Whoever runs the dashboard sets it up once:

1. In the [Discord Developer Portal](https://discord.com/developers/applications), press New Application. On Bot, press Reset Token and copy it, and switch on Message Content Intent. On General Information, copy the Application ID and the Public Key. Leave Interactions Endpoint URL empty: the agent server takes everything over its live connection. On OAuth2, copy the Client Secret and add the redirect `https://<your Convex site>/discord/callback`.
2. On the agent server set `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID` and `DISCORD_PUBLIC_KEY` (it also needs `MASTRA_JWT_SECRET` and the Convex address, as for Slack). On the Convex deployment set `DISCORD_CLIENT_ID` (the Application ID) and `DISCORD_CLIENT_SECRET`.

Then, in Settings, Discord, a team owner presses "Add to Discord", picks the team's server on Discord and is sent back; that links the server to the team (one server belongs to one team). Discord gives bots no email address, so each member presses "Link my Discord" once. The agent finds who wrote by their Discord id on the team that owns the server (`POST /discord/person` on the Convex site, signed with `MASTRA_JWT_SECRET`) and works as them, with their rights and nothing more. Someone who has not linked is told how to, and nothing else happens. In a direct message it is the one team they linked; someone on several teams is asked to write in that team's server. The code is in `convex/discord.ts` and `packages/agent/src/mastra/ncat/discord.ts`.

### Zoom

Cloud recordings of Zoom meetings come into Uploads by themselves. The dashboard has ONE Zoom app that every team uses; whoever runs the dashboard sets it up once:

1. On the [Zoom App Marketplace](https://marketplace.zoom.us/), press Develop, Build App, General App. Pick User-managed. Under OAuth Information add the redirect `https://<your Convex site>/zoom/callback` (and the same address to the allow list). Under Scopes add `user:read:user`, `cloud_recording:read:list_user_recordings` and `cloud_recording:read:recording`.
2. On the Convex deployment set `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` and `ZOOM_WEBHOOK_SECRET` (the Secret Token on Features, Access), and push the functions.
3. Back on Features, Access, switch on Event Subscription and add the event "All Recordings have completed" (`recording.completed`) with the address `https://<your Convex site>/zoom/events`. Zoom checks the address as it is saved, which works once step 2 is done.

Then, in Settings, Zoom, each person who hosts meetings presses "Connect Zoom". When Zoom finishes a cloud recording of a meeting they host, the dashboard picks its best video (the shared screen with the speaker first, the sound alone when there is no video) and has the team's toolkit stream it from Zoom into the team's folder (`/v1/s3/upload`, which copies in parts, so size does not matter and nothing passes through the dashboard). It then becomes an upload like any other: it joins the library and starts the automations set to run on an upload. The last 30 days of recordings can also be brought in by hand. Zoom's sign-in for the download is added only as the job is sent, never kept with the job. Until the Zoom app is published, its development keys work only for accounts on the Zoom account that made it. The code is in `convex/zoom.ts` and `convex/lib/zoom.ts`.

### The agent

The Agent button in the top bar opens a chat beside whatever is on screen. Describe what should run by itself and the agent builds the automation; ask for a change to the one that is open and it makes it on the canvas. It asks before it makes, changes or switches on anything, on a card that lists the change in plain words.

It is two parts, both from [mastra-chat-kit](https://github.com/hamchowderr/mastra-chat-kit) (MIT, see `packages/agent/LICENSE-mastra-chat-kit`):

- `packages/agent/` is the kit's server at commit `2aef2da`, a Mastra `AgentController` server on port 4111. What is ours is in `src/mastra/ncat/`: the tools (`tools.ts`: look at the team's automations, read one, list step types, change one, make one, switch one on or off, list the team's uploads, try one on an upload, and check how a run went), the instructions, and the hand-over described below. Kit files changed: `agents/chat.ts` (our tools and instructions), `lib/tool-categories.ts` (reading never asks, changing asks, switching on always asks), `lib/env.ts` (`CONVEX_URL`), `mastra/index.ts` (our route), and `fixtures/chat.json`. The kit's own tests are not copied.
- The chat panel is the kit's `chat-panel`, installed with shadcn into `src/components/chat*`, `src/components/ai-elements`, `src/lib/agent-controller`, `src/lib/mastra-proxy.ts` and the proxy routes under `src/app/api/`. It was installed from the registry built at that same commit, because the published registry was older than the server and the two did not agree on approvals. One change to it: `ChatPanel` takes `renderTool`. Ours is `src/components/agent/`: the panel's wording, what each approval card and tool line says (`tool-words.ts`), and the Agent button in the shell.

The agent has no access of its own. On every chat request the web app (`src/lib/agent-session.ts`, wired in `src/instrumentation.ts`) hands the agent server the signed-in person's own Convex token and the team and automation on their screen, in a request signed with `MASTRA_JWT_SECRET`. The tools then call the same Convex functions the dashboard does, as that person, so the agent can see and change what they can and nothing else. The hand-over is kept in memory only. A new automation the agent makes becomes "this automation" until another is on screen. An open editor shows the agent's change as it happens, unless the person has unsaved work of their own.

To connect the two, start Convex once (`npx convex dev`), then run:

```bash
pnpm setup:agent
```

It makes the shared secret and puts every value where it is read: `.env.local` for the chat, `packages/agent/.env` for the agent server, and `AGENT_URL` and `MASTRA_JWT_SECRET` in Convex for @Agent in review rooms. Running it again keeps the same secret. When the agent server runs somewhere else, pass its address: `pnpm setup:agent --agent-url https://agent.example.com` (a Convex in the cloud cannot reach an agent on your own computer). The model key is not copied anywhere: it stays in Infisical, and `infisical run` hands it to the agent server as it starts. The model is Sonnet 5.5 (`CHAT_MODEL=anthropic/claude-sonnet-5-5`, set by `pnpm setup:agent`). Then:

```bash
infisical run --path=/shared -- pnpm --filter @ncat-dash/agent dev   # the agent server, with the model key from Infisical
pnpm --filter @ncat-dash/agent dev:mock   # only with USE_AIMOCK=true
```

The stand-in model is [AIMock](https://aimock.copilotkit.dev), a small server that pretends to be a model provider. It costs nothing and needs no key. The agent package carries the kit's whole AIMock setup:

- `pnpm --filter @ncat-dash/agent dev:mock` answers from a script (`packages/agent/fixtures/chat.json`). Our set requests come first in that file: "List my automations and say which are switched on.", "Build an automation that makes short clips with captions from each new recording I upload." and then "Add captions to the clips before they go for approval." The kit's own demo requests follow.
- `pnpm --filter @ncat-dash/agent test` runs the kit's tests and ours against it. `tests/integration/ncat-tools.test.ts` drives our tools end to end through the real approval gates, with only Convex stood in for, and reads AIMock's journal to prove each step was answered by its own script entry. A test in `automation-core` makes the scripted changes against the real automation rules.

#### Recording a real model

AIMock can also sit between the agent and a real model and save what the model answers, so a real conversation can be played back afterwards for free, in tests and for screen recordings.

1. In `packages/agent/.env` keep `USE_AIMOCK=true` and set a real key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`) with a matching `CHAT_MODEL` such as `anthropic/claude-sonnet-5-5`. Recording goes straight to the provider; a gateway model (`vercel/...`, `mastra/...`) is not recorded.
2. Run `pnpm --filter @ncat-dash/agent dev:record` in place of `dev:mock`, and use the chat. Each answer the model gives is saved under `packages/agent/fixtures/recorded/`. A message that was already recorded is played back and costs nothing; only new ones reach the model.
3. Run `pnpm --filter @ncat-dash/agent dev:replay` to play the recordings back with no key. Anything that was not recorded gets an error there, so a recording can never quietly turn into a paid call.

A recording is matched on the message the person typed, so the same sentence always gets the same answer. Read a recording before committing it. The recorder reads the folder when it starts, so restart it after deleting recordings.

One real conversation is recorded so far: the agent builds an automation, tries it on an upload and reports (see `packages/agent/fixtures/recorded/README.md`). Its tool calls name the automation it built, so played back against a fresh dashboard the later changes go to an automation that is not there; it is for tests and for reading what the model did, not for a full replay in the browser.

On first start the agent server downloads a small text-embedding model (fastembed) for recalling earlier conversations.

### Editions

One codebase serves both editions. Self-hosted is the default. `npx convex env set NCAT_EDITION hosted` switches a deployment to the hosted edition.

The Toolkit page (server load, queue, build) is for teams that run their own toolkit. On the hosted edition no team sees it. On a self-hosted copy that also lends a toolkit to teams, `npx convex env set HOSTED_TOOLKIT_URL https://your-toolkit` hides it from the teams connected to that address. Set `HOSTED_TOOLKIT_API_KEY` with it and setting up answers "Do You Have A Toolkit?" No with "Just use ours for now", connecting the team to that toolkit. Without both, No skips the toolkit and the team connects one later from Home.

### Checks

`pnpm test` runs three sets: each package's own tests, the Convex functions in memory (`convex/*.test.ts`, set up in `convex/test.setup.ts`), and the screens in a pretend browser (`src/**/*.test.ts(x)`). A change to a Convex function or a screen comes with a test in the matching set.

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

## Issues

Work is tracked in Beads (`bd`), not GitHub issues. The issues live in a Dolt database on DoltHub, `chowderr/ncat-dash` (private), and `.beads/issues.jsonl` is a read-only export of it. Every piece of work starts as a bead, and its PR names the bead it closes (for example "Closes dash-0y4").

To get the issues in a new clone, run:

```bash
pnpm setup:beads
```

Dolt does not sign in with a DoltHub API token; it needs a credential key file in `~/.dolt/creds`. When `DOLT_CREDS_KEY_ID` and `DOLT_CREDS_JWK` are set (as they are in cloud sessions), the script writes that file, runs `dolt creds use`, and then clones the issues (or pulls them if this clone already has them). Without those variables it uses whatever key Dolt already has from `dolt login`. After that, `bd ready` lists open work, and `bd dolt push` sends your changes to DoltHub.

## Licence

GPL-2.0-or-later, the same licence as the NCA Toolkit. See [LICENSE](LICENSE).
