#!/usr/bin/env node
// Lets Vercel preview builds sign in to the preview Convex: adds their address pattern to
// its TRUSTED_ORIGINS, keeping whatever is there already. Run by the Preview backend
// workflow after it pushes the functions, with CONVEX_SELF_HOSTED_URL and
// CONVEX_SELF_HOSTED_ADMIN_KEY set.
//
//   node scripts/preview-origins.mjs "https://takewon-app-*-otaku-solutions.vercel.app"
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** The comma-separated list with each wanted origin added once, or null if none is new. */
export function withOrigins(current, wanted) {
  const have = (current ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const missing = wanted.filter((origin) => !have.includes(origin));
  if (missing.length === 0) return null;
  return [...have, ...missing].join(",");
}

function convex(args) {
  return execFileSync("pnpm", ["exec", "convex", ...args], { encoding: "utf8" });
}

function main(wanted) {
  if (wanted.length === 0) throw new Error("Name at least one origin.");
  let current = "";
  try {
    current = convex(["env", "get", "TRUSTED_ORIGINS"]).trim();
  } catch {
    // Not set yet.
  }
  const next = withOrigins(current, wanted);
  if (next === null) {
    console.log("TRUSTED_ORIGINS already lets the previews sign in.");
    return;
  }
  convex(["env", "set", "TRUSTED_ORIGINS", next]);
  console.log(`TRUSTED_ORIGINS is now ${next}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
