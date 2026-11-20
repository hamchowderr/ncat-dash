import { expect, test } from "./test";

// Ready-made follow-ons in a real browser against a real backend: the ready-made list shows
// them in their own category, an automation's canvas suggests the ones that go after it,
// and one click builds one wired to start when that automation finishes.

const stamp = Date.now().toString(36);
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 350 },
  });
}

test("suggests what goes after an automation and builds it in one click", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rae Kim");
  await page.locator("#email").fill(`rae.follow.${stamp}@example.test`);
  await page.locator("#password").fill("follow-ons-e2e-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Follow Shop");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Do You Have A Toolkit?" })).toBeVisible();

  // The list has them in their own category, each saying what it runs after.
  await page.goto("/automations/new");
  await page.getByRole("button", { name: /^After another automation 9$/ }).click();
  await expect(page.getByText("Runs after Lyric video with highlighted words")).toBeVisible();
  await page.getByRole("button", { name: /^All 83$/ }).click();

  await page.getByRole("button", { name: /Approval Lyric video with highlighted words/ }).click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  const lyricUrl = page.url();

  // The canvas suggests what goes after it, beside the canvas rather than over it.
  const after = page.getByRole("button", { name: /After this/ });
  await expect(after).toContainText("1 suggested");
  await after.click();
  const panel = page.getByRole("complementary", { name: "What runs after this automation" });
  await expect(panel.getByText("Nothing starts when this automation finishes yet.")).toBeVisible();
  await expect(panel.getByText("Lyric Video For Reels And Shorts")).toBeVisible();
  await page.waitForTimeout(1000);

  // One click builds it, wired after the lyric video and already on.
  await panel.getByRole("button", { name: "Build Lyric Video For Reels And Shorts" }).click();
  await expect(page).not.toHaveURL(lyricUrl, { timeout: 30_000 });
  await expect(page.getByLabel("Automation name")).toHaveValue("Lyric Video For Reels And Shorts");
  await expect(page.getByText("On", { exact: true })).toBeVisible();
  await page.locator(".react-flow__node-trigger").click();
  await expect(page.getByRole("combobox", { name: "Which automation" })).toContainText(
    "Lyric video with highlighted words",
  );
  await page.waitForTimeout(1000);

  // Back on the lyric video, it shows as running after it and is no longer suggested.
  await page.goto(lyricUrl);
  await expect(page.getByRole("button", { name: /After this/ })).not.toContainText("suggested");
  await page.getByRole("button", { name: /After this/ }).click();
  await expect(
    page
      .getByRole("complementary", { name: "What runs after this automation" })
      .getByRole("link", { name: /Lyric Video For Reels And Shorts/ }),
  ).toBeVisible();
  await page.waitForTimeout(1000);
});
