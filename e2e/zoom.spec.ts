import { createHmac } from "node:crypto";

import { expect, test } from "@playwright/test";

import { meeting, ZOOM, ZOOM_USER } from "./zoom-data.mjs";
import { ZOOM_WEBHOOK_SECRET } from "./zoom-shared";

// Zoom meetings brought in by themselves, in a real browser against a real backend: a
// member connects Zoom from Settings (the stand-in Zoom signs in at once), brings in a
// past recording by hand, and a meeting Zoom says just finished arrives by itself.

const TOOLKIT = "http://127.0.0.1:8767";
const EVENTS = "http://127.0.0.1:3211/zoom/events";
const stamp = Date.now().toString(36);
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 300 },
  });
}

/** Sends an event the way Zoom sends it, signed with the app's secret token. */
async function zoomSays(event: unknown) {
  const body = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${createHmac("sha256", ZOOM_WEBHOOK_SECRET)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex")}`;
  return await fetch(EVENTS, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zm-request-timestamp": timestamp,
      "x-zm-signature": signature,
    },
    body,
  });
}

test("connects Zoom, brings a past meeting in, and a finished one arrives by itself", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Harbour Host");
  await page.locator("#email").fill(`host.zoom.${stamp}@example.test`);
  await page.locator("#password").fill("zoom-e2e-password-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill(`Harbour Films ${stamp}`);
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  // Settings > Zoom: connect, and Zoom sends us back here. Each run signs in to Zoom as
  // its own account, since one Zoom account can be connected to only one team.
  const zoomUser = { id: `zoom-user-${stamp}`, account_id: `zoom-account-${stamp}` };
  await fetch(`${ZOOM}/stand-in/user`, { method: "POST", body: JSON.stringify(zoomUser) });
  await page.goto("/settings/zoom");
  await expect(page.getByRole("heading", { level: 1, name: "Zoom" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Zoom logo" })).toBeVisible();
  await page.getByRole("button", { name: "Connect Zoom" }).click();
  await expect(page).toHaveURL(/\/settings\/zoom$/, { timeout: 30_000 });
  await expect(page.getByText("Your Zoom is connected")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Your Zoom" }).getByText(ZOOM_USER.display_name),
  ).toBeVisible();
  await expect(page.getByRole("switch", { name: /Bring in new recordings/ })).toBeChecked();

  // A past recording, brought in by hand.
  await page.getByRole("button", { name: "Show the last 30 days" }).click();
  const past = page.getByRole("region", { name: "Past recordings" });
  await expect(past.getByText("Client Kickoff")).toBeVisible();
  await expect(past.getByText(/37 min/)).toBeVisible();
  await past.getByRole("button", { name: "Bring in" }).click();
  await expect(page.getByText("Client Kickoff is on its way to Uploads")).toBeVisible();
  const brought = page.getByRole("region", { name: "Brought in from Zoom" });
  await expect(brought.getByRole("link", { name: "In Uploads" })).toBeVisible({ timeout: 30_000 });

  // A meeting Zoom says just finished comes in by itself.
  const finished = meeting(`just-finished-${stamp}==`, "Weekly Sync", zoomUser.id);
  const answer = await zoomSays({
    event: "recording.completed",
    event_ts: Date.now(),
    download_token: "stand-in-download-token",
    payload: { account_id: zoomUser.account_id, object: finished },
  });
  expect(answer.status).toBe(204);
  await expect(brought.getByText("Weekly Sync")).toBeVisible();

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
