# The Kontifi Desktop App

Kontifi in its own window on Mac, Windows and Linux. The app opens your Kontifi, hosted or on your own server, and you sign in inside it as you would in a browser. Automations still run on the server (a rented one, or your own machine that stays on); the app is a way in, not a replacement for it.

## What it does today

- **Connect.** The first start asks for the address you sign in to Kontifi at. The app checks that a Kontifi answers there before opening it, and says plainly when the address is wrong, unreachable or another site.
- **Comes back to it.** The next start opens the same Kontifi straight away. **Kontifi, Switch Kontifi…** (Cmd or Ctrl + Shift + K) goes back to the list, which remembers up to ten addresses for people who use more than one.
- **Links.** Kontifi's own pages stay in the window. Other sites open in your browser.

Addresses use HTTPS. Plain `http://` is allowed only for this computer, a home or office network address (such as `192.168.1.20:3000`) and `.local` names (such as `mac-mini.local:3000`).

Coming next, in this order: alerts and a tray badge for waiting reviews and failed runs, Open in your editor saved straight to disk, big uploads from disk, and a folder on this computer as a trigger. After that, setting up and running a self-hosted Kontifi on an always-on machine from the app.

## Installing

Each change to the app builds installers on GitHub Actions (the **Desktop app** workflow): `.dmg` for Macs with an Apple chip or Intel, `.msi` and `.exe` for Windows, `.AppImage`, `.deb` and `.rpm` for Linux. Open a run and download from its **Artifacts**.

The builds are not signed yet, so the first open needs one extra step:

- **Mac:** Control-click the app, choose **Open**, then **Open** again.
- **Windows:** on the SmartScreen warning, choose **More info**, then **Run anyway**.
- **Linux:** make the AppImage executable (`chmod +x`), or install the `.deb` or `.rpm`.

## How it works

- `apps/desktop/src-tauri/` is the app (Rust, [Tauri 2](https://v2.tauri.app)). It uses each system's own web view, so the download is small.
- `apps/desktop/src/` is the Connect screen, the app's only page of its own.
- The web app answers `GET /api/kontifi` with `{"app":"kontifi"}` (`src/app/api/kontifi/route.ts`). That is how the app tells a Kontifi from another site. A self-hosted copy needs a web image from this change or later.
- Kontifi's pages are a remote site inside the window, so they get no access to the app's commands. `capabilities/default.json` covers only the Connect screen; a test keeps it that way.
- The saved addresses are in `kontifis.json` in the app's settings folder (for example `~/Library/Application Support/io.otakusolutions.kontifi/` on a Mac).

## Working on it

Needs Node 22, pnpm, and Rust. On Linux also `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev`.

```bash
cd apps/desktop
pnpm dev                          # the app, with the Connect screen reloading as you edit
pnpm test                         # the Connect screen and the app's settings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build --debug --no-bundle && pnpm test:e2e   # drives the built app (Linux or Windows)
```

`pnpm test:e2e` drives the real app through `tauri-driver` (`cargo install tauri-driver --locked`). On Linux it also needs `webkit2gtk-driver` and a display (`xvfb-run -a pnpm test:e2e`). The tests start a stand-in Kontifi on this computer, so they need no server.
