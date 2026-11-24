import { createHmac } from "node:crypto";

import { expect, test } from "./test";

import { meeting, ZOOM, ZOOM_USER } from "./zoom-data.mjs";
import { ZOOM_ACCOUNT_WEBHOOK_SECRET, ZOOM_WEBHOOK_SECRET } from "./zoom-shared";

// Zoom meetings brought in by themselves, in a real browser against a real backend: a
// member connects Zoom from Settings (the stand-in Zoom signs in at once), brings in a
// past recording by hand, and a meeting Zoom says just finished arrives by itself.

const TOOLKIT = "http://127.0.0.1:8767";
const EVENTS = "http://127.0.0.1:3211/zoom/events";
const ACCOUNT_EVENTS = "http://127.0.0.1:3211/zoom/account-events";
const stamp = Date.now().toString(36);
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 300 },
  });
}

/**
 * Sends an event the way Zoom sends it, signed with the app's secret token: the
 * per-person app's, or with wholeAccount the admin-managed app's, to its own address.
 */
async function zoomSays(event: unknown, wholeAccount = false) {
  const body = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = wholeAccount ? ZOOM_ACCOUNT_WEBHOOK_SECRET : ZOOM_WEBHOOK_SECRET;
  const signature = `v0=${createHmac("sha256", secret)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex")}`;
  return await fetch(wholeAccount ? ACCOUNT_EVENTS : EVENTS, {
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
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();

  // Settings > Zoom: connect, and Zoom sends us back here. Each run signs in to Zoom as
  // its own account, since one Zoom account can be connected to only one team.
  const zoomUser = { id: `zoom-user-${stamp}`, account_id: `zoom-account-${stamp}` };
  await fetch(`${ZOOM}/stand-in/user`, { method: "POST", body: JSON.stringify(zoomUser) });
  await page.goto("/settings/integrations/zoom");
  await expect(page.getByRole("heading", { level: 1, name: "Zoom" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Zoom logo" })).toBeVisible();
  await page.getByRole("button", { name: "Connect Zoom" }).click();
  await expect(page).toHaveURL(/\/settings\/integrations\/zoom$/, { timeout: 30_000 });
  await expect(page.getByText("Your Zoom is connected")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Your Zoom" }).getByText(ZOOM_USER.display_name),
  ).toBeVisible();
  await expect(page.getByRole("switch", { name: /Bring in new recordings/ })).toBeChecked();

  // A past recording, brought in by hand, on the tab beside the connection.
  await page.getByRole("tab", { name: "Past Recordings" }).click();
  await page.getByRole("button", { name: "Show the last 30 days" }).click();
  const past = page.getByRole("region", { name: "Past recordings" });
  await expect(past.getByText("Client Kickoff")).toBeVisible();
  await expect(past.getByText(/37 min/)).toBeVisible();
  await past.getByRole("button", { name: "Bring in" }).click();
  await expect(page.getByText("Client Kickoff is on its way to the Library")).toBeVisible();
  const brought = page.getByRole("region", { name: "Brought in from Zoom" });
  await expect(brought.getByRole("link", { name: "In the Library" })).toBeVisible({
    timeout: 30_000,
  });

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

  // Both are in the Library now, named after the meeting and its day.
  await page.goto("/library");
  const uploads = page.getByRole("region", { name: "Your library" });
  await expect(uploads.getByText(/^Client Kickoff \d{4}-\d{2}-\d{2}$/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(uploads.getByText(/^Weekly Sync \d{4}-\d{2}-\d{2}$/)).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(1500);
});

test("an owner connects the whole Zoom account and every host's meetings come in", async ({
  page,
}) => {
  const run = `${stamp}w`;
  await page.goto("/sign-up");
  await page.locator("#name").fill("Harbour Admin");
  await page.locator("#email").fill(`admin.zoom.${run}@example.test`);
  await page.locator("#password").fill("zoom-e2e-password-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill(`Harbour Studio ${run}`);
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();

  // The Zoom account admin signs in to the admin-managed app; no Zoom of their own.
  const admin = {
    id: `zoom-admin-${run}`,
    account_id: `zoom-account-${run}`,
    email: "admin@harbour.test",
    display_name: "Harbour Zoom Admin",
  };
  await fetch(`${ZOOM}/stand-in/user`, { method: "POST", body: JSON.stringify(admin) });
  await page.goto("/settings/integrations/zoom");
  const whole = page.getByRole("region", { name: "Whole Zoom account" });
  await whole.getByRole("button", { name: "Connect whole Zoom account" }).click();
  await expect(page).toHaveURL(/\/settings\/integrations\/zoom$/, { timeout: 30_000 });
  await expect(page.getByText(/The whole Zoom account is connected/)).toBeVisible();
  await expect(whole.getByText(/connected by/)).toBeVisible();
  await expect(whole.getByText("Harbour Admin")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Zoom" })).toBeVisible();

  // Past recordings list every host's, from the whole account.
  await page.getByRole("tab", { name: "Past Recordings" }).click();
  await page.getByRole("button", { name: "Show the last 30 days" }).click();
  const past = page.getByRole("region", { name: "Past recordings" });
  await expect(past.getByText("Team Standup")).toBeVisible();
  await expect(past.getByText("Client Kickoff")).toBeVisible();

  // A colleague who never connected anything finishes a meeting: it comes in by itself.
  const finished = meeting(`colleague-${run}==`, "Design Review", `${admin.id}-colleague`);
  const answer = await zoomSays(
    {
      event: "recording.completed",
      event_ts: Date.now(),
      download_token: "stand-in-download-token",
      payload: { account_id: admin.account_id, object: finished },
    },
    true,
  );
  expect(answer.status).toBe(204);
  const brought = page.getByRole("region", { name: "Brought in from Zoom" });
  await expect(brought.getByText("Design Review")).toBeVisible();
  await expect(brought.getByRole("link", { name: "In the Library" })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(1500);
});
