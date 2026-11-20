import { expect, type Page, test } from "./test";

// Nothing in the app is drawn on top of anything else: the steps you can add, a step's
// settings and the agent each take their own column beside the canvas, and the canvas's
// own buttons sit in a strip above it. Checked at a small laptop and a large desktop size.

const stamp = Date.now().toString(36);
const SIZES = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];

/** Every visible control and heading whose own spot is covered by something else. */
async function covered(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()} "${((el as HTMLElement).innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30)}"`;
    const items = document.querySelectorAll(
      'button, a[href], input, textarea, [role="switch"], [role="tab"], h1, h2, h3, .react-flow__node',
    );
    for (const el of items) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) continue;
      if (el.closest("[inert], [aria-hidden=true], nextjs-portal")) continue;
      // Scrolled out of its own box: not on screen.
      let hidden = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(s.overflow + s.overflowX + s.overflowY)) {
          const pr = p.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          if (cx < pr.left || cx > pr.right || cy < pr.top || cy > pr.bottom) hidden = true;
        }
      }
      if (hidden) continue;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
      if (hit.closest("nextjs-portal")) continue;
      const node = el.closest(".react-flow__node");
      if (node && hit.closest(".react-flow__node") === node) continue;
      if (hit.closest(".react-flow__edges")) continue;
      if (el instanceof HTMLLabelElement && el.control?.contains(hit)) continue;
      out.push(`${name(el)} is under ${name(hit)}`);
    }
    if (document.scrollingElement!.scrollWidth > innerWidth + 1)
      out.push("the page scrolls sideways");
    return out;
  });
}

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} is not on screen`);
  return b;
}

