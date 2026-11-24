// The browser tests split across CI machines (scripts/e2e-shard.mjs). Run with `node --test`
// (part of `pnpm test`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readTimings, specFiles, split } from "./e2e-shard.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ci = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
const machines = Number(ci.match(/E2E_MACHINES: (\d+)/)?.[1]);

test("CI names how many machines the browser tests use, and lists each", () => {
  assert.ok(machines >= 2, "E2E_MACHINES is set in ci.yml");
  const listed = ci
    .match(/shard: \[([\d, ]+)\]/)?.[1]
    .split(",")
    .map(Number);
  assert.deepEqual(
    listed,
    Array.from({ length: machines }, (_, i) => i + 1),
  );
});

test("every browser test file runs on exactly one machine", () => {
  const files = specFiles();
  assert.ok(files.length > 0);
  const piles = split(files, readTimings(), machines);
  const placed = piles.flatMap((pile) => pile.files).sort();
  assert.deepEqual(placed, files);
});

test("the machines get about the same amount to do", () => {
  const piles = split(specFiles(), readTimings(), machines);
  const longestFile = Math.max(...Object.values(readTimings()));
  const seconds = piles.map((pile) => pile.seconds);
  // No machine waits on another by more than the longest single file.
  assert.ok(Math.max(...seconds) - Math.min(...seconds) <= longestFile, seconds.join(", "));
});

test("a file not timed yet counts as an average one", () => {
  const piles = split(
    ["a.spec.ts", "b.spec.ts", "new.spec.ts"],
    { "a.spec.ts": 10, "b.spec.ts": 30 },
    2,
  );
  assert.deepEqual(piles, [
    { seconds: 30, files: ["b.spec.ts"] },
    { seconds: 30, files: ["a.spec.ts", "new.spec.ts"] },
  ]);
});

test("the longest file goes first and the split is the same every time", () => {
  const timings = { "a.spec.ts": 5, "b.spec.ts": 50, "c.spec.ts": 20, "d.spec.ts": 20 };
  const once = split(Object.keys(timings), timings, 2);
  assert.deepEqual(once, [
    { seconds: 50, files: ["b.spec.ts"] },
    { seconds: 45, files: ["a.spec.ts", "c.spec.ts", "d.spec.ts"] },
  ]);
  assert.deepEqual(split(Object.keys(timings).reverse(), timings, 2), once);
});

test("the timings only name test files that exist", () => {
  const files = new Set(specFiles());
  for (const name of Object.keys(readTimings())) assert.ok(files.has(name), `${name} is gone`);
});

test("the command prints one machine's files and refuses a machine that isn't there", () => {
  const out = execFileSync("node", ["scripts/e2e-shard.mjs", "1", String(machines)], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const lines = out.trim().split("\n");
  assert.ok(lines.length > 0 && lines.every((line) => /^e2e\/.+\.spec\.ts$/.test(line)));
  assert.throws(() =>
    execFileSync("node", ["scripts/e2e-shard.mjs", "0", "3"], { cwd: root, stdio: "ignore" }),
  );
});
