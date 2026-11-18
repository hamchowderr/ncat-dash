import { expect, test } from "@playwright/test";

// The home page and the ready-made list, in a real browser: a new team sees what is left
// to set up and the ready-made automations first, starts one from home, and finds every
// ready-made automation on the New automation page, sorted and searchable.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";

test("a new team's home leads with getting set up and ready-made automations", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Kai Moreno");
  await page.locator("#email").fill(`kai.${stamp}@example.test`);
  await page.locator("#password").fill("home-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Moreno Studio");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Moreno Studio" })).toBeVisible();
  await expect(page.getByTestId("home-week")).toHaveText(
    "No automations yet. Start from a ready-made one below.",
  );
  await expect(page.getByTestId("connection-status")).toHaveText("Toolkit connected");
  const setup = page.getByRole("region", { name: /^Getting started, 2 of 5 done$/ });
  await expect(setup.getByRole("link", { name: /Add your logo/ })).toBeVisible();

  // Nothing is on yet, so ready-made automations come before the latest runs.
  const ready = page.getByRole("region", { name: "Ready-made automations" });
  const latest = page.getByRole("region", { name: "Latest runs" });
  expect((await ready.boundingBox())!.y).toBeLessThan((await latest.boundingBox())!.y);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const sideways = await page.evaluate(
      () => document.scrollingElement!.scrollWidth > innerWidth + 1,
    );
    expect(sideways, `the page scrolls sideways at ${width}`).toBe(false);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // Every ready-made automation is on one page, by category, and can be searched.
  await ready.getByRole("link", { name: /See all 45/ }).click();
  await expect(page).toHaveURL(/\/automations\/new$/);
  await expect(page.getByRole("button", { name: /^All 45$/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: /^Music \d+$/ }).click();
  await expect(page.getByText("Lyric video with highlighted words")).toBeVisible();
  await expect(page.getByText("Clips for social")).toHaveCount(0);
  await page.getByRole("button", { name: /^All 45$/ }).click();
  await page.getByLabel("Find a ready-made automation").fill("loudness");
  await expect(page.getByText("Even out loudness for platforms")).toBeVisible();

  // Starting one from home opens it on the canvas.
  await page.goto("/");
  await page
    .getByRole("region", { name: "Ready-made automations" })
    .getByText("Podcast master and transcript")
    .click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  await expect(page.locator(".react-flow__node-step")).toHaveCount(2);
});
