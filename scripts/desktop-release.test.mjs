import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { manifest, platformOf, signaturesIn } from "./desktop-release.mjs";

const BASE = "https://github.com/me/app/releases/download/desktop-v0.1.42";

test("knows each system's update file by its name", () => {
  assert.equal(platformOf("Takewon_0.1.42_aarch64.app.tar.gz"), "darwin-aarch64-app");
  assert.equal(platformOf("Takewon_0.1.42_x64.app.tar.gz"), "darwin-x86_64-app");
  assert.equal(platformOf("Takewon_0.1.42_x64-setup.exe"), "windows-x86_64-nsis");
  assert.equal(platformOf("Takewon_0.1.42_x64_en-US.msi"), "windows-x86_64-msi");
  assert.equal(platformOf("Takewon_0.1.42_amd64.AppImage"), "linux-x86_64-appimage");
  assert.equal(platformOf("Takewon_0.1.42_amd64.deb"), "linux-x86_64-deb");
  assert.equal(platformOf("Takewon-0.1.42-1.x86_64.rpm"), "linux-x86_64-rpm");
  // An installer that isn't an update file, and a Mac file of no known chip.
  assert.equal(platformOf("Takewon_0.1.42_aarch64.dmg"), null);
  assert.equal(platformOf("Takewon.app.tar.gz"), null);
});

test("lists each update with its signature and download address", () => {
  const feed = manifest({
    version: "0.1.42",
    notes: "Version 0.1.42.",
    pubDate: "2026-11-22T17:00:00.000Z",
    base: BASE + "/",
    signatures: {
      "Takewon_0.1.42_aarch64.app.tar.gz": "sig-mac\n",
      "Takewon_0.1.42_x64-setup.exe": "sig-nsis",
      "Takewon_0.1.42_x64_en-US.msi": "sig-msi",
      "Takewon_0.1.42_amd64.AppImage": "sig-appimage",
      "Takewon_0.1.42_amd64.deb": "sig-deb",
      "notes.txt": "not an update",
    },
  });
  assert.equal(feed.version, "0.1.42");
  assert.equal(feed.pub_date, "2026-11-22T17:00:00.000Z");
  assert.deepEqual(feed.platforms["darwin-aarch64-app"], {
    signature: "sig-mac",
    url: `${BASE}/Takewon_0.1.42_aarch64.app.tar.gz`,
  });
  assert.equal(feed.platforms["windows-x86_64-msi"].signature, "sig-msi");
  assert.equal(feed.platforms["linux-x86_64-deb"].signature, "sig-deb");
  // Each system's main installer also answers for the system as a whole.
  assert.equal(feed.platforms["darwin-aarch64"].signature, "sig-mac");
  assert.equal(feed.platforms["windows-x86_64"].signature, "sig-nsis");
  assert.equal(feed.platforms["linux-x86_64"].signature, "sig-appimage");
  assert.equal(Object.keys(feed.platforms).length, 8);
});

test("refuses to write a feed with nothing in it", () => {
  assert.throws(
    () => manifest({ version: "1", notes: "", pubDate: "", base: BASE, signatures: {} }),
    /No signed update files/,
  );
});

test("reads the signatures in a release's folder", () => {
  const folder = mkdtempSync(join(tmpdir(), "release-"));
  writeFileSync(join(folder, "Takewon_0.1.42_x64-setup.exe.sig"), "sig-nsis");
  writeFileSync(join(folder, "Takewon_0.1.42_aarch64.dmg"), "installer");
  writeFileSync(join(folder, "something.sig"), "not ours");
  assert.deepEqual(signaturesIn(folder), { "Takewon_0.1.42_x64-setup.exe": "sig-nsis" });
});
