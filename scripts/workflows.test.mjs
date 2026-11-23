// Keeps the GitHub workflows safe to run. Run with `node --test` (part of `pnpm test`).
//
// - Every workflow starts from read-only permissions; a job that publishes asks for more itself.
// - Every action is pinned to a commit, so a moved tag can't change what runs with our secrets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows");
const workflows = readdirSync(dir).filter((file) => /\.ya?ml$/.test(file));

test("there are workflows to check", () => assert.ok(workflows.length > 0));

for (const file of workflows) {
  const text = readFileSync(join(dir, file), "utf8");

  test(`${file} starts from read-only permissions`, () => {
    assert.match(text, /^permissions:\n {2}contents: read$/m);
  });

  test(`${file} pins every action to a commit`, () => {
    const uses = [...text.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1]);
    for (const ref of uses) assert.match(ref, /@[0-9a-f]{40}$/, `${ref} is not pinned`);
  });

  test(`${file} names the Rust toolchain wherever it is pinned`, () => {
    const steps = text.split(/\n\s*- /).filter((step) => step.includes("dtolnay/rust-toolchain@"));
    for (const step of steps) assert.match(step, /toolchain: stable/);
  });
}
