import { expect, test } from "./test";

// The layout and editing steps, in a real browser: the card template, intro and outro are
// set once in Settings, and the ready-mades built on them say those come from there.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";
// The stand-in bucket: every .jpg is a still, every other name a short clip.
const FILES = "http://127.0.0.1:8766";
const slow = (ms: number) =>
  process.env.SLOW ? new Promise((done) => setTimeout(done, ms)) : null;

test("brand files are set once, and the editing ready-mades take them from Settings", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Ana Moreno");
  await page.locator("#email").fill(`ana.${stamp}@example.test`);
  await page.locator("#password").fill("editing-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Moreno Studio");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  // Brand: a card template, an intro and an outro, once.
  await page.goto("/settings/brand");
  await expect(page.getByText("Card template", { exact: true })).toBeVisible();
  await slow(1200);
  await page.locator("#brand-color").fill("#E4572E");
  await page.getByLabel("Card template: address of the file").fill(`${FILES}/brand/card.jpg`);
  await slow(600);
  await page.getByLabel("Intro: address of the file").fill(`${FILES}/brand/intro.mp4`);
  await slow(600);
  await page.getByLabel("Outro: address of the file").fill(`${FILES}/brand/outro.mp4`);
  await slow(800);
  await page.getByRole("button", { name: "Save brand" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await slow(1500);

  // The new ready-mades sit in the one list with the rest.
  await page.goto("/automations/new");
  await page.getByLabel("Find a ready-made automation").fill("picture in picture");
  await expect(page.getByText("Picture in picture", { exact: true }).first()).toBeVisible();
  await slow(1500);
  await page.getByLabel("Find a ready-made automation").fill("green screen");
  await slow(1500);
  await page.getByLabel("Find a ready-made automation").fill("podcast");
  await expect(page.getByText("Podcast package", { exact: true })).toBeVisible();
  await slow(1500);
  await page.getByText("Podcast package", { exact: true }).click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  const steps = page.locator(".react-flow__node-step");
  await expect(steps).toHaveCount(4);
  await slow(1500);

  // The intro and outro step asks for nothing: both come from Settings.
  await steps.first().click();
  const handled = page.getByText("Handled for you");
  await expect(handled).toBeVisible();
  await expect(page.getByText(/your team's intro/i).first()).toBeVisible();
  await slow(2500);

  // Thumbnail choices: the title comes from the file's name, in the brand's band.
  await page.goto("/automations/new");
  await page.getByLabel("Find a ready-made automation").fill("thumbnail choices");
  await slow(1200);
  await page.getByText("Thumbnail choices with your title", { exact: true }).click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  await expect(steps).toHaveCount(2);
  await slow(1200);
  await steps.nth(1).click();
  await expect(page.getByText("the name of the file that started the run").first()).toBeVisible();
  await slow(2500);
});
