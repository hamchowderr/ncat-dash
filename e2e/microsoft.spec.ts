import { expect, test } from "@playwright/test";

import { MICROSOFT, MICROSOFT_USER } from "./microsoft-data.mjs";

// Teams meetings brought in by themselves, in a real browser against a real backend: a
// member connects Microsoft 365 from Settings (the stand-in signs in at once and checks
// the dashboard's address before it watches the OneDrive), brings in a past recording by
// hand, and a recording Teams just saved arrives by itself.

const TOOLKIT = "http://127.0.0.1:8767";
const stamp = Date.now().toString(36);
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 300 },
  });
}

test("connects Microsoft 365, brings a past meeting in, and a new one arrives by itself", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Harbour Organizer");
  await page.locator("#email").fill(`organizer.ms.${stamp}@example.test`);
  await page.locator("#password").fill("microsoft-e2e-password-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill(`Harbour Films ${stamp}`);
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  // Settings > Microsoft 365: connect, and Microsoft sends us back here. Each run signs in
  // as its own account, since one account can be connected to only one team.
  await fetch(`${MICROSOFT}/stand-in/user`, {
    method: "POST",
    body: JSON.stringify({ id: `ms-user-${stamp}` }),
  });
  await page.goto("/settings/microsoft");
  await expect(page.getByRole("heading", { level: 1, name: "Microsoft 365" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Microsoft Teams logo" })).toBeVisible();
  await page.getByRole("button", { name: "Connect Microsoft 365" }).click();
  await expect(page).toHaveURL(/\/settings\/microsoft$/, { timeout: 30_000 });
  await expect(page.getByText("Your Microsoft account is connected")).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Your Microsoft account" })
      .getByText(MICROSOFT_USER.displayName),
  ).toBeVisible();
  await expect(page.getByRole("switch", { name: /Bring in new recordings/ })).toBeChecked();

  // A past recording, brought in by hand.
  await page.getByRole("button", { name: "Show the last 30 days" }).click();
  const past = page.getByRole("region", { name: "Past recordings" });
  await expect(past.getByText("Client Kickoff")).toBeVisible();
  await expect(past.getByText(/37 min/)).toBeVisible();
  await past.getByRole("button", { name: "Bring in" }).click();
  await expect(page.getByText("Client Kickoff is on its way to Uploads")).toBeVisible();
  const brought = page.getByRole("region", { name: "Brought in from Teams" });
  await expect(brought.getByRole("link", { name: "In Uploads" })).toBeVisible({ timeout: 30_000 });

  // Teams saves a new recording, Microsoft tells the watch, and it comes in by itself.
  let told = 0;
  for (let attempt = 0; attempt < 20 && told === 0; attempt++) {
    const answer = await fetch(`${MICROSOFT}/stand-in/recording`, {
      method: "POST",
      body: JSON.stringify({ id: `new-${stamp}-${attempt}`, topic: "Weekly Sync" }),
    });
    told = ((await answer.json()) as { watches: number }).watches;
    if (told === 0) await page.waitForTimeout(500);
  }
  expect(told).toBeGreaterThan(0);
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
