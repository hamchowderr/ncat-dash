import { type BrowserContext, test as base, type Page } from "@playwright/test";

export { type Browser, expect, type Locator, type Page } from "@playwright/test";

async function closeToursOn(page: Page) {
  const card = page.locator("[data-tour-card]");
  await page.addLocatorHandler(card, async () => {
    await card.getByRole("button", { name: "Close the tour" }).click();
  });
}

function watch(context: BrowserContext) {
  context.on("page", (page) => void closeToursOn(page));
  return Promise.all(context.pages().map(closeToursOn));
}

/**
 * Playwright's `test`, with the guided tours closed whenever one shows, in every page a
 * spec opens (its own browser contexts too). Each page tour starts on someone's first
 * visit, and the people these specs sign up are always new, so a card would otherwise sit
 * in front of what a spec is about. The specs that walk the tours (tour, calendar-tour,
 * page-tours, content-goals) use Playwright's own `test` instead.
 */
export const test = base.extend<{ closeTours: void }>({
  closeTours: [
    async ({ browser, context }, provide) => {
      // The browser is shared by every spec in the worker, the tour walks too, so its
      // newContext is only wrapped while this spec runs.
      const newContext = browser.newContext;
      browser.newContext = async (...args) => {
        const created = await newContext.apply(browser, args);
        await watch(created);
        return created;
      };
      await watch(context);
      try {
        await provide();
      } finally {
        browser.newContext = newContext;
      }
    },
    { auto: true },
  ],
});
