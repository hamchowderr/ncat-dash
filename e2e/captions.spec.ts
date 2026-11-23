import { expect, type Page, test } from "./test";

// Captions in Settings, in a real browser against a real backend: word fixes, a saved
// style made from a built-in one, the style each shape gets, kept across a reload; then a
// Caption video step that shows what it will use and can pick one of the styles.

const stamp = Date.now().toString(36);

// RECORD=1 makes a screen recording at a pace a person can follow.
if (process.env.RECORD === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 350 },
  });
}
const captions = (page: Page) =>
  page.locator("form").filter({ has: page.getByRole("tablist", { name: "Captions" }) });
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true }).click();

test("an owner sets word fixes, a style and a style per shape, and caption steps use them", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Ivy Chen");
  await page.locator("#email").fill(`ivy.${stamp}@example.test`);
  await page.locator("#password").fill("captions-e2e-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Night Shift");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible();

  await page.goto("/settings/captions");
  await expect(page.getByRole("heading", { level: 1, name: "Captions" })).toBeVisible();
  const save = captions(page).getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();

  // Two words the transcript keeps getting wrong, on their own tab.
  await tab(page, "Word Fixes");
  await expect(page).toHaveURL(/\?tab=words$/);
  await expect(page.getByText("No word fixes yet.")).toBeVisible();
  await page.getByRole("button", { name: "Add a word" }).click();
  await page.getByLabel("Word 1 heard as").fill("chowder");
  await page.getByLabel("Word 1 written as").fill("Chowderr");
  await page.getByRole("button", { name: "Add a word" }).click();
  await page.getByLabel("Word 2 heard as").fill("otaku");
  await page.getByLabel("Word 2 written as").fill("Otaku Solutions");

  // A style of the team's own, started from Karaoke. The words typed on the other tab wait.
  await tab(page, "Styles");
  await page.getByRole("button", { name: "Karaoke, built in" }).click();
  await page.getByRole("button", { name: "Make a copy to change" }).click();
  const editor = page.getByRole("group", { name: "Change Karaoke copy" });
  await expect(editor).toBeVisible();
  await editor.getByLabel("Name").fill("Night Shift");
  await editor.getByLabel("Name").blur();
  const ours = page.getByRole("group", { name: "Change Night Shift" });
  await ours.getByRole("textbox", { name: "Highlight colour", exact: true }).fill("#FF4FA3");
  await ours.getByRole("radio", { name: "Bottom" }).click();
  await ours.getByRole("switch", { name: "All capitals" }).click();

  // Vertical videos get it; wide keeps the built-in choice.
  await tab(page, "Style For Each Shape");
  await page.getByRole("combobox", { name: "Vertical videos" }).click();
  await page.getByRole("option", { name: "Night Shift" }).click();
  await expect(page.getByRole("combobox", { name: "Wide videos" })).toHaveText("Clean");

  await save.click();
  await expect(page.getByText("Captions saved.")).toBeVisible();

  // A reload stays on the open tab, and everything was kept.
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Vertical videos" })).toHaveText("Night Shift");
  await tab(page, "Word Fixes");
  await expect(page.getByLabel("Word 2 written as")).toHaveValue("Otaku Solutions");
  await tab(page, "Styles");
  await expect(page.getByRole("button", { name: "Night Shift", exact: true })).toBeVisible();
  if (process.env.RECORD === "1") {
    await page.screenshot({ path: "test-results/captions-settings.png", fullPage: true });
  }

  // A caption step says what it will use, and can pick one style for every video.
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
  const style = panel.getByRole("combobox", { name: "Caption style" });
  await expect(style).toHaveText("Match the video's shape");
  await expect(
    panel.getByText(/Vertical: Night Shift · Wide: Clean · Square: Bold highlight/),
  ).toBeVisible();
  await expect(panel.getByText(/2 words your team fixes in every caption/)).toBeVisible();

  await style.click();
  await page.getByRole("option", { name: "One word" }).click();
  await expect(style).toHaveText("One word");
  await expect(panel.getByText("Used on every video, whatever its shape.")).toBeVisible();
});
