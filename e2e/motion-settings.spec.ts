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
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();

  await page.goto("/settings/motion");
  const card = page.locator("#motion");
  await expect(card.getByRole("radio", { name: /Clean Talking Head/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await slow(1200);
  await card.getByRole("radio", { name: /Bold Hook/ }).click();
  await slow(800);
  // Pieces and Names are tabs of their own; the picked style waits on its tab.
  await card.getByRole("tab", { name: "Pieces" }).click();
  await card.getByRole("checkbox", { name: /Stat card/ }).click();
  await card.getByRole("tab", { name: "Style" }).click();
  await expect(card.getByText("Bold Hook, changed")).toBeVisible();
  await slow(800);
  await card.getByRole("tab", { name: "Names" }).click();
  await card.getByRole("textbox", { name: "Usual speaker" }).fill("Ana Moreno");
  await card.getByRole("textbox", { name: "Handle", exact: true }).fill("morenostudio");
  await slow(800);
  await card.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Motion settings saved.")).toBeVisible();

  // The reload opens Names again, the tab that was open.
  await page.reload();
  await expect(card.getByRole("textbox", { name: "Handle", exact: true })).toBeVisible();
  await card.getByRole("tab", { name: "Style" }).click();
  await expect(card.getByRole("radio", { name: /Bold Hook/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await card.getByRole("tab", { name: "Pieces" }).click();
  await expect(card.getByRole("checkbox", { name: /Stat card/ })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  // The handle is saved with its @.
  await card.getByRole("tab", { name: "Names" }).click();
  await expect(card.getByRole("textbox", { name: "Handle", exact: true })).toHaveValue(
    "@morenostudio",
  );
  await slow(1500);

  // The AI plan step is there to add, and asks only what to bring out.
  await page.goto("/automations");
  await page.getByRole("link", { name: "New automation", exact: true }).click();
  await page.getByRole("button", { name: "Empty canvas" }).first().click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Search steps").fill("Plan Motion");
  await page
    .getByRole("complementary", { name: "Steps you can add" })
    .getByRole("button", { name: "Plan Motion Graphics", exact: true })
    .click();
  const panel = page.getByRole("complementary", { name: "Settings for this step" });
  await expect(panel.getByLabel("What to bring out")).toBeVisible();
  await expect(panel.getByText(/come from the Add Motion Graphics step after it/)).toBeVisible();
  await expect(page.getByText("AI plans the pieces")).toBeVisible();
  await slow(1500);
});
