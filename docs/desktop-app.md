# The Takewon Desktop App

Takewon in its own window on Mac, Windows and Linux. The app opens your Takewon, hosted or on your own server, and you sign in inside it as you would in a browser. Automations still run on the server (a rented one, or your own machine that stays on); the app is a way in, not a replacement for it.

## What it does today

- **Connect.** The first start asks for the address you sign in to Takewon at. The app checks that a Takewon answers there before opening it, and says plainly when the address is wrong, unreachable or another site.
- **Comes back to it.** The next start opens the same Takewon straight away. **Switch** in the app's menu (Cmd or Ctrl + Shift + K) goes back to the list, which remembers up to ten addresses for people who use more than one.
- **Alerts.** A failed run, an approval waiting for you or a mention shows as a system notification while the window is in the background or hidden. The number of unseen alerts shows on the Dock (Mac) or launcher (Linux) and in the tray icon's tooltip. Clicking a notification brings attention to the app; the alert itself is in the Inbox.
- **The tray.** Closing the window keeps the app running in the tray (the menu bar on a Mac), so alerts keep coming. Click the tray icon to open the window again; **Quit** is in its menu and in the app's menu.
- **Open in your editor.** On a run's **Open in editor**, **Save to this computer** puts the timelines, captions, finished clips and the original recording in one folder (`Videos/Takewon/<automation> <date>`, or Documents or your home folder when there is no Videos folder), so Premiere Pro or DaVinci Resolve finds the media next to the timeline. **Open** opens a timeline in the editor your computer uses for it, and **Show in folder** shows the files. A recording already saved is kept rather than downloaded again; anything that could not be fetched is named, and saving again tries it once more.
- **Big uploads from disk.** On Uploads, **Choose files** opens the computer's own file picker, and the app sends each file straight from disk, so even a file of hundreds of gigabytes never has to fit in the window. A big file goes up in parts, and the app writes down each part the bucket takes. If sending stops (the network drops, the app is quit, the computer sleeps), the upload is listed under Uploads with how far it got; **Carry on** sends only the rest, even after a restart, and **Drop** throws it away. Unfinished parts are kept by the bucket for 7 days. Files dropped onto the page still go the browser way.
- **A folder on this computer as a trigger.** On an automation's **When a file lands in one of your folders** trigger, **Also from a folder on this computer** picks a folder in the computer's own picker. While the app is open (the window can be closed to the tray), each file added there, or in folders inside it such as one per creator, goes up to the trigger's folder in storage once it has stopped changing for 10 seconds, and the trigger starts runs as usual. Files already in the folder are left alone, each file goes up once, and hidden or half-downloaded files are skipped. The runs themselves happen on the server.
- **Run Takewon on this computer.** Under Connect, **Run one on this computer** checks the computer first: processor cores, memory, free disk, and Docker with Compose, running (with how to fix whatever falls short, such as Docker Desktop's memory). Then it takes your bucket, an Anthropic key and the addresses, makes the secrets, and starts the same [`deploy/compose.yml`](../deploy/compose.yml) a server uses: downloading the programs, starting them, making the database's key and setting up the backend with the setup image, then opening the dashboard. Its settings are kept in the app's data folder (`stack/.env`, readable only by you); secrets are made once and never replaced. Automations only run while the computer is on and awake, so an always-on machine, such as a Mac Mini, or a rented server is the better home for a team. Only the app's own screens can run the stack; the dashboard's pages can't.
- **Keeps running.** Once the stack has started on a computer, the app keeps that computer from sleeping and opens when you sign in (in the tray, without its window), so automations keep running overnight. Turn either off from the app's icon in the menu bar or taskbar: **Keep this computer awake** and **Open Takewon when I sign in**. The screen may still turn off, and a laptop with its lid closed still sleeps. In Docker Desktop, keep **Start Docker Desktop when you sign in** on as well.
- **Updates and backups.** Opening **Run one on this computer** again on a computer where it runs shows **On this computer**: **Open it**, **Update** (downloads the newest programs, restarts them and sets up the backend again; settings and data stay) and **Back up now**. While the app is open it also backs up once a day by itself and says so only if that fails; the tray has **Back up now** and **Show backups** too. Each backup is a folder in Documents, `Takewon Backups/<date and time>`, holding the database with its stored files (`database.zip`, a Convex export), the database's own settings (`convex-settings.env`, including the secrets saved keys are locked with), the agent's memory (`agent-memory.tgz`) and the app's settings file (`settings.env`); the newest 14 are kept. Keep that folder somewhere safe: it holds secrets. Videos live in your bucket, so they aren't in it: use your storage provider's versioning. **Bring back a backup** picks one by its time and, after saying what it replaces, backs up what is there now, stops the agent, puts back the database, its settings and the agent's memory, then starts and sets everything up again (a few minutes). Your settings on this computer (bucket, addresses, model key) stay as they are. On a new computer, set it up first, copy the backup into its `Takewon Backups` folder, then bring it back. By hand, see [Backups](self-hosting.md#backups). **Change its settings** opens the settings again.
- **Addresses made with Cloudflare.** Teammates and webhooks need https addresses that reach the computer. With a Cloudflare token (Zone: Read, DNS: Edit and Cloudflare Tunnel: Edit, made at dash.cloudflare.com) the app lists your domains, makes a free Cloudflare Tunnel, routes `name.yourdomain.com` to the dashboard and `name-api`, `name-actions`, `name-agent` and `name-toolkit` to the rest, and starts it with the stack (the `tunnel` service in compose.yml). Nothing is opened on your router. A name your domain already uses for something else is never replaced. The token is used once and not kept; starting again later needs no token. Already have a tunnel or a reverse proxy? Choose **I have my own** and type the five addresses.
- **Links.** Takewon's own pages stay in the window. Other sites open in your browser.

- **Updates itself.** About half a minute after it opens, and every six hours after, the app looks for a newer version, downloads it in the background and checks its signature. It then says once that the new version is ready, and the tray's first item becomes **Restart to update to <version>**. Nothing installs until you choose that; your settings, saved addresses and a copy running on this computer stay as they are.

Addresses use HTTPS. Plain `http://` is allowed only for this computer, a home or office network address (such as `192.168.1.20:3000`) and `.local` names (such as `mac-mini.local:3000`).

## Installing

Each change to the app builds installers on GitHub Actions (the **Desktop app** workflow): `.dmg` for Macs with an Apple chip or Intel, `.msi` and `.exe` for Windows, `.AppImage`, `.deb` and `.rpm` for Linux. Each change merged to main is published as a release, **Desktop app <version>**, on the repository's Releases page: download the installer for your computer there. After that the app keeps itself up to date. (A pull request's builds are under its run's **Artifacts**.)

The builds are not signed yet, so the first open needs one extra step:

- **Mac:** Control-click the app, choose **Open**, then **Open** again.
- **Windows:** on the SmartScreen warning, choose **More info**, then **Run anyway**.
- **Linux:** make the AppImage executable (`chmod +x`), or install the `.deb` or `.rpm`.

## How it works

- The product's name is in one place, `apps/desktop/product.json`. The app's window, menu and Connect screen read it, and a test keeps `productName` in `src-tauri/tauri.conf.json` the same. A rename is a change to those two lines.

- `apps/desktop/src-tauri/` is the app (Rust, [Tauri 2](https://v2.tauri.app)). It uses each system's own web view, so the download is small.
- `apps/desktop/src/` is the Connect screen, the app's only page of its own.
- The web app answers `GET /api/desktop` with `{"app":"ncat-dash"}` (`src/app/api/desktop/route.ts`). That is how the app tells the dashboard from another site; it names the codebase, not the product, so a rename doesn't break it. A self-hosted copy needs a web image from this change or later.
- The dashboard's pages are a remote site inside the window. `capabilities/default.json` covers only the Connect screen (a test keeps it that way). On connecting, the app gives that one dashboard's origin its commands (`notify`, `set_unseen`, `save_export`, `open_export`, `show_export`, `choose_files`, `send_file`, `begin_upload`, `send_part`, `stopped_uploads`, `forget_upload`, `choose_folder`, `watch_folder`, `watched_folders`, `unwatch_folder`, `landed_files`, `landed_sent`), and each checks the caller is the dashboard open now. The dashboard says what to save; the app picks the folder, fetches only web addresses, and opens or shows only files inside its own exports folder (`src-tauri/src/exports.rs`). For uploads the app reads only files chosen in its own picker, or files an upload chosen that way is still sending, and keeps the uploads still going in `uploads.json` in its settings folder (`src-tauri/src/uploads.rs`). Watched folders must be chosen in its folder picker, links inside them are not followed, and they are kept in `watches.json` (`src-tauri/src/watches.rs`); `src/components/app-shell/local-folders.tsx` sends what lands. The web app calls them from `src/lib/desktop.ts`; in a browser those calls do nothing.
- The saved addresses are in `servers.json` in the app's settings folder (for example `~/Library/Application Support/io.otakusolutions.desktop/` on a Mac).

## Releases and updates

The **Desktop app** workflow publishes a release for each change to the app on main. The version is the major and minor number in `src-tauri/tauri.conf.json` plus the workflow's run number (`0.1.57`), so each is newer than the last. The release starts as a draft; each build adds its installers and signed update files, then `scripts/desktop-release.mjs` writes `latest.json` from their signatures and the release becomes the latest. The app reads `https://github.com/<owner>/<repo>/releases/latest/download/latest.json` (`plugins.updater` in `tauri.conf.json`) and installs an update only if its signature matches the public key there.

That key is the app's own update key, separate from Apple's and Microsoft's signing, so updates work while the builds are unsigned. Its private half is the repository secret `TAURI_SIGNING_PRIVATE_KEY` (no password). Without it the builds still run but nothing is published. Lose it and installed copies can't update; a new key means everyone downloads the app once more.

For your own copy of the code: make a key with `pnpm tauri signer generate -w takewon.key` in `apps/desktop`, put the public key and your repository's address in `plugins.updater`, and the private key in your repository's `TAURI_SIGNING_PRIVATE_KEY` secret.

## Working on it

Needs Node 22, pnpm, and Rust. On Linux also `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev`.

```bash
cd apps/desktop
pnpm dev                          # the app, with the Connect screen reloading as you edit
pnpm test                         # the Connect screen and the app's settings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build --debug --no-bundle && pnpm test:e2e   # drives the built app (Linux or Windows)
```

`pnpm test:e2e` drives the real app through `tauri-driver` (`cargo install tauri-driver --locked`). On Linux it also needs `webkit2gtk-driver` and a display (`xvfb-run -a pnpm test:e2e`). On Windows it needs the Edge driver that matches WebView2 (`msedgedriver-tool` fetches it) named in `NATIVE_DRIVER`. CI runs both; Apple has no driver for app web views, so the Mac build is checked by hand. The tests start a stand-in dashboard on this computer, so they need no server.
