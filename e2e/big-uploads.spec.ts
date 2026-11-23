import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "./test";

// A big file goes up in parts in a real browser: the Uploads page sends it in 64 MiB pieces
// to the bucket, the pieces are put together, and the file shows as ready like any upload.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";
const MIB = 1024 * 1024;

test("a 150 MB file is sent in parts and shows up ready", async ({ page, request }) => {
  test.setTimeout(180_000);
  const file = join(mkdtempSync(join(tmpdir(), "ncat-dash-big-")), "Full Shoot.mp4");
  writeFileSync(file, Buffer.alloc(150 * MIB, 7));

  await page.goto("/sign-up");
  await page.locator("#name").fill("Lena Park");
  await page.locator("#email").fill(`lena.${stamp}@example.test`);
  await page.locator("#password").fill("big-uploads-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Park Studio");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({ timeout: 30_000 });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();

  await page.goto("/uploads");
  await page.getByLabel("Choose files to upload").setInputFiles(file);
  await expect(page.getByRole("button", { name: "Open Full Shoot.mp4" })).toBeVisible({
    timeout: 120_000,
  });

  // The bucket got three parts (64 + 64 + 22 MiB), joined into the whole file.
  const joined = (await (await request.get(`${TOOLKIT}/__stand-in/joined`)).json()) as Record<
    string,
    { parts: number; bytes: number }
  >;
  const mine = Object.entries(joined).find(([key]) => key.endsWith("/Full-Shoot.mp4"));
  expect(mine?.[1]).toEqual({ parts: 3, bytes: 150 * MIB });
});
