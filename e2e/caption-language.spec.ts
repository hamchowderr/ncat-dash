import { expect, test } from "./test";

// A Caption video step that captions in another language, in a real browser against a
// real backend: the language is picked from the full list by typing, kept when the
// automation is saved and opened again, and can go back to the language spoken.

const stamp = Date.now().toString(36);

test("a Caption video step captions in a language picked from the list, kept across a reload", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Lucía Herrera");
  await page.locator("#email").fill(`lucia.captions.${stamp}@example.test`);
  await page.locator("#password").fill("caption-language-e2e-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Herrera Clips");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible();

  await page.goto("/automations");
  await page.getByRole("link", { name: "New automation", exact: true }).click();
  await page.getByRole("button", { name: "Empty canvas" }).first().click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Search steps").fill("Caption video");
  await page
    .getByRole("complementary", { name: "Steps you can add" })
    .getByRole("button", { name: "Caption video", exact: true })
    .click();

  const panel = page.getByRole("complementary", { name: "Settings for this step" });
  const language = panel.getByRole("combobox", { name: "Caption language" });
  await expect(language).toHaveText("The language spoken");
  await expect(panel.getByText("Captions are in the language spoken in the video.")).toBeVisible();

  await language.click();
  await page.getByPlaceholder("Find a language").fill("spanish lat");
  await page.getByRole("option", { name: "Spanish (Latin America)" }).click();
  await expect(language).toHaveText("Spanish (Latin America)");
  await expect(
    panel.getByText(
      "Translated into Spanish (Latin America) once per video. Each word still lights up as it is said.",
    ),
  ).toBeVisible();
  // The panel never runs sideways on a phone or a narrow window.
  const overflow = await panel.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByText(/^Saved/).first()).toBeVisible();

  await page.reload();
  await page.locator(".react-flow__node-step").first().click();
  const again = page
    .getByRole("complementary", { name: "Settings for this step" })
    .getByRole("combobox", { name: "Caption language" });
  await expect(again).toHaveText("Spanish (Latin America)");

  await again.click();
  await page.getByRole("option", { name: "The language spoken" }).click();
  await expect(again).toHaveText("The language spoken");
});
