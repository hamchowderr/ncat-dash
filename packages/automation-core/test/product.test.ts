import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCT_NAME } from "../src";

// The product is called Kontifi. The engine underneath is still the NCA Toolkit, but the
// old working names for the product itself must not show up anywhere people read.
const ROOT = path.resolve(__dirname, "../../..");
const PLACES = ["src", "convex", "e2e", "packages/agent/src", "packages/email/src"];
const OLD_NAMES = [/NCA Toolkit Dashboard/, /NCA Dashboard/, /Welcome to Your Dashboard/];
const SKIP = new Set(["node_modules", "_generated", ".next", ".mastra"]);

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (/\.(tsx?|mjs|json|md)$/.test(name)) out.push(full);
  }
  return out;
}

describe("product name", () => {
  it("is Kontifi", () => {
    expect(PRODUCT_NAME).toBe("Kontifi");
  });

  it("leaves no old product name in the app, the agent or the emails", () => {
    const found: string[] = [];
    for (const place of PLACES) {
      for (const file of filesUnder(path.join(ROOT, place))) {
        const text = readFileSync(file, "utf8");
        for (const old of OLD_NAMES) {
          if (old.test(text)) found.push(`${path.relative(ROOT, file)}: ${old.source}`);
        }
      }
    }
    expect(found).toEqual([]);
  });
});
