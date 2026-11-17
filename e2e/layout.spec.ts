import { expect, type Page, test } from "@playwright/test";

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
  await expect(page.locator("#baseUrl")).toBeVisible();

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

    // The agent opens beside the page, and the notices stay clear of it.
    await page.getByRole("button", { name: "Agent" }).click();
    const agent = page.getByRole("complementary", { name: "Agent" });
    await expect(agent).toBeVisible();
    await page.waitForTimeout(500);
    const agentBox = (await agent.boundingBox())!;
    const page_ = await box(page, "[data-page-frame]");
    expect(page_.x + page_.width).toBeLessThanOrEqual(agentBox.x + 1);
    expect(await covered(page), `agent at ${size.width}`).toEqual([]);
    await agent.getByRole("button", { name: /Close/ }).click();
    await expect(agent).toBeHidden();
  }
});
