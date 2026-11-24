// Splits the browser tests (e2e/*.spec.ts) across CI machines so each takes about as long.
//
//   node scripts/e2e-shard.mjs <shard> <of>   prints that machine's test files, one a line
//
// Each file goes, longest first, to the machine with the least to do so far, by the seconds
// it took on CI (e2e/timings.json). A file not timed yet counts as an average one. Every
// file lands on exactly one machine, so nothing is left out. Playwright's own --shard splits
// by number of tests, which left one machine with the long editor tests and the others idle.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The spec files under e2e/, by name. */
export function specFiles(dir = join(root, "e2e")) {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".spec.ts"))
    .sort();
}

/** Seconds each file took on CI, by name. */
export function readTimings(file = join(root, "e2e", "timings.json")) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** The files for each of `count` machines: arrays of names, longest piles first. */
export function split(files, timings, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error(`Cannot split across ${count}.`);
  const known = files.map((file) => timings[file]).filter((seconds) => seconds > 0);
  const average = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  const weight = (file) => (timings[file] > 0 ? timings[file] : average);
  const piles = Array.from({ length: count }, () => ({ seconds: 0, files: [] }));
  const order = [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
  for (const file of order) {
    const lightest = piles.reduce((best, pile) => (pile.seconds < best.seconds ? pile : best));
    lightest.files.push(file);
    lightest.seconds += weight(file);
  }
  return piles.map((pile) => ({ seconds: Math.round(pile.seconds), files: pile.files.sort() }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [shard, of] = process.argv.slice(2).map(Number);
  if (!(shard >= 1 && shard <= of)) {
    console.error("Usage: node scripts/e2e-shard.mjs <shard> <of>, as in 2 5");
    process.exit(1);
  }
  const pile = split(specFiles(), readTimings(), of)[shard - 1];
  console.error(`Machine ${shard} of ${of}: ${pile.files.length} files, about ${pile.seconds}s.`);
  for (const file of pile.files) console.log(`e2e/${file}`);
}
