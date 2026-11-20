import { expect, test } from "./test";

import { DROPBOX, DROPBOX_ACCOUNT } from "./dropbox-data.mjs";

// Dropbox both ways, in a real browser against a real backend: a member connects Dropbox
// from Settings (the stand-in signs in at once), the dashboard reads the whole Dropbox and
// lists the folders with media, three are ticked and brought in with one press (one a team
// folder), and a file dropped into a watched folder arrives by itself. Then an automation is switched to send its finished files to Dropbox.

const TOOLKIT = "http://127.0.0.1:8767";
const stamp = Date.now().toString(36);
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 300 },
  });
}

test("connects Dropbox, ticks folders to bring in, and sends clips back", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Harbour Editor");
  await page.locator("#email").fill(`editor.dropbox.${stamp}@example.test`);
  await page.locator("#password").fill("dropbox-e2e-password-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill(`Harbour Films ${stamp}`);
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  // Settings > Dropbox: connect, and Dropbox sends us back here. Each run signs in as its
  // own account, since one Dropbox can be connected to only one team.
  await fetch(`${DROPBOX}/stand-in/account`, {
    method: "POST",
    body: JSON.stringify({ account_id: `dbid:${stamp}` }),
  });
  await page.goto("/settings/dropbox");
  await expect(page.getByRole("heading", { level: 1, name: "Dropbox" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Dropbox logo" })).toBeVisible();
  await page.getByRole("button", { name: "Connect Dropbox" }).click();
  await expect(page).toHaveURL(/\/settings\/dropbox$/, { timeout: 30_000 });
  await expect(page.getByText(/Your Dropbox is connected/)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Your Dropbox" }).getByText(DROPBOX_ACCOUNT.name.display_name),
  ).toBeVisible();

  // The whole Dropbox is read and the folders with media are listed, team folders too.
  // Tick three and bring them in with one press: what is there comes over, the PDF does not.
  const folders = page.getByRole("region", { name: "Folders with media" });
  await expect(folders.getByText("Team folders are included.", { exact: false })).toBeVisible();
  await folders.getByRole("checkbox", { name: "Bring in /Raw footage", exact: true }).click();
  await folders.getByRole("checkbox", { name: "Bring in /Raw footage/Day 1" }).click();
  await folders.getByRole("checkbox", { name: "Bring in /Marketing" }).click();
  await expect(folders.getByText("3 folders ticked")).toBeVisible();
  await folders.getByRole("button", { name: "Bring in 3 folders" }).click();
  await expect(page.getByText("3 files on the way to Uploads")).toBeVisible({ timeout: 30_000 });
  await expect(folders.getByText("Watching")).toHaveCount(3);
  const brought = page.getByRole("region", { name: "Brought in from Dropbox" });
  await expect(brought.getByRole("link", { name: "In Uploads" }).first()).toBeVisible({
    timeout: 30_000,
  });

  // Someone drops a new file into the team folder; Dropbox tells us and it comes in.
  const told = await fetch(`${DROPBOX}/stand-in/file`, {
    method: "POST",
    body: JSON.stringify({ path: "/Marketing/Launch teaser.mp4", size: 30_000_000 }),
  });
  expect(((await told.json()) as { told: number }).told).toBe(200);
  await expect(brought.getByText("Launch teaser.mp4")).toBeVisible({ timeout: 30_000 });

  await page.goto("/uploads");
  const uploads = page.getByRole("region", { name: "Your uploads" });
  for (const name of ["Interview.mov", "Voiceover.wav", "Logo.png", "Launch teaser.mp4"]) {
    await expect(uploads.getByText(name)).toBeVisible({ timeout: 30_000 });
  }

  // An automation switched to send its finished files to Dropbox, into a folder picked here.
  await page.goto("/automations/new");
  await page.getByRole("button", { name: /Vertical and captioned from a watched folder/ }).click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  const send = page.getByRole("switch", { name: "Send finished files to Dropbox" });
  await expect(send).not.toBeChecked();
  await send.click();
  await expect(send).toBeChecked();
  await page.getByRole("button", { name: /^\/Kontifi\// }).click();
  const folder = page.getByRole("textbox", { name: "Dropbox folder for finished files" });
  await folder.fill("/Marketing/Shorts");
  await folder.press("Enter");
  await expect(page.getByRole("button", { name: "/Marketing/Shorts" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Send finished files to Dropbox" })).toBeChecked();
  await expect(page.getByRole("button", { name: "/Marketing/Shorts" })).toBeVisible();
  await page.waitForTimeout(1500);
});
