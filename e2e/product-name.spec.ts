import { expect, test } from "./test";

// The product is Kontentifi: every page title ends with it.
test("page titles carry the Kontentifi name", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page).toHaveTitle("Sign in · Kontentifi");
  await page.goto("/sign-up");
  await expect(page).toHaveTitle("Create account · Kontentifi");
});