test("panels sit beside the canvas, never on top of it", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rae Okafor");
  await page.locator("#email").fill(`rae.${stamp}@example.test`);
  await page.locator("#password").fill("layout-e2e-12345");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Layout Shop");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Do You Have A Toolkit?" })).toBeVisible();

  await page.goto("/automations");
  await page
    .getByLabel("Automation file to import")
    .setInputFiles("e2e/fixtures/weekly-clips.automation.json");
  await expect(page).toHaveURL(/\/automations\/[a-z0-9]+$/, { timeout: 30_000 });
  const editor = page.url();

  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.goto(editor);
    await expect(page.locator(".react-flow__node").first()).toBeVisible();
    await page.waitForTimeout(800);

    // The editor fits the window: the page itself does not scroll.
    const frame = page.locator("[data-page-frame]");
    expect(await frame.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    expect(await covered(page), `editor at ${size.width}`).toEqual([]);

    // The steps you can add open as a column that moves the canvas over.
    await page.getByRole("button", { name: "Add step" }).click();
    const palette = page.getByRole("complementary", { name: "Steps you can add" });
    await expect(palette.getByRole("textbox")).toBeFocused();
    await page.waitForTimeout(500);
    const side = await box(page, 'aside[aria-label="Steps you can add"]');
    const canvas = await box(page, "[data-testid=canvas]");
    expect(canvas.x).toBeGreaterThanOrEqual(side.x + side.width - 1);
    expect(await covered(page), `palette at ${size.width}`).toEqual([]);
    await page.getByRole("button", { name: "Add step" }).click();
    await expect(page.locator('aside[aria-label="Steps you can add"]')).toHaveAttribute(
      "aria-hidden",
      "true",
    );

    // A step's settings take the column on the other side.
    await page.locator(".react-flow__node").filter({ hasText: "Split" }).first().click();
    await page.waitForTimeout(500);
    const settings = await box(page, 'aside[aria-label="Settings for this step"]');
    const narrowed = await box(page, "[data-testid=canvas]");
    expect(narrowed.x + narrowed.width).toBeLessThanOrEqual(settings.x + 1);
    expect(await covered(page), `step settings at ${size.width}`).toEqual([]);

    // Closed, the agent takes no room: its robot sits in the bar along the top, inside the
    // page, the mirror of the menu's button. It opens beside the page, and the notices stay
    // clear of it.
    const robot = page.locator("header").getByRole("button", { name: "Open the agent" });
    await expect(robot).toBeVisible();
    const pageFrame = await box(page, "[data-page-frame]");
    const robotBox = (await robot.boundingBox())!;
    expect(robotBox.x + robotBox.width).toBeLessThanOrEqual(pageFrame.x + pageFrame.width + 1);
    await expect(page.getByRole("complementary", { name: "Agent" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Agent", exact: true })).toHaveCount(0);
    await robot.click();
    const agent = page.getByRole("complementary", { name: "Agent" });
    await expect(agent).toBeVisible();
    await page.waitForTimeout(500);
    const agentBox = (await agent.boundingBox())!;
    const page_ = await box(page, "[data-page-frame]");
    expect(page_.x + page_.width).toBeLessThanOrEqual(agentBox.x + 1);
    expect(await covered(page), `agent at ${size.width}`).toEqual([]);
    await agent.getByRole("button", { name: /Close/ }).click();
    await expect(robot).toBeVisible();
    // Cmd/Ctrl+J opens and closes it from the keyboard.
    await page.keyboard.press("ControlOrMeta+j");
    await expect(agent.getByRole("button", { name: /Close the agent/ })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+j");
    await expect(robot).toBeVisible();
  }

  // On a screen too narrow for a column beside the page, the agent takes the page's place
  // instead of lying over it, and closing it brings the page back.
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto(editor);
  const agent = page.getByRole("complementary", { name: "Agent" });
  await page.locator("header").getByRole("button", { name: "Open the agent" }).click();
  await expect(agent).toBeVisible();
  await expect(page.locator("[data-page-frame]")).toBeHidden();
  expect(await covered(page), "agent on a narrow screen").toEqual([]);
  await agent.getByRole("button", { name: /Close/ }).click();
  await expect(page.locator("[data-page-frame]")).toBeVisible();

  // Starting an automation is a page of its own, not a window over the list.
  await page.setViewportSize(SIZES[0]);
  await page.goto("/automations");
  // This page's own tour starts on a first visit; the check is of the page under it. The
  // spec's tour closer is set aside here, or it can close the card before it is seen when
  // the tour starts quickly.
  const card = page.locator("[data-tour-card]");
  await page.removeLocatorHandler(card);
  await page.getByRole("link", { name: "New automation", exact: true }).click();
  await expect(page).toHaveURL(/\/automations\/new$/);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Close the tour" }).dispatchEvent("click");
  await expect(card).toHaveCount(0);
  // Closing the tour takes its spotlight with it.
  await expect(page.locator("[data-tour-overlay]")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await covered(page), "new automation page").toEqual([]);
});

test("settings open from the team menu and swap the sidebar for their own menu, like Linear", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Ines Moreau");
  await page.locator("#email").fill(`ines.${stamp}@example.test`);
  await page.locator("#password").fill("layout-e2e-12345");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Wide Shop");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Do You Have A Toolkit?" })).toBeVisible();

  // Old addresses still land on the right page.
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/brand$/);
  await page.goto("/settings#notifications");
  await expect(page).toHaveURL(/\/settings\/notifications$/);
  await page.goto("/settings/chat");
  await expect(page).toHaveURL(/\/settings\/slack$/);
  // A Discord sign-in that returns to the old address lands on the Discord page, which reads
  // how it went and then tidies the address.
  await page.goto("/settings/chat?discord=taken");
  await expect(page).toHaveURL(/\/settings\/discord(\?discord=taken)?$/);
  await expect(page.getByRole("heading", { level: 1, name: "Discord" })).toBeVisible();

  // Settings are not an everyday page: the main menu leaves them out, and the team's menu
  // opens them.
  await page.goto("/uploads");
  const sidebar = page.locator("[data-sidebar=sidebar]").first();
  await expect(sidebar.getByRole("link", { name: "Uploads" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Wide Shop menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings\/brand$/);

  // The sidebar is now the settings menu, and the word "Settings" is not repeated around
  // the page: the page is titled by what it holds.
  const menu = page.getByRole("navigation", { name: "Settings" });
  await expect(menu.getByRole("link", { name: "Brand" })).toHaveAttribute("aria-current", "page");
  await expect(sidebar.getByRole("link", { name: "Uploads" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Brand" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Settings" })).toHaveCount(0);
  await expect(page.locator("header").getByText("Settings", { exact: true })).toHaveCount(0);

  for (const size of [{ width: 1440, height: 900 }, ...SIZES]) {
    await page.setViewportSize(size);
    await page.goto("/settings/brand");
    await expect(page.getByRole("heading", { level: 1, name: "Brand" })).toBeVisible();
    await page.waitForTimeout(400);
    const frame = await box(page, "[data-page-frame]");
    const block = await box(page, "[data-settings]");
    // One calm column, centred, with no grey cards or boxes around the settings.
    const left = block.x - frame.x;
    const right = frame.x + frame.width - (block.x + block.width);
    expect(Math.abs(left - right), `centred at ${size.width}`).toBeLessThanOrEqual(24);
    expect(block.width).toBeLessThanOrEqual(680);
    await expect(page.locator("[data-settings] [data-slot=card]")).toHaveCount(0);
    expect(await covered(page), `settings at ${size.width}`).toEqual([]);
  }

  // Each menu entry opens its own page and is marked as the one open.
  await menu.getByRole("link", { name: "Members" }).click();
  await expect(page).toHaveURL(/\/settings\/team$/);
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
  await expect(menu.locator("[aria-current=page]")).toHaveText("Members");

  // "Back to app" returns to the page you came from.
  await page.getByRole("link", { name: "Back to app" }).click();
  await expect(page).toHaveURL(/\/uploads$/);
  await expect(sidebar.getByRole("link", { name: "Uploads" })).toBeVisible();
});
