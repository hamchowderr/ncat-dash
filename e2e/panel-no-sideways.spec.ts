import { expect, type Page, test } from "./test";

// The automation editor never scrolls sideways: not the page, not the list of steps, not
// the canvas's frame and not a step's settings, for every kind of step, at the window
// sizes people use. A step's settings once spilled past the column's edge when a scroll
// bar took up room, which left a sideways scroll bar and cut off the right side.

const stamp = Date.now().toString(36);
test.use({ actionTimeout: 20_000 });

/** Every box in the editor that can be scrolled sideways, and by how much. */
async function sideways(page: Page) {
  return page.evaluate(() => {
    const found: string[] = [];
    const doc = document.scrollingElement!;
    if (doc.scrollWidth > doc.clientWidth + 1)
      found.push(`the page, by ${doc.scrollWidth - doc.clientWidth}px`);
    const editor = document.querySelector('[role="tabpanel"]');
    for (const el of editor ? editor.querySelectorAll("*") : []) {
      if (!(el instanceof HTMLElement) || el.closest(".react-flow__viewport")) continue;
      const { overflowX } = getComputedStyle(el);
      if (overflowX !== "auto" && overflowX !== "scroll") continue;
      if (el.scrollWidth > el.clientWidth + 1)
        found.push(
          `${el.getAttribute("aria-label") ?? el.tagName.toLowerCase()} (${el.className.slice(0, 60)}), by ${el.scrollWidth - el.clientWidth}px`,
        );
    }
    // Nothing in a step's settings reaches past its right edge, where it would be cut off.
    const panel = document.querySelector('[aria-label="Settings for this step"]');
    if (panel) {
      const edge = panel.getBoundingClientRect().right;
      for (const el of panel.querySelectorAll("button, input, label, p, h2, h3, li")) {
        const box = el.getBoundingClientRect();
        if (box.width > 0 && box.right > edge + 1)
          found.push(
            `"${(el.textContent ?? "").trim().slice(0, 40)}" runs ${Math.round(box.right - edge)}px past the edge`,
          );
      }
    }
    return found;
  });
}

async function openSettings(page: Page) {
  const more = page.getByRole("button", { name: "More options" });
  if ((await more.count()) > 0 && (await more.getAttribute("aria-expanded")) !== "true")
    await more.click();
}

test("no part of the automation editor scrolls sideways, for any step, at any window size", async ({
  page,
}) => {
  test.setTimeout(900_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/sign-up");
  await page.locator("#name").fill("Noor Haddad");
  await page.locator("#email").fill(`noor.${stamp}@example.test`);
  await page.locator("#password").fill("no-sideways-e2e-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Haddad Media");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Do You Have A Toolkit?" })).toBeVisible();

  await page.goto("/automations");
  await page.getByRole("link", { name: "New automation", exact: true }).click();
  await page.getByRole("button", { name: "Empty canvas" }).first().click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });

  const palette = page.getByRole("complementary", { name: "Steps you can add" });
  const panel = page.getByRole("complementary", { name: "Settings for this step" });
  await page.getByRole("button", { name: "Add step" }).click();
  // Opens the list of steps unless it is open already (the button closes an open list).
  const openList = async () => {
    if (!(await palette.isVisible()) || (await page.getByLabel("Search steps").isHidden()))
      await page.getByRole("button", { name: "Add step" }).click();
    await expect(page.getByLabel("Search steps")).toBeVisible();
  };
  const names = (await palette.getByRole("button").allTextContents())
    .map((name) => name.trim())
    .filter((name) => name && name !== "Close the list of steps");
  expect(names.length).toBeGreaterThan(40);

  // Every kind of step, one at a time, with its extra settings open.
  const problems: string[] = [];
  for (const name of names) {
    await openList();
    await page.getByLabel("Search steps").fill(name);
    await palette.getByRole("button", { name, exact: true }).first().click();
    await expect(panel).toBeVisible();
    await openSettings(page);
    await page.waitForTimeout(350); // the column finishes opening
    for (const problem of await sideways(page)) problems.push(`${name}: ${problem}`);
    await panel.getByRole("button", { name: "Remove step" }).click();
    await expect(page.locator(".react-flow__node-step")).toHaveCount(0);
  }
  expect(problems).toEqual([]);

  // The step in the report, and one with a long list of choices, at other window sizes.
  for (const name of ["Fit with a blurred background", "Clips for a platform"]) {
    await openList();
    await page.getByLabel("Search steps").fill(name);
    await palette.getByRole("button", { name, exact: true }).first().click();
  }
  const sizes = [
    { width: 1024, height: 700 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 390, height: 844 },
  ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    for (const title of ["Fit with a blurred background", "Clips for a platform"]) {
      await page.locator(".react-flow__node-step", { hasText: title }).click();
      await expect(panel).toBeVisible();
      await openSettings(page);
      await page.waitForTimeout(350);
      for (const problem of await sideways(page))
        problems.push(`${size.width}x${size.height} ${title}: ${problem}`);
    }
    // The trigger's settings too.
    await page.locator(".react-flow__node-trigger").click();
    await expect(panel).toBeVisible();
    await page.waitForTimeout(350);
    for (const problem of await sideways(page))
      problems.push(`${size.width}x${size.height} trigger: ${problem}`);
    // With the list of steps open beside the settings as well.
    await openList();
    await page.waitForTimeout(350);
    for (const problem of await sideways(page))
      problems.push(`${size.width}x${size.height} with the list open: ${problem}`);
  }
  expect(problems).toEqual([]);
});
