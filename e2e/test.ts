import { type BrowserContext, type Locator, test as base, type Page } from "@playwright/test";

export { type Browser, expect, type Locator, type Page } from "@playwright/test";

/** The specs that walk the tours, where a card must stay open. */
const WALKS = /[/\\](tour|calendar-tour|page-tours|content-goals)\.spec\.ts$/;

async function closeToursOn(page: Page) {
  const card = page.locator("[data-tour-card]");
  await page.addLocatorHandler(card, async () => {
    // Dispatched, not clicked: a dialog the spec opened just before can sit over the card.
    await card.getByRole("button", { name: "Close the tour" }).dispatchEvent("click");
  });
}

function watch(context: BrowserContext) {
  context.on("page", (page) => void closeToursOn(page));
  return Promise.all(context.pages().map(closeToursOn));
}

/** Whether the spec running now walks a tour. Outside a test or hook, it does not. */
function walkingATour() {
  try {
    return WALKS.test(base.info().file);
  } catch {
    return false;
  }
}

/**
 * Playwright's `test`, with the guided tours closed whenever one shows, in every page a
 * spec opens, its own browser contexts too (made in a `beforeAll` as well). Each page tour
 * starts on someone's first visit, and the people these specs sign up are always new, so
 * a card would otherwise sit in front of what a spec is about. The browser is shared by
 * the whole worker, so the specs that walk the tours (WALKS) are left alone.
 */
export const test = base.extend<{ closeTours: void }, { watchContexts: void }>({
  watchContexts: [
    async ({ browser }, provide) => {
      const newContext = browser.newContext;
      browser.newContext = async (...args) => {
        const created = await newContext.apply(browser, args);
        if (!walkingATour()) await watch(created);
        return created;
      };
      await provide();
      browser.newContext = newContext;
    },
    { scope: "worker", auto: true },
  ],
  closeTours: [
    async ({ context }, provide) => {
      await watch(context);
      await provide();
    },
    { auto: true },
  ],
});

/** Picks a choice from one of the app's pick lists: opens it, then clicks the option. */
export async function pick(list: Locator, option: string) {
  await list.click();
  await list.page().getByRole("option", { name: option, exact: true }).click();
}
