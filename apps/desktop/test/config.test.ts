// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const read = (path: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../src-tauri/${path}`, import.meta.url)), "utf8"));

describe("what the Kontifi pages may do inside the app", () => {
  const capability = read("capabilities/default.json");

  test("gives remote sites no access to the app's commands", () => {
    // A "remote" entry would let the Kontifi site (or anything it loads) call into the app.
    expect(capability.remote).toBeUndefined();
    expect(capability.windows).toEqual(["main"]);
  });

  test("allows only the Connect screen's own commands", () => {
    expect(capability.permissions).toEqual([
      "core:default",
      "allow-saved-kontifis",
      "allow-forget-kontifi",
      "allow-open-kontifi",
    ]);
  });
});

describe("the app's details", () => {
  const config = read("tauri.conf.json");

  test("is named Kontifi with the motto, under the AGPL", () => {
    expect(config.productName).toBe("Kontifi");
    expect(config.bundle.shortDescription).toBe("Your content, social media ready.");
    expect(config.bundle.license).toBe("AGPL-3.0-or-later");
  });

  test("keeps a strict content policy on its own pages", () => {
    expect(config.app.security.csp).toContain("default-src 'self'");
  });
});
