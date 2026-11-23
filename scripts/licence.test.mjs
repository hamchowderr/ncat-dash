// Takewon is AGPL-3.0-or-later. Keeps the licence file and every package's
// licence field in step, so a package never says something the LICENSE doesn't.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");

test("LICENSE is the AGPL, version 3", () => {
  const text = read("LICENSE");
  assert.match(text, /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3, 19 November 2007/);
  assert.match(text, /13\. Remote Network Interaction; Use with the GNU General Public License\./);
  assert.doesNotMatch(text, /GNU GENERAL PUBLIC LICENSE\s+Version 2/);
});

test("every package.json says AGPL-3.0-or-later", () => {
  const files = [
    "package.json",
    ...readdirSync(join(root, "packages")).map((name) => `packages/${name}/package.json`),
  ];
  for (const file of files) {
    assert.equal(JSON.parse(read(file)).license, "AGPL-3.0-or-later", file);
  }
});

test("README names the same licence and the NOTICE", () => {
  const licence = read("README.md").split("## Licence")[1] ?? "";
  assert.match(licence, /AGPL-3\.0-or-later/);
  assert.match(licence, /\[NOTICE\]\(NOTICE\)/);
  assert.match(read("NOTICE"), /AGPL|Affero/);
});
