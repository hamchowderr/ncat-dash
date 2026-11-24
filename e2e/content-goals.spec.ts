import { expect, test } from "@playwright/test";

// Setting up ends by asking what the team makes, in a real browser against a real local
// backend: a coach picks coaching and where they post, the coaching pack and the lecture
// pack are added for Instagram, set to ask first, so the first upload shows them ready to
// run with one press and nothing runs by itself.

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
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();
  // Back to setting up, which carries on at the brand.
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Skip for now" }).click();

  // What they make.
  await expect(page.getByRole("heading", { name: "What Do You Make?" })).toBeVisible();
  await expect(page.getByText("Step 3 of 6")).toBeVisible();
  await page.getByRole("button", { name: /Coaching or Courses/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // Where they post, with each app's own logo.
  await expect(page.getByRole("heading", { name: "Where do you post?" })).toBeVisible();
  await page.getByRole("button", { name: "Instagram" }).click();
  await page.getByRole("button", { name: "LinkedIn" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // One that fits a coach, unticked, with nothing that runs after it; ticked, then added.
  await expect(page.getByRole("heading", { name: "Suggest these on your uploads" })).toBeVisible();
  const picks = page.getByRole("list", { name: "Ready-made automations for you" });
  await expect(picks.getByRole("checkbox")).toHaveCount(1);
  const pack = picks.getByRole("checkbox", { name: /Coaching session pack/ });
  await expect(pack).not.toBeChecked();
  await expect(page.getByText(/Runs after/)).toHaveCount(0);
  await pack.click();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const sideways = await page.evaluate(
      () => document.scrollingElement!.scrollWidth > innerWidth + 1,
    );
    expect(sideways, `the page scrolls sideways at ${width}`).toBe(false);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Add 1 automation" }).click();

  // The first upload goes in. Nothing runs by itself: it shows on the file, one press away.
  await expect(page.getByRole("heading", { name: "Upload your first recording" })).toBeVisible();
  await expect(page.getByText(/Coaching session pack/).first()).toBeVisible();
  // A coach records on calls, so their meeting apps are offered beside the upload.
  const meetings = page.getByRole("region", { name: "Record your sessions on a call?" });
  await expect(meetings.getByRole("link", { name: /Connect Zoom/ })).toBeVisible();
  await expect(meetings.getByRole("link", { name: /Connect Google Meet/ })).toBeVisible();
  await expect(meetings.getByRole("link", { name: /Connect Microsoft Teams/ })).toBeVisible();
  await page.getByLabel("Choose a recording to upload").setInputFiles("e2e/fixtures/clip.webm");
  const started = page.getByRole("region", { name: "What your upload started" });
  await expect(started.getByText("clip.webm")).toBeVisible({ timeout: 30_000 });
  const suggested = started.getByRole("list", { name: "Suggested for this file" });
  await expect(
    suggested.getByRole("button", { name: "Run Coaching session pack on this file" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(started.getByRole("list", { name: "Ran on this file" })).toHaveCount(0);
  // One press runs it on this file, and it moves to what ran, with how it is doing.
  await suggested.getByRole("button", { name: "Run Coaching session pack on this file" }).click();
  const ran = started.getByRole("list", { name: "Ran on this file" });
  await expect(ran.getByRole("link", { name: /Coaching session pack/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(ran.getByText(/Run by hand/)).toBeVisible();
  await expect(
    suggested.getByRole("button", { name: "Run Coaching session pack on this file" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: /Go to the dashboard/ }).click();
  await expect(page).toHaveURL(/\/$/);
  // Setting up ends with the tour of the dashboard (e2e/tour.spec.ts walks it).
  await expect(page.getByRole("dialog")).toContainText("Welcome to Takewon");
  // Escape closes it wherever the card sits; it moves while Home settles on a slow machine.
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-tour-card]")).toHaveCount(0);
  // Answered, so Home no longer asks; the agent now makes clips for these by default.
  await expect(page.getByRole("link", { name: /Tell us what you make/ })).toHaveCount(0);
  await page.goto("/settings/agent");
  await expect(page.getByRole("checkbox", { name: /Instagram Reels/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^LinkedIn/ })).toBeChecked();

  // It is on the team's automations list, and nothing else was added.
  await page.goto("/automations");
  await expect(page.getByRole("link", { name: "Coaching session pack" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sermon, webinar or lecture pack" })).toHaveCount(0);
});

test("setting up never asks about a toolkit; a copy that lends none connects one in Settings", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Sam Okafor");
  await page.locator("#email").fill(`sam.${stamp}@example.test`);
  await page.locator("#password").fill("goals-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Okafor Talks");
  await page.getByRole("button", { name: "Create team" }).click();

  // Straight from the team to the brand: no toolkit question, no toolkit field.
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible();
  await expect(page.getByText("Step 2 of 6")).toBeVisible();
  await expect(page.getByText(/Do You Have A Toolkit/)).toHaveCount(0);
  await expect(page.locator("#baseUrl")).toHaveCount(0);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const sideways = await page.evaluate(
      () => document.scrollingElement!.scrollWidth > innerWidth + 1,
    );
    expect(sideways, `the page scrolls sideways at ${width}`).toBe(false);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  // Only the logo and colour while setting up, so the step fits on one screen.
  await expect(page.locator("#brand-font")).toHaveCount(0);
  const tall = await page.evaluate(() => document.scrollingElement!.scrollHeight);
  expect(tall, "the brand step fits on a 900px screen").toBeLessThanOrEqual(900);
  await page.getByRole("button", { name: "Skip for now" }).click();

  await page.getByRole("button", { name: /Coaching or Courses/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Instagram" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("checkbox", { name: /Coaching session pack/ }).click();
  await page.getByRole("button", { name: "Add 1 automation" }).click();

  // This copy lends no toolkit, so there is nowhere to upload to yet: the last screen says
  // what comes next.
  await expect(
    page.getByRole("heading", { name: "Connect A Toolkit When You're Ready" }),
  ).toBeVisible();
  await expect(page.getByLabel("Choose a recording to upload")).toHaveCount(0);
  await expect(page.getByText(/Coaching session pack/).first()).toBeVisible();
  await page.getByRole("button", { name: /Go to the dashboard/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("dialog")).toContainText("Welcome to Takewon");
  // Escape closes it wherever the card sits; it moves while Home settles on a slow machine.
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-tour-card]")).toHaveCount(0);

  // Home's link goes to Settings, under Toolkit, where the steps and the form are open.
  await page
    .getByRole("link", { name: /Connect your toolkit/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/settings\/toolkit$/);
  await expect(page.getByText("No toolkit yet", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /github\.com\/hamchowderr\/no-code-architects-toolkit/ }),
  ).toBeVisible();
  // Or a prompt for their own AI agent, carrying this dashboard's address for the bucket.
  await expect(page.getByRole("heading", { name: "Recommended setup" })).toBeVisible();
  await expect(page.getByTestId("agent-connectors")).toContainText(
    "https://mcp.cloudflare.com/mcp",
  );
  await expect(page.getByTestId("agent-prompt").locator("pre")).toContainText(
    "CORS on that bucket for http://localhost:3000",
  );
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();
  await expect(page.getByText("Working")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("Toolkit connected")).toBeVisible();
});
