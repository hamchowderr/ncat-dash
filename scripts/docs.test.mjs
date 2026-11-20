// Keeps the self-hosting docs true to the code. Run with `node --test` (part of `pnpm test`).
//
// - Every setting the dashboard, Convex or the agent's own code reads from the environment
//   is named in docs/self-hosting.md.
// - Every setting deploy/compose.yml reads is in deploy/.env.example.
// - Links between the docs point at files that exist.
// - The wording rules the docs must follow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

function filesUnder(dir, keep) {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    if (name === "node_modules" || name === "_generated" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) out.push(...filesUnder(path, keep));
    else if (keep(path)) out.push(path);
  }
  return out;
}

const isSource = (path) =>
  /\.(ts|tsx|mjs)$/.test(path) &&
  !/\.test\.(ts|tsx|mjs)$/.test(path) &&
  !/(^|\/)test[./]/.test(path);

/** Names read as process.env.NAME, env.NAME or env["NAME"]. */
export function settingsReadIn(source) {
  const names = new Set();
  for (const m of source.matchAll(
    /\b(?:process\.env|env)(?:\.([A-Z][A-Z0-9_]+)|\[["']([A-Z][A-Z0-9_]+)["']\])/g,
  )) {
    names.add(m[1] ?? m[2]);
  }
  return names;
}

// Read by the code but not something an operator sets: stand-in addresses the tests point
// at instead of the real service, and values the runtime provides.
const NOT_FOR_OPERATORS = [
  /_(API|AUTH|LOGIN|OAUTH|CONTENT|GRAPH|AUTHORIZE)_URL$/,
  /_STAND_IN_URL$/,
  /^NEXT_RUNTIME$/,
  /^NODE_ENV$/,
  /^UPDATE_PLUGIN_TABLES$/,
  /^(USE_AIMOCK|AIMOCK_URL)$/, // the agent's test stand-in model
  /^NEXT_PUBLIC_CONVEX_SITE_URL$/, // read by Convex code only as a local-dev fallback
];

// The agent server's settings from the chat kit it is built on are documented in
// packages/agent/.env.example; these are the ones docs/self-hosting.md must name.
const AGENT_SETTINGS = [
  "APP_SECRET",
  "MASTRA_JWT_SECRET",
  "CONVEX_URL",
  "CONVEX_SITE_URL",
  "CHAT_MODEL",
  "SIMPLE_CHAT_MODEL",
  "TURSO_DATABASE_URL",
];

test("every setting the code reads is named in docs/self-hosting.md", () => {
  const files = [
    ...filesUnder("convex", isSource),
    ...filesUnder("src", isSource),
    ...filesUnder("packages/agent/src/mastra/ncat", isSource),
  ];
  const wanted = new Set(AGENT_SETTINGS);
  for (const file of files) for (const name of settingsReadIn(read(file))) wanted.add(name);
  const guide = read("docs/self-hosting.md");
  const missing = [...wanted]
    .filter((name) => !NOT_FOR_OPERATORS.some((re) => re.test(name)))
    .filter((name) => !new RegExp(`\\b${name}\\b`).test(guide))
    .sort();
  assert.deepEqual(
    missing,
    [],
    `Add these to docs/self-hosting.md, Every Setting: ${missing.join(", ")}`,
  );
});

test("the agent server's example settings name every chat app setting it reads", () => {
  const example = read("packages/agent/.env.example");
  const env = read("packages/agent/src/lib/env.ts");
  const chat = [...env.matchAll(/^\s+((?:DISCORD|TELEGRAM|TEAMS)_[A-Z_]+):/gm)]
    .map((m) => m[1])
    .filter((name) => !name.endsWith("_API_URL"));
  assert.ok(chat.length >= 9, "expected the Discord, Telegram and Teams settings in env.ts");
  for (const name of chat)
    assert.match(
      example,
      new RegExp(`\\b${name}=`),
      `${name} is missing from packages/agent/.env.example`,
    );
});

test("every setting deploy/compose.yml reads is in deploy/.env.example", () => {
  const compose = read("deploy/compose.yml");
  const example = read("deploy/.env.example");
  const used = new Set([...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]));
  const required = new Set([...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g)].map((m) => m[1]));
  for (const name of required) {
    assert.match(
      example,
      new RegExp(`^${name}=`, "m"),
      `${name} is required by compose.yml; add it to deploy/.env.example`,
    );
  }
  // Optional ones (with a default) may be left out of the example only if they are images or tuning
  // the guide names.
  const guide = read("docs/self-hosting.md");
  for (const name of used) {
    if (required.has(name)) continue;
    assert.ok(
      new RegExp(`\\b${name}\\b`).test(example) || new RegExp(`\\b${name}\\b`).test(guide),
      `${name} is read by compose.yml but documented nowhere`,
    );
  }
});

test("compose never builds on the machine that runs it", () => {
  assert.doesNotMatch(read("deploy/compose.yml"), /^\s+build:/m);
});

const DOCS = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  ...filesUnder("docs", (p) => p.endsWith(".md")),
];

test("links between the docs point at files that exist", () => {
  const broken = [];
  for (const doc of DOCS) {
    const text = read(doc).replace(/```[\s\S]*?```/g, "");
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const path = join(dirname(join(root, doc)), decodeURIComponent(target.split("#")[0]));
      if (!existsSync(path)) broken.push(`${doc} -> ${target}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("the docs keep to the product's wording", () => {
  const files = ["README.md", "docs/self-hosting.md", "deploy/compose.yml", "deploy/.env.example"];
  for (const file of files) {
    const text = read(file);
    assert.doesNotMatch(
      text,
      /no server (is )?(required|needed)/i,
      `${file}: Kontifi always runs on a server`,
    );
    assert.doesNotMatch(
      text,
      /\bzapier\b|\bmake\.com\b|\bintegromat\b/i,
      `${file}: these cannot be used with the toolkit`,
    );
    assert.doesNotMatch(text, /\bNCA Dashboard\b/, `${file}: the product is Kontifi`);
    for (const m of text.matchAll(/[^.\n]*social media ready[^\n]*/gi)) {
      assert.ok(
        m[0].includes("Your content, social media ready."),
        `${file}: the motto is exactly "Your content, social media ready."`,
      );
    }
  }
  assert.match(read("README.md"), /^Your content, social media ready\.$/m);
});

test("the self-hosting guide says how to reach each piece and what machine to use", () => {
  const guide = read("docs/self-hosting.md");
  for (const port of ["8080", "3210", "3211", "4111"])
    assert.match(guide, new RegExp(`\\b${port}\\b`));
  assert.match(guide, /Mac Mini/);
  assert.match(guide, /x86-64/);
  assert.match(
    guide,
    new RegExp(relative(root, join(root, "deploy/compose.yml")).replace(/\./g, "\\.")),
  );
});
