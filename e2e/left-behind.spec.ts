import { execSync } from "node:child_process";

import { expect, test } from "./test";

// A team that moved from Takewon's server to its own: a video it uploaded before stays on
// Takewon's storage. In a real browser, it is labelled so in the library and on its page,
// instead of looking like any other file that then cannot be opened.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";
// Set to a folder to keep screenshots, as sent with the pull request.
const SHOTS = process.env.LEFT_BEHIND_SHOTS;

test("a video left on Takewon's storage is labelled in the library and on its page", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rae Kim");
  await page.locator("#email").fill(`rae.left.${stamp}@example.test`);
  await page.locator("#password").fill("left-behind-e2e-123456");
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

  await page.goto("/library");
  await page.getByLabel("Choose files to upload").setInputFiles("e2e/fixtures/clip.webm");
  await expect(page.getByLabel(/^Open V\d+ clip$/)).toBeVisible({ timeout: 30_000 });

  // The team switched before files were marked: mark what it made before now, as the
  // operator does once for such a team.
  const newest = JSON.parse(
    execSync("npx convex data libraryItems --limit 1 --order desc --format jsonl", {
      encoding: "utf8",
    }).trim(),
  ) as { organizationId: string };
  execSync(
    `npx convex run leftBehind:markOlder '${JSON.stringify({
      organizationId: newest.organizationId,
      left: { hosted: true, bucket: "takewon-media", endpoint: "https://r2.takewon.example" },
      before: Date.now() + 1000,
    })}'`,
    { stdio: "pipe" },
  );

  await page.goto("/library");
  const label = page.getByText("On Takewon's storage").first();
  await expect(label).toBeVisible({ timeout: 30_000 });
  await expect(label).toHaveAttribute("title", /still plays and runs from there/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/Library.png` });

  await page
    .getByLabel(/^Open V\d+ clip$/)
    .first()
    .click();
  await expect(page).toHaveURL(/\/library\//);
  await expect(page.getByText("On Takewon's storage")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/File Page.png` });
});
