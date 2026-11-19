import { execSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { GOOGLE, GOOGLE_USER } from "./google-meet-data.mjs";

// Google Meet recordings brought in by themselves, in a real browser against a real
// backend: a member connects Google from Settings (the stand-in Google signs in at once),
// finds every past recording and brings them over at once, and a meeting that just ended
// arrives at the next check by itself.

const TOOLKIT = "http://127.0.0.1:8767";
const stamp = Date.now().toString(36);
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 300 },
  });
}

test("connects Google Meet, brings past meetings over at once, and a finished one arrives by itself", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Harbour Host");
  await page.locator("#email").fill(`host.meet.${stamp}@example.test`);
  await page.locator("#password").fill("meet-e2e-password-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill(`Harbour Films ${stamp}`);
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  // Settings > Google Meet: connect, and Google sends us back here. Each run signs in as
  // its own account, since one Google account can be connected to only one team.
  await fetch(`${GOOGLE}/stand-in/user`, {
    method: "POST",
    body: JSON.stringify({ sub: `google-user-${stamp}` }),
  });
  await page.goto("/settings/google-meet");
  await expect(page.getByRole("heading", { level: 1, name: "Google Meet" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Google Meet logo" })).toBeVisible();
  await page.getByRole("button", { name: "Connect Google Meet" }).click();
  await expect(page).toHaveURL(/\/settings\/google-meet$/, { timeout: 30_000 });
  await expect(page.getByText("Your Google Meet is connected")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Your Google account" }).getByText(GOOGLE_USER.name),
  ).toBeVisible();
  await expect(page.getByRole("switch", { name: /Bring in new recordings/ })).toBeChecked();
  // Recordings others share can come in by themselves too; off until switched on.
  const shared = page.getByRole("switch", { name: /recordings shared with you/ });
  await expect(shared).not.toBeChecked();
  await shared.click();
  await expect(shared).toBeChecked();

  // A past recording, brought in by hand.
  // Every past recording found at once: the recent one, and one from over a year ago that
  // only Drive still has. Both are picked; one press brings them over.
  await page.getByRole("button", { name: "Find recordings" }).click();
  const past = page.getByRole("region", { name: "Past recordings" });
  await expect(past.getByText("3 recordings in your Drive. 3 not in Uploads yet.")).toBeVisible();
  await expect(past.getByText("Client Kickoff")).toBeVisible();
  await expect(past.getByText(/37 min/)).toBeVisible();
  await expect(past.getByText("Annual Review")).toBeVisible();
  await expect(past.getByText(/52 min/)).toBeVisible();
  // One someone else organized and shared says who shared it.
  await expect(past.getByText("Partner Sync")).toBeVisible();
  await expect(past.getByText(/shared by Pat Rivera/)).toBeVisible();
  await expect(past.getByText("All 3 picked")).toBeVisible();
  await past.getByRole("button", { name: "Bring over 3 recordings" }).click();
  await expect(page.getByText("3 recordings on the way to Uploads")).toBeVisible();
  await expect(
    past.getByText("3 recordings in your Drive. All of them are in Uploads."),
  ).toBeVisible();
  const brought = page.getByRole("region", { name: "Brought in from Google Meet" });
  await expect(brought.getByRole("link", { name: "In Uploads" })).toHaveCount(3, {
    timeout: 60_000,
  });

  // A meeting that just ended comes in at the next check (every few minutes; run now).
  await fetch(`${GOOGLE}/stand-in/meeting`, {
    method: "POST",
    body: JSON.stringify({ id: `just-ended-${stamp}`, title: "Weekly Sync" }),
  });
  execSync("npx convex run googleMeet:checkAll", { stdio: "pipe" });
  await expect(brought.getByText("Weekly Sync")).toBeVisible({ timeout: 30_000 });

  // Both are uploads now, named after the meeting and its day.
  await page.goto("/uploads");
  const uploads = page.getByRole("region", { name: "Your uploads" });
  await expect(uploads.getByText(/^Partner Sync \d{4}-\d{2}-\d{2}\.mp4$/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(uploads.getByText(/^Annual Review \d{4}-\d{2}-\d{2}\.mp4$/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(uploads.getByText(/^Client Kickoff \d{4}-\d{2}-\d{2}\.mp4$/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(uploads.getByText(/^Weekly Sync \d{4}-\d{2}-\d{2}\.mp4$/)).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(1500);
});
