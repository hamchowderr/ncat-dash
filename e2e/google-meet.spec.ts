import { execSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { GOOGLE, GOOGLE_USER } from "./google-meet-data.mjs";

// Google Meet recordings brought in by themselves, in a real browser against a real
// backend: a member connects Google from Settings (the stand-in Google signs in at once),
// brings in a past recording by hand, and a meeting that just ended arrives at the next
// check by itself.

const TOOLKIT = "http://127.0.0.1:8767";
const stamp = Date.now().toString(36);
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 300 },
  });
}

test("connects Google Meet, brings a past meeting in, and a finished one arrives by itself", async ({
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

  // A past recording, brought in by hand.
  await page.getByRole("button", { name: "Show recordings" }).click();
  const past = page.getByRole("region", { name: "Past recordings" });
  await expect(past.getByText("Client Kickoff")).toBeVisible();
  await expect(past.getByText(/37 min/)).toBeVisible();
  // Drive keeps recordings long after Meet forgets the meeting: those show too.
  await expect(past.getByText("Annual Review")).toBeVisible();
  await expect(past.getByText(/52 min/)).toBeVisible();
  await past
    .getByRole("listitem")
    .filter({ hasText: "Client Kickoff" })
    .getByRole("button", { name: "Bring in" })
    .click();
  await expect(page.getByText("Client Kickoff is on its way to Uploads")).toBeVisible();
  const brought = page.getByRole("region", { name: "Brought in from Google Meet" });
  await expect(brought.getByRole("link", { name: "In Uploads" })).toBeVisible({ timeout: 30_000 });

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
  await expect(uploads.getByText(/^Client Kickoff \d{4}-\d{2}-\d{2}\.mp4$/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(uploads.getByText(/^Weekly Sync \d{4}-\d{2}-\d{2}\.mp4$/)).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(1500);
});
