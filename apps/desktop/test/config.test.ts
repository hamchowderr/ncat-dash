// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const read = (path: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../src-tauri/${path}`, import.meta.url)), "utf8"));

describe("what the dashboard's pages may do inside the app", () => {
  const capability = read("capabilities/default.json");

  test("gives remote sites no access to the app's commands", () => {
    // A "remote" entry would let the dashboard site (or anything it loads) call into the app.
    expect(capability.remote).toBeUndefined();
    expect(capability.windows).toEqual(["main"]);
  });

  test("allows only the app's own screens' commands", () => {
    expect(capability.permissions).toEqual([
      "core:default",
      "allow-saved-servers",
      "allow-forget-server",
      "allow-open-server",
      "allow-check-machine",
      "allow-stack-saved",
      "allow-save-stack",
      "allow-run-stack-step",
    ]);
  });

  test("never lets the dashboard run or change the stack on this computer", () => {
    const dashboard = readFileSync(
      fileURLToPath(new URL("../src-tauri/src/dashboard.rs", import.meta.url)),
      "utf8",
    );
    for (const command of ["check-machine", "stack-saved", "save-stack", "run-stack-step"]) {
      expect(dashboard).not.toContain(command);
    }
  });
});

describe("the app's details", () => {
  const config = read("tauri.conf.json");

  test("takes its name from product.json, with the motto, under the AGPL", () => {
    // tauri.conf.json can't read product.json, so this keeps the two the same.
    const { name } = JSON.parse(
      readFileSync(fileURLToPath(new URL("../product.json", import.meta.url)), "utf8"),
    );
    expect(config.productName).toBe(name);
    expect(config.bundle.longDescription).toContain(name);
    expect(config.bundle.shortDescription).toBe("Your content, social media ready.");
    expect(config.bundle.license).toBe("AGPL-3.0-or-later");
  });

  test("keeps a strict content policy on its own pages", () => {
    expect(config.app.security.csp).toContain("default-src 'self'");
  });
});
