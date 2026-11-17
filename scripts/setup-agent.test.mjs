import assert from "node:assert/strict";
import { test } from "node:test";
import { readEnv, setEnv } from "./setup-agent.mjs";

test("reads values, quoted or not, and the last one wins", () => {
  assert.deepEqual(readEnv('A=1\n# B=2\nC="three"\nA=4\nEMPTY=\n'), {
    A: "4",
    C: "three",
    EMPTY: "",
  });
});

test("sets a value in place, fills a blank or commented line, or adds it", () => {
  assert.equal(setEnv("A=1\nB=2\n", "A", "x"), "A=x\nB=2\n");
  assert.equal(
    setEnv("# note\nMASTRA_JWT_SECRET=\n", "MASTRA_JWT_SECRET", "s"),
    "# note\nMASTRA_JWT_SECRET=s\n",
  );
  assert.equal(
    setEnv("# TURSO_DATABASE_URL=\n", "TURSO_DATABASE_URL", "f"),
    "TURSO_DATABASE_URL=f\n",
  );
  assert.equal(setEnv("A=1", "B", "2"), "A=1\nB=2\n");
  assert.equal(setEnv("", "B", "2"), "B=2\n");
});

test("a value with $ or slashes is written as it is", () => {
  assert.equal(setEnv("K=\n", "K", "a/b+c$&1=="), "K=a/b+c$&1==\n");
});
