import { expect, test } from "./test";

// A Translate Subtitles step, in a real browser against a real backend: languages are
// picked from the full list by typing, kept when the automation is saved and opened
// again, and can be taken off.

const stamp = Date.now().toString(36);

test("a Translate Subtitles step keeps the languages picked across a reload", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Kenji Watanabe");
  await page.locator("#email").fill(`kenji.subtitles.${stamp}@example.test`);
  await page.locator("#password").fill("subtitle-languages-e2e-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Watanabe Talks");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Do You Have A Toolkit?" })).toBeVisible();

  await page.goto("/automations");
  await page.getByRole("link", { name: "New automation", exact: true }).click();
  await page.getByRole("button", { name: "Empty canvas" }).first().click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Search steps").fill("Translate Subtitles");
  await page
    .getByRole("complementary", { name: "Steps you can add" })
    .getByRole("button", { name: "Translate Subtitles", exact: true })
    .click();

  const panel = page.getByRole("complementary", { name: "Settings for this step" });
  await expect(panel.getByText("Pick each language to write subtitles in.")).toBeVisible();
  await panel.getByRole("button", { name: "Add a language" }).click();
  await page.getByPlaceholder("Find a language").fill("spanish lat");
  await page.getByRole("option", { name: "Spanish (Latin America)" }).click();
  await page.getByPlaceholder("Find a language").fill("japan");
  await page.getByRole("option", { name: "Japanese" }).click();
  await page.keyboard.press("Escape");
  const picked = panel.getByRole("list", { name: "Languages picked" });
  await expect(picked.getByRole("listitem")).toHaveText(["Spanish (Latin America)", "Japanese"]);
  // The panel never runs sideways on a phone or a narrow window.
  const overflow = await panel.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByText(/^Saved/).first()).toBeVisible();

  await page.reload();
  await page.locator(".react-flow__node-step").first().click();
  const again = page.getByRole("complementary", { name: "Settings for this step" });
  await expect(
    again.getByRole("list", { name: "Languages picked" }).getByRole("listitem"),
  ).toHaveText(["Spanish (Latin America)", "Japanese"]);
  await again.getByRole("button", { name: "Take off Japanese" }).click();
  await expect(
    again.getByRole("list", { name: "Languages picked" }).getByRole("listitem"),
  ).toHaveText(["Spanish (Latin America)"]);
});
