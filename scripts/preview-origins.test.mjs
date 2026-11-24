// Run with `node --test` (part of `pnpm test`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withOrigins } from "./preview-origins.mjs";

const PREVIEWS = "https://takewon-*-otaku-solutions.vercel.app";

test("adds the previews' pattern after what is there", () => {
  assert.equal(
    withOrigins("https://ncat-dash-preview-*-otaku-solutions.vercel.app", [PREVIEWS]),
    `https://ncat-dash-preview-*-otaku-solutions.vercel.app,${PREVIEWS}`,
  );
});

test("sets it when nothing is there", () => {
  assert.equal(withOrigins("", [PREVIEWS]), PREVIEWS);
  assert.equal(withOrigins(undefined, [PREVIEWS]), PREVIEWS);
});

test("changes nothing when it is already there", () => {
  assert.equal(withOrigins(` https://a.example , ${PREVIEWS}`, [PREVIEWS]), null);
});

test("the Preview backend workflow lets the Takewon previews sign in", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/convex-preview.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    workflow,
    /node scripts\/preview-origins\.mjs "https:\/\/takewon-\*-otaku-solutions\.vercel\.app"/,
  );
});
