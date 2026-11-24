import { expect, test } from "./test";

// Clips say which platform they were made for, in a real browser against a real local
// backend and the stand-in toolkit (real FFmpeg): a team that posts on TikTok makes an
// automation with Clips for a platform for TikTok and uploads a recording; the clip it
// makes is named for TikTok and tagged "Made for TikTok" on the run page, in Files and in the Library.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";
// Set to a folder to keep screenshots of each place, as sent with the pull request.
const SHOTS = process.env.PLATFORM_SHOTS;

test("a clip cut for TikTok says so everywhere it shows", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rae Kim");
  await page.locator("#email").fill(`rae.${stamp}@example.test`);
  await page.locator("#password").fill("platforms-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Kim Talks");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();

  // Clips for TikTok, switched on, started by an upload.
  await page.goto("/automations");
  await page.getByRole("link", { name: "New automation", exact: true }).click();
  await page.getByRole("button", { name: "Empty canvas" }).first().click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  await page.getByLabel("Automation name").fill("TikTok clips");
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Search steps").fill("Clips for a platform");
  await page
    .getByRole("complementary", { name: "Steps you can add" })
    .getByRole("button", { name: "Clips for a platform", exact: true })
    .click();
  await page
    .getByRole("radiogroup", { name: "Platform" })
    .getByRole("radio", { name: /^TikTok,/ })
    .click();
  await page.locator(".react-flow__node-trigger").click();
  await page.getByRole("combobox", { name: "What starts it" }).click();
  await page.getByRole("option", { name: "New upload", exact: true }).click();
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  await page.locator("#automation-on").click();
  await expect(page.getByText("On", { exact: true })).toBeVisible();
  const automation = page.url();

  await page.goto("/uploads");
  await page.getByLabel("Choose files to upload").setInputFiles("e2e/fixtures/clip.webm");
  await expect(page.getByRole("button", { name: "Open clip.webm" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto(automation);
  await page.getByRole("tab", { name: /Runs/ }).click();
  const run = page.getByRole("link", { name: /^View run/ }).first();
  await expect(run).toBeVisible({ timeout: 60_000 });

  // The run page: the clip is named for TikTok and tagged with it, as a tile and played larger.
  await run.click();
  await expect(page).toHaveURL(/\/runs\//);
  const tiles = page.getByRole("list", { name: "Files from Clips for a platform" });
  const tile = tiles.getByRole("button", { name: /Clip TikTok clip/ }).first();
  await expect(tile).toBeVisible({ timeout: 120_000 });
  await expect(tile.getByTitle("Made for TikTok")).toBeVisible();
  if (SHOTS) {
    await tiles.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/Run Page.png` });
  }
  await tile.click();
  const played = page.getByRole("dialog").getByRole("figure");
  await expect(played.getByTitle("Made for TikTok")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/Run Page Clip.png` });
  await page.keyboard.press("Escape");

  // Files: the finished clip, in its own folder, with the platform beside it.
  await page.goto("/files");
  await page.getByRole("button", { name: "Finished", exact: true }).click({ timeout: 60_000 });
  await page.getByRole("button", { name: "TikTok clips", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "Clip TikTok clip" }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByTitle("Made for TikTok")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Platforms" })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/Files.png` });

  // Library: the clip carries the tag too; the upload does not.
  await page.goto("/library");
  const libraryTile = page
    .getByTestId("library-tile")
    .filter({ hasText: "Clip TikTok clip" })
    .first();
  await expect(libraryTile.getByTitle("Made for TikTok")).toBeVisible({ timeout: 30_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/Library.png` });
  await libraryTile.getByRole("link").first().click();
  await expect(page.getByText("Made for", { exact: true })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/Library File.png` });
});
