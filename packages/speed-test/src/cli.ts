// `pnpm speed-test` from the repository: runs the same videos through the main ready-mades
// on a Kontifi copy, one at a time, and keeps every time in a history file so a run that
// got slower shows. See docs/speed-test.md.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { appendResult, readHistory } from "./history";
import { kontifiBackend, signIn } from "./kontifi";
import { DEFAULT_CLIPS, DEFAULT_PLAN, planRuns } from "./plan";
import { batchReport, duration, trendReport } from "./report";
import { runSpeedTest } from "./run";

const list = (value: string | undefined) =>
  value
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);

function need(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} (see docs/speed-test.md).`);
  return value;
}

async function main() {
  const { values } = parseArgs({
    options: {
      only: { type: "string" },
      videos: { type: "string" },
      results: { type: "string" },
      note: { type: "string" },
      "dry-run": { type: "boolean" },
      "report-only": { type: "boolean" },
    },
  });
  const base = process.env.INIT_CWD ?? process.cwd();
  const dir = resolve(base, values.results ?? "speed-test-results");
  const historyPath = join(dir, "history.jsonl");
  const plan = planRuns({
    clips: DEFAULT_CLIPS,
    plan: DEFAULT_PLAN,
    onlyReadyMades: list(values.only),
    onlyClips: list(values.videos),
  });

  if (values["dry-run"]) {
    for (const item of plan) console.log(`${item.readyMadeName} on the ${item.clip.name}`);
    return;
  }
  if (values["report-only"]) {
    console.log(trendReport(await readHistory(historyPath)));
    return;
  }

  const dashboard = need("KONTIFI_URL");
  const toolkitUrl = process.env.KONTIFI_TOOLKIT_URL?.trim();
  const backend = await kontifiBackend({
    convexUrl: need("KONTIFI_CONVEX_URL"),
    team: process.env.KONTIFI_TEAM?.trim() || undefined,
    token: () =>
      signIn({
        siteUrl: need("KONTIFI_CONVEX_SITE_URL"),
        dashboardUrl: dashboard,
        email: need("KONTIFI_EMAIL"),
        password: need("KONTIFI_PASSWORD"),
      }),
    toolkit: toolkitUrl
      ? { baseUrl: toolkitUrl, apiKey: need("KONTIFI_TOOLKIT_API_KEY") }
      : undefined,
  });

  const earlier = await readHistory(historyPath);
  const started = Date.now();
  const results = await runSpeedTest({
    backend,
    plan,
    dashboard,
    note: values.note,
    log: (line) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`),
    onResult: (result) => appendResult(historyPath, result),
  });
  const report = batchReport(results, earlier);
  const history = [...earlier, ...results];
  await mkdir(dir, { recursive: true });
  const name = results[0]?.batch.slice(0, 16).replace(/[T:]/g, "-") ?? "empty";
  await writeFile(join(dir, `${name}.md`), report);
  await writeFile(join(dir, "latest.md"), report);
  await writeFile(join(dir, "history.md"), trendReport(history));
  console.log(`\n${report}\nTook ${duration((Date.now() - started) / 1000)}. Saved in ${dir}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
