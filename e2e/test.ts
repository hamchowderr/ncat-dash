import { type Browser, type BrowserContext, test as base, type Page } from "@playwright/test";

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

const watched = new WeakSet<Browser>();

/**
 * Playwright's `test`, with the guided tours closed whenever one shows, in every page a
 * spec opens (its own browser contexts too). Each page tour starts on someone's first
 * visit, and the people these specs sign up are always new, so a card would otherwise sit
 * in front of what a spec is about. The specs that walk the tours (tour, calendar-tour,
 * page-tours, content-goals) use Playwright's own `test` instead.
 */
export const test = base.extend<{ closeTours: void }>({
  closeTours: [
    async ({ browser, context }, use) => {
      if (!watched.has(browser)) {
        watched.add(browser);
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async (...args) => {
          const created = await newContext(...args);
          await watch(created);
          return created;
        };
      }
      await watch(context);
      await use();
    },
    { auto: true },
  ],
});
