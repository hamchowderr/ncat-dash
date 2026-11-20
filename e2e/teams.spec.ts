import { createHmac } from "node:crypto";

import { AGENT_SECRET } from "../playwright.config";
import { expect, test } from "./test";

import { MICROSOFT, MICROSOFT_USER, TEAMS_TEAM } from "./microsoft-data.mjs";

// The agent in Microsoft Teams, in a real browser against a real backend: an owner links
// the team's Microsoft organization from Settings (the stand-in signs in at once), the
// Teams app can be downloaded, the agent server asks who wrote in a Teams team, and the
// owner then picks one of that team's channels for alerts.

const CONVEX_SITE = "http://127.0.0.1:3211";
const stamp = Date.now().toString(36);
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 300 },
  });
}

/** A short-lived token the agent server signs its questions to the dashboard with. */
function agentToken() {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const body = `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: "agent-server", iat, exp: iat + 300 })}`;
  return `${body}.${createHmac("sha256", AGENT_SECRET).update(body).digest("base64url")}`;
}

test("links the Microsoft organization, offers the Teams app, and sends alerts to a channel", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Harbour Organizer");
  await page.locator("#email").fill(`organizer.teams.${stamp}@example.test`);
  await page.locator("#password").fill("teams-e2e-password-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill(`Harbour Films ${stamp}`);
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill("http://127.0.0.1:8767");
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  // Each run signs in as its own account and organization, since one Microsoft
  // organization can be linked to only one team.
  const tenant = `00000000-0000-4000-8000-${stamp.padStart(12, "0").slice(-12)}`;
  const userId = `ms-teams-${stamp}`;
  await fetch(`${MICROSOFT}/stand-in/user`, {
    method: "POST",
    body: JSON.stringify({ id: userId, tid: tenant }),
  });

  await page.goto("/settings/teams");
  await expect(page.getByRole("heading", { level: 1, name: "Microsoft Teams" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Microsoft Teams logo" })).toBeVisible();
  await page.getByRole("button", { name: "Link Microsoft organization" }).click();
  await expect(page).toHaveURL(/\/settings\/teams$/, { timeout: 30_000 });
  await expect(page.getByText("Your Microsoft organization is linked")).toBeVisible();
  await expect(page.getByText("Harbour Films Ltd")).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Your Microsoft account" })
      .getByText(MICROSOFT_USER.displayName),
  ).toBeVisible();

  // The Teams app to upload: a zip with the manifest naming the dashboard's bot.
  const download = page.getByRole("link", { name: /Download the Teams app/ });
  const zip = await fetch((await download.getAttribute("href")) ?? "");
  expect(zip.status).toBe(200);
  const bytes = Buffer.from(await zip.arrayBuffer()).toString("latin1");
  expect(bytes).toContain("manifest.json");
  expect(bytes).toContain("stand-in-teams-bot");

  // Before the bot has been in a Teams team, there are no channels to pick.
  await expect(page.getByText(/mention the agent once/)).toBeVisible();

  // Someone writes to the agent in a Teams team; the agent server asks who they are.
  const asked = await fetch(`${CONVEX_SITE}/teams/person`, {
    method: "POST",
    headers: { authorization: `Bearer ${agentToken()}`, "content-type": "application/json" },
    body: JSON.stringify({
      tenantId: tenant,
      aadObjectId: userId,
      teamId: TEAMS_TEAM.id,
      teamName: TEAMS_TEAM.name,
      serviceUrl: TEAMS_TEAM.serviceUrl,
    }),
  });
  expect(await asked.json()).toMatchObject({ ok: true, name: "Harbour Organizer" });

  // Now that team's channels show, and the owner picks one for alerts.
  await page.reload();
  const select = page.getByRole("combobox", { name: "Alerts" });
  await expect(select).toBeEnabled();
  await select.click();
  await page.getByRole("option", { name: `${TEAMS_TEAM.name} › Edits` }).click();
  await expect(page.getByText("Alerts go to Teams")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Alerts" })).toHaveText(
    `${TEAMS_TEAM.name} › Edits`,
  );
});
