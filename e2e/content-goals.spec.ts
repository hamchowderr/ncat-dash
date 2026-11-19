import { expect, test } from "@playwright/test";

// Setting up ends by asking what the team makes, in a real browser against a real local
// backend: a coach picks coaching and where they post, the coaching pack and the lecture
// pack are switched on for Instagram, and the first upload starts them.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";

test("a coach is asked what they make and their first upload starts the fitting automations", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Dana Reyes");
  await page.locator("#email").fill(`dana.${stamp}@example.test`);
  await page.locator("#password").fill("goals-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Reyes Coaching");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();

  // What they make.
  await expect(page.getByRole("heading", { name: "What Do You Make?" })).toBeVisible();
  await expect(page.getByText("Step 4 of 7")).toBeVisible();
  await page.getByRole("button", { name: /Coaching or Courses/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // Where they post, with each app's own logo.
  await expect(page.getByRole("heading", { name: "Where do you post?" })).toBeVisible();
  await page.getByRole("button", { name: "Instagram" }).click();
  await page.getByRole("button", { name: "LinkedIn" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // The two that fit a coach, ticked, then switched on.
  await expect(page.getByRole("heading", { name: "Switch these on" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Coaching session pack/ })).toBeChecked();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const sideways = await page.evaluate(
      () => document.scrollingElement!.scrollWidth > innerWidth + 1,
    );
    expect(sideways, `the page scrolls sideways at ${width}`).toBe(false);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Switch on 2 automations" }).click();

  // The first upload goes in and starts them.
  await expect(page.getByRole("heading", { name: "Upload your first recording" })).toBeVisible();
  await expect(page.getByText(/Coaching session pack/).first()).toBeVisible();
  await page.getByLabel("Choose a recording to upload").setInputFiles("e2e/fixtures/clip.webm");
  const started = page.getByRole("region", { name: "What your upload started" });
  await expect(started.getByText("clip.webm")).toBeVisible({ timeout: 30_000 });
  await expect(started.getByRole("link", { name: /Coaching session pack/ })).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    started.getByRole("link", { name: /Sermon, webinar or lecture pack/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Go to the dashboard/ }).click();
  await expect(page).toHaveURL(/\/$/);
  // Setting up ends with the tour of the dashboard (e2e/tour.spec.ts walks it).
  await expect(page.getByRole("dialog")).toContainText("Welcome to Your Dashboard");
  await page.getByRole("button", { name: "Close the tour" }).click();
  // Answered, so Home no longer asks; the agent now makes clips for these by default.
  await expect(page.getByRole("link", { name: /Tell us what you make/ })).toHaveCount(0);
  await page.goto("/settings/agent");
  await expect(page.getByRole("checkbox", { name: /Instagram Reels/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^LinkedIn/ })).toBeChecked();

  // Both are on the team's automations list.
  await page.goto("/automations");
  await expect(page.getByRole("link", { name: "Coaching session pack" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sermon, webinar or lecture pack" })).toBeVisible();
});
