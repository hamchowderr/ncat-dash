import fs from "node:fs";

import { expect, test } from "./test";

// Copying a look in a real browser: a video goes up, its look is copied right on it (a real
// FFmpeg sheet of frames, and the agent's answer played back from a real model), the look
// is saved, and the Match A Saved Look step puts another video into it with plain FFmpeg.
//
// For a screen recording on real footage, set RECORD_VIDEO=1, STAND_IN_CLIP and
// STAND_IN_PLAIN (see e2e/stand-ins.mjs) and LOOK_SAMPLE to the sample's path.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";
const FILES = "http://127.0.0.1:8766";
const SAMPLE = process.env.LOOK_SAMPLE ?? null;
const SAMPLE_NAME = SAMPLE ? SAMPLE.split("/").pop()! : "Crew interview reel.webm";
// What the Library calls it: the name without its extension.
const SAMPLE_TITLE = SAMPLE_NAME.replace(/\.[a-z0-9]{1,5}$/i, "")
  .replace(/_+/g, " ")
  .trim();
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 200 },
  });
}
const pause = (ms: number) =>
  process.env.RECORD_VIDEO === "1" ? new Promise((done) => setTimeout(done, ms)) : null;

test("a look is copied from a video once, then any video is put into it", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/sign-up");
  await page.locator("#name").fill("Noor Haddad");
  await page.locator("#email").fill(`noor.${stamp}@example.test`);
  await page.locator("#password").fill("looks-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Haddad Studio");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();

  // The video whose look the team likes.
  await page.goto("/library");
  await page.getByLabel("Choose files to upload").setInputFiles(
    SAMPLE
      ? SAMPLE
      : {
          name: SAMPLE_NAME,
          mimeType: "video/webm",
          buffer: fs.readFileSync("e2e/fixtures/clip.webm"),
        },
  );
  const opened = page.getByLabel(
    new RegExp(`^Open V\\d+ ${SAMPLE_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
  );
  await expect(opened).toBeVisible({ timeout: 120_000 });
  await pause(1500);

  // The look is copied right on the video's page.
  await opened.click();
  await expect(page).toHaveURL(/\/library\/[a-z0-9]+$/);
  await pause(2000);
  // The video's size is read just after it goes up; until then the study says to wait.
  await expect(async () => {
    await page.getByRole("button", { name: "Copy its look" }).click();
    await expect(page.locator("[data-look-study]")).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 60_000 });
  await pause(1500);
  await expect(page.locator("[data-look-study='ready']")).toBeVisible({ timeout: 180_000 });
  const sheet = page.getByRole("img", { name: `Six frames from ${SAMPLE_NAME}` });
  await expect(sheet).toBeVisible();
  await sheet.scrollIntoViewIfNeeded();
  await expect(page.getByText(/^Vertical, /)).toBeVisible();
  await pause(5000);

  await page.locator("#look-name").fill("Crew Interview");
  const forShape = page.getByLabel(/Use its captions for every/);
  if (await forShape.count()) await forShape.click();
  await pause(1200);
  await page.getByRole("button", { name: "Save look" }).click();
  await expect(page.getByText('Saved "Crew Interview"')).toBeVisible();
  await pause(2500);

  // Any video, into the saved look, with plain FFmpeg.
  await page.goto("/steps/recipe-saved-look");
  await page.locator("#field-video_url").fill(`${FILES}/plain-interview.mp4`);
  await pause(800);
  await expect(page.getByLabel("Look")).toContainText("Your first look (Crew Interview)");
  await expect(page.getByText(`Copied from ${SAMPLE_NAME}.`)).toBeVisible();
  await page.getByLabel("Look").click();
  await page.getByRole("option", { name: "Crew Interview", exact: true }).click();
  await pause(800);
  await page.getByRole("button", { name: "Run step" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("video")).toBeVisible();
  await pause(6000);
});
