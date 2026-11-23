import { expect, test } from "./test";

// The headers in src/lib/security-headers.ts reach the browser on real pages.
test("pages can't be framed by another site and send the security headers", async ({ page }) => {
  const response = await page.goto("/sign-in");
  const headers = response!.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
});
