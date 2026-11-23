import { expect, test } from "./test";

// The sign-in screens are Better Auth UI's (src/components/auth), at the dashboard's own
// addresses. These walk the ways in and out that every person goes through.

const PASSWORD = "sign-in-e2e-password-1";

test("creating an account, signing out, and signing back in to the page you were on", async ({
  page,
}) => {
  const email = `sign.in.${Date.now()}@example.test`;

  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Create your Takewon account" })).toBeVisible();
  await expect(page.getByText("Your content, social media ready.")).toBeVisible();
  await page.locator("#name").fill("Robin Vale");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Vale Studio");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("button", { name: /Yes, I Have One/ })).toBeVisible({
    timeout: 30_000,
  });

  // Signed in, the sign-in page sends you on.
  await page.goto("/sign-in");
  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 30_000 });

  // Signed out, a page inside the dashboard asks you to sign in and comes back to it.
  await page.context().clearCookies();
  await page.goto("/jobs");
  await expect(page).toHaveURL(/\/sign-in\?redirectTo=%2Fjobs/, { timeout: 30_000 });

  await page.locator("#email").fill(email);
  await page.locator("#password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(/Invalid email or password/i)).toBeVisible();

  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/jobs$/, { timeout: 30_000 });
});

test("the sign-in screens fit a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/sign-in", "/sign-up", "/forgot-password", "/verify-email"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(wide, path).toBe(false);
  }
});

test("a used or expired confirmation link says so and offers a way back", async ({ page }) => {
  await page.goto("/callback?error=TOKEN_EXPIRED&redirectTo=%2F");
  await expect(page.getByText("This link has expired")).toBeVisible();
});

test("the Account page changes your name and password and signs out your other devices", async ({
  browser,
}) => {
  const email = `account.${Date.now()}@example.test`;
  const first = await browser.newPage();
  await first.goto("/sign-up");
  await first.locator("#name").fill("Robin Vale");
  await first.locator("#email").fill(email);
  await first.locator("#password").fill(PASSWORD);
  await first.getByRole("button", { name: "Create account" }).click();
  await expect(first).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await first.getByPlaceholder("Your company or channel").fill("Vale Studio");
  await first.getByRole("button", { name: "Create team" }).click();
  await expect(first.getByRole("button", { name: /Yes, I Have One/ })).toBeVisible({
    timeout: 30_000,
  });

  // A second device, signed in as the same person.
  const second = await browser.newPage();
  await second.goto("/sign-in");
  await second.locator("#email").fill(email);
  await second.locator("#password").fill(PASSWORD);
  await second.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(second).not.toHaveURL(/\/sign-in/, { timeout: 30_000 });

  await first.goto("/settings/account");
  await first.getByLabel("Your name").fill("Robin Vale-Hart");
  await first.getByRole("button", { name: "Save changes" }).click();
  await expect(first.getByText(/Profile updated/i)).toBeVisible();

  await first.getByRole("tab", { name: "Password And Devices" }).click();
  await expect(first).toHaveURL(/tab=security/);
  await expect(first.getByText("Where you're signed in")).toBeVisible({ timeout: 30_000 });
  await expect(first.getByText("This device")).toBeVisible();

  await first.getByLabel("Current password").fill(PASSWORD);
  await first.getByLabel("New password").fill("a-brand-new-password-2");
  await first.getByRole("button", { name: "Update password" }).click();
  await expect(
    first.getByText("Password changed. Your other devices were signed out."),
  ).toBeVisible();

  // The other device is signed out, and the new password works.
  await second.reload();
  await expect(second).toHaveURL(/\/sign-in/, { timeout: 30_000 });
  await second.locator("#email").fill(email);
  await second.locator("#password").fill("a-brand-new-password-2");
  await second.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(second).not.toHaveURL(/\/sign-in/, { timeout: 30_000 });
  await first.close();
  await second.close();
});
