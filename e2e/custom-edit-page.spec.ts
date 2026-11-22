import { expect, test } from "./test";

// The Custom edit step's page names nothing after the tool the toolkit uses underneath:
// not its address, its title, or the line under Input. The old address still opens it.

test("the Custom edit step has a plain address and plain words", async ({ page }) => {
  await page.goto("/steps");
  await page
    .getByRole("link", { name: /Custom edit/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/steps\/custom-edit$/);
  await expect(page.getByRole("heading", { level: 1, name: "Custom edit" })).toBeVisible();
  await expect(page.getByText("Runs on your toolkit with these settings.")).toBeVisible();
  expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/ffmpeg/i);

  await page.goto("/steps/ffmpeg-compose");
  await expect(page).toHaveURL(/\/steps\/custom-edit$/);
});
