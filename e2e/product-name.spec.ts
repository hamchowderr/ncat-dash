import { expect, test } from "./test";

// The product is Kontifi: every page title ends with it.
test("page titles carry the Kontifi name", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page).toHaveTitle("Sign in · Kontifi");
  await page.goto("/sign-up");
  await expect(page).toHaveTitle("Create account · Kontifi");
});
