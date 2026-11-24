import { expect, test } from "./test";

// The home page in a real browser: a new team sees what is left to set up, with no
// templates on Home and no scroll bar, and finds every template on the New automation
// page, sorted and searchable.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";

test("a new team's home shows getting set up, fits the window, and leaves templates to Automations", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Kai Moreno");
  await page.locator("#email").fill(`kai.${stamp}@example.test`);
  await page.locator("#password").fill("home-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Moreno Studio");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Moreno Studio" })).toBeVisible();
  await expect(page.getByTestId("home-week")).toHaveText(
    "No automations yet. Start from a template on the Automations page.",
  );
  // Nothing about the toolkit on Home: that is in Settings.
  await expect(page.getByTestId("processing-status")).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText(/toolkit/i);
  const glance = page.getByRole("complementary", { name: "Your team at a glance" });
  const setup = glance.getByRole("region", { name: /^Getting started, 0 of 4 done$/ });
  await expect(setup.getByRole("link", { name: /Add your logo/ })).toBeVisible();
  // Getting started and This week sit in a narrow column on the right, at the top.
  const latest = page.getByRole("region", { name: "Latest runs" });
  const side = (await glance.boundingBox())!;
  const main = (await latest.boundingBox())!;
  expect(side.x).toBeGreaterThan(main.x + main.width - 1);
  expect(side.width).toBeLessThan(main.width / 2);
  expect(Math.abs(side.y - main.y)).toBeLessThan(40);
  await expect(glance.getByRole("region", { name: "This week" })).toBeVisible();

  // Templates are not on Home: they live on the Automations page.
  await expect(page.getByRole("region", { name: /Ready-made/ })).toHaveCount(0);
  await expect(page.getByText("Podcast master and transcript")).toHaveCount(0);

  // Home fits the window: no scroll bar on a laptop screen, and never sideways.
  const frame = page.locator("[data-page-frame]");
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    const extra = await frame.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(extra, `Home scrolls at ${width}x${height}`).toBeLessThanOrEqual(1);
  }
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const sideways = await page.evaluate(
      () => document.scrollingElement!.scrollWidth > innerWidth + 1,
    );
    expect(sideways, `the page scrolls sideways at ${width}`).toBe(false);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // Getting started points to every template, on one page, by category, and searchable.
  await setup.getByRole("link", { name: /Switch on an automation/ }).click();
  await expect(page).toHaveURL(/\/automations\/new$/);
  await expect(page.getByRole("button", { name: /^All 89$/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: /^Music \d+$/ }).click();
  await expect(page.getByText("Lyric video with highlighted words")).toBeVisible();
  await expect(page.getByText("Clips for social")).toHaveCount(0);
  await page.getByRole("button", { name: /^All 89$/ }).click();
  await page.getByLabel("Find a ready-made automation").fill("loudness");
  await expect(page.getByText("Even out loudness for platforms")).toBeVisible();
  await page.getByLabel("Find a ready-made automation").fill("");

  // Starting one there opens it on the canvas.
  await page.getByText("Podcast master and transcript").click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  await expect(page.locator(".react-flow__node-step")).toHaveCount(2);
});
