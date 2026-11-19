import { expect, test } from "./test";

// Settings > Motion in a real browser against a real backend: the owner picks a preset,
// changes a piece and sets the names, and it is all kept across a reload.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";
const slow = (ms: number) =>
  process.env.SLOW ? new Promise((done) => setTimeout(done, ms)) : null;

test("the team picks a motion style, changes it, and it is kept", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Ana Moreno");
  await page.locator("#email").fill(`ana.motion.${stamp}@example.test`);
  await page.locator("#password").fill("motion-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Moreno Studio");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  await page.goto("/settings/motion");
  const card = page.locator("#motion");
  await expect(card.getByRole("radio", { name: /Clean Talking Head/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await slow(1200);
  await card.getByRole("radio", { name: /Bold Hook/ }).click();
  await slow(800);
  await card.getByRole("checkbox", { name: /Stat card/ }).click();
  await expect(card.getByText("Bold Hook, changed")).toBeVisible();
  await slow(800);
  await card.getByRole("textbox", { name: "Usual speaker" }).fill("Ana Moreno");
  await card.getByRole("textbox", { name: "Handle" }).fill("morenostudio");
  await slow(800);
  await card.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Motion settings saved.")).toBeVisible();

  await page.reload();
  await expect(card.getByRole("radio", { name: /Bold Hook/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(card.getByRole("checkbox", { name: /Stat card/ })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  // The handle is saved with its @.
  await expect(card.getByRole("textbox", { name: "Handle" })).toHaveValue("@morenostudio");
  await slow(1500);
});
