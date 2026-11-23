import { expect, test } from "./test";

// The chain tab in a real browser against a real backend: an automation and every
// automation linked to it on one canvas, with lines saying how each starts the next, and
// ready-made follow-ons built from there in one click without leaving the page.

const stamp = Date.now().toString(36);
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 350 },
  });
}

test("shows linked automations together and grows the chain from there", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rae Kim");
  await page.locator("#email").fill(`rae.chain.${stamp}@example.test`);
  await page.locator("#password").fill("chain-view-e2e-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Chain Shop");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible();

  await page.goto("/automations/new");
  await page.getByRole("button", { name: /Clips for social/ }).click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  const clipsUrl = page.url();

  // On its own, the chain is just this one, with what goes well after it.
  await page.getByRole("tab", { name: /Chain/ }).click();
  const canvas = page.getByTestId("chain-canvas");
  await expect(
    page.getByText("Nothing starts this automation and nothing starts after it yet."),
  ).toBeVisible();
  await expect(canvas.getByRole("article", { name: "Clips for social" })).toContainText(
    "This automation",
  );
  const brand = canvas.getByRole("article", { name: "Suggested: Brand Every Clip" });
  await expect(brand).toContainText("Goes well after Clips for social");
  await page.waitForTimeout(800);

  // Building one keeps you here and it joins the chain, after the clips.
  await brand.getByRole("button", { name: "Build Brand Every Clip" }).click();
  await expect(page).toHaveURL(clipsUrl);
  await expect(canvas.getByRole("article", { name: "Brand Every Clip" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("tab", { name: /Chain/ })).toContainText("2");
  await expect(canvas.getByText("after it works")).toBeVisible();
  // It needs the team's logo, so it waits switched off.
  await expect(canvas.getByRole("article", { name: "Brand Every Clip" })).toContainText("Off");
  await page.waitForTimeout(800);

  // What goes after that is offered next, and builds a third link.
  const ready = canvas.getByRole("article", { name: "Suggested: Ready To Post" });
  await expect(ready).toContainText("Goes well after Brand Every Clip");
  await ready.getByRole("button", { name: "Build Ready To Post" }).click();
  await expect(canvas.getByRole("article", { name: "Ready To Post" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("tab", { name: /Chain/ })).toContainText("3");
  await expect(canvas.getByText("after it works")).toHaveCount(2);
  await page.waitForTimeout(800);

  // From the last one, the same chain shows, with the first one a link away.
  await canvas.getByRole("link", { name: "Ready To Post" }).click();
  await expect(page).not.toHaveURL(clipsUrl, { timeout: 30_000 });
  await page.getByRole("tab", { name: /Chain/ }).click();
  await expect(
    page.getByText("3 automations that start each other.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByTestId("chain-canvas").getByRole("article", { name: "Ready To Post" }),
  ).toContainText("This automation");

  // The After this column on the editor leads to the chain too.
  await page.getByRole("tab", { name: "Editor" }).click();
  await page.goto(clipsUrl);
  await page.getByRole("button", { name: /After this/ }).click();
  await page.getByRole("button", { name: "See the whole chain" }).click();
  await expect(page.getByTestId("chain-canvas")).toBeVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const sideways = await page.evaluate(
      () => document.scrollingElement!.scrollWidth > innerWidth + 1,
    );
    expect(sideways, `the page scrolls sideways at ${width}`).toBe(false);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(1000);
});
