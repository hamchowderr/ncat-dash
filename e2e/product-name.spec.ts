import { expect, test } from "./test";

// The product is Takewon: every page title ends with it.
test("page titles carry the Takewon name", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page).toHaveTitle("Sign in · Takewon");
  await page.goto("/sign-up");
  await expect(page).toHaveTitle("Create account · Takewon");
});
