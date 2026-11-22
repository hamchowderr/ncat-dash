# The Takewon Desktop App

Takewon in its own window on Mac, Windows and Linux. The app opens your Takewon, hosted or on your own server, and you sign in inside it as you would in a browser. Automations still run on the server (a rented one, or your own machine that stays on); the app is a way in, not a replacement for it.

## What it does today

- **Connect.** The first start asks for the address you sign in to Takewon at. The app checks that a Takewon answers there before opening it, and says plainly when the address is wrong, unreachable or another site.
- **Comes back to it.** The next start opens the same Takewon straight away. **Switch** in the app's menu (Cmd or Ctrl + Shift + K) goes back to the list, which remembers up to ten addresses for people who use more than one.
- **Alerts.** A failed run, an approval waiting for you or a mention shows as a system notification while the window is in the background or hidden. The number of unseen alerts shows on the Dock (Mac) or launcher (Linux) and in the tray icon's tooltip. Clicking a notification brings attention to the app; the alert itself is in the Inbox.
- **The tray.** Closing the window keeps the app running in the tray (the menu bar on a Mac), so alerts keep coming. Click the tray icon to open the window again; **Quit** is in its menu and in the app's menu.
- **Links.** Takewon's own pages stay in the window. Other sites open in your browser.

Addresses use HTTPS. Plain `http://` is allowed only for this computer, a home or office network address (such as `192.168.1.20:3000`) and `.local` names (such as `mac-mini.local:3000`).

Coming next, in this order: Open in your editor saved straight to disk, big uploads from disk, and a folder on this computer as a trigger. After that, setting up and running a self-hosted Takewon on an always-on machine from the app.

## Installing

Each change to the app builds installers on GitHub Actions (the **Desktop app** workflow): `.dmg` for Macs with an Apple chip or Intel, `.msi` and `.exe` for Windows, `.AppImage`, `.deb` and `.rpm` for Linux. Open a run and download from its **Artifacts**.

The builds are not signed yet, so the first open needs one extra step:

- **Mac:** Control-click the app, choose **Open**, then **Open** again.
- **Windows:** on the SmartScreen warning, choose **More info**, then **Run anyway**.
- **Linux:** make the AppImage executable (`chmod +x`), or install the `.deb` or `.rpm`.

## How it works

- The product's name is in one place, `apps/desktop/product.json`. The app's window, menu and Connect screen read it, and a test keeps `productName` in `src-tauri/tauri.conf.json` the same. A rename is a change to those two lines.

- `apps/desktop/src-tauri/` is the app (Rust, [Tauri 2](https://v2.tauri.app)). It uses each system's own web view, so the download is small.
- `apps/desktop/src/` is the Connect screen, the app's only page of its own.
- The web app answers `GET /api/desktop` with `{"app":"ncat-dash"}` (`src/app/api/desktop/route.ts`). That is how the app tells the dashboard from another site; it names the codebase, not the product, so a rename doesn't break it. A self-hosted copy needs a web image from this change or later.
- The dashboard's pages are a remote site inside the window. `capabilities/default.json` covers only the Connect screen (a test keeps it that way). On connecting, the app gives that one dashboard's origin two commands, `notify` and `set_unseen`, and each checks the caller is the dashboard open now. The web app calls them from `src/lib/desktop.ts`; in a browser those calls do nothing.
- The saved addresses are in `servers.json` in the app's settings folder (for example `~/Library/Application Support/io.otakusolutions.desktop/` on a Mac).

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
