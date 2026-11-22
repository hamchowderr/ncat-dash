// Writes latest.json, the feed the desktop app checks for updates
// (apps/desktop/src-tauri/tauri.conf.json, plugins.updater). For each signed update file in
// a folder (the file and its .sig, as the release holds them) it lists where to download it
// and its signature, under the platform key the updater looks for: `{os}-{arch}-{installer}`,
// then `{os}-{arch}` for the main installer of each system.
//
//   node scripts/desktop-release.mjs <folder> <version> <release download address>
//
// .github/workflows/desktop.yml runs it once every build has added its files to the release.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The updater's key for an update file, by its name, or null for anything else. */
export function platformOf(file) {
  if (file.endsWith(".app.tar.gz")) {
    if (/_(aarch64|arm64)\.app\.tar\.gz$/.test(file)) return "darwin-aarch64-app";
    if (/_(x64|x86_64)\.app\.tar\.gz$/.test(file)) return "darwin-x86_64-app";
    return null;
  }
  if (file.endsWith("-setup.exe")) return "windows-x86_64-nsis";
  if (file.endsWith(".msi")) return "windows-x86_64-msi";
  if (file.endsWith(".AppImage")) return "linux-x86_64-appimage";
  if (file.endsWith(".deb")) return "linux-x86_64-deb";
  if (file.endsWith(".rpm")) return "linux-x86_64-rpm";
  return null;
}

/** Which installer answers for a system when the app can't tell how it was installed. */
const MAIN = {
  "darwin-aarch64-app": "darwin-aarch64",
  "darwin-x86_64-app": "darwin-x86_64",
  "windows-x86_64-nsis": "windows-x86_64",
  "linux-x86_64-appimage": "linux-x86_64",
};

/**
 * The feed for `version`. `signatures` maps each update file's name to its signature (the
 * text of its .sig); `base` is the address the release's files download from.
 */
export function manifest({ version, notes, pubDate, base, signatures }) {
  const platforms = {};
  for (const [file, signature] of Object.entries(signatures).sort()) {
    const key = platformOf(file);
    if (!key) continue;
    const entry = {
      signature: signature.trim(),
      url: `${base.replace(/\/$/, "")}/${encodeURIComponent(file)}`,
    };
    platforms[key] = entry;
    if (MAIN[key]) platforms[MAIN[key]] = entry;
  }
  if (Object.keys(platforms).length === 0) {
    throw new Error("No signed update files were found, so there is nothing to update to.");
  }
  return { version, notes, pub_date: pubDate, platforms };
}

/** Reads each update file's `<file>.sig` in `folder` (the files themselves need not be there). */
export function signaturesIn(folder) {
  const signatures = {};
  for (const name of readdirSync(folder)) {
    const file = name.slice(0, -".sig".length);
    if (name.endsWith(".sig") && platformOf(file)) {
      signatures[file] = readFileSync(join(folder, name), "utf8");
    }
  }
  return signatures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [folder, version, base] = process.argv.slice(2);
  if (!folder || !version || !base) {
    console.error("Use: node scripts/desktop-release.mjs <folder> <version> <download address>");
    process.exit(1);
  }
  const feed = manifest({
    version,
    notes: `Version ${version}.`,
    pubDate: new Date().toISOString(),
    base,
    signatures: signaturesIn(folder),
  });
  writeFileSync(join(folder, "latest.json"), JSON.stringify(feed, null, 2) + "\n");
  console.log(`latest.json lists ${Object.keys(feed.platforms).join(", ")}`);
}
