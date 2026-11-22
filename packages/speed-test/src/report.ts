import { compare, type Comparison, type SpeedResult } from "./history";

/** A length in plain words: "45 s", "2 min 10 s", "1 h 5 min". */
export function duration(totalSeconds: number | null): string {
  if (totalSeconds === null) return "not finished";
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const rest = s % 60;
    return rest ? `${Math.floor(s / 60)} min ${rest} s` : `${s / 60} min`;
  }
  const minutes = Math.round((s % 3600) / 60);
  return minutes ? `${Math.floor(s / 3600)} h ${minutes} min` : `${s / 3600} h`;
}

/** How a run compares with before, in a few words. */
export function changeText(comparison: Comparison): string {
  switch (comparison.verdict) {
    case "first":
      return "first run";
    case "no-time":
      return "no time to compare";
    case "same":
      return `about the same (before: ${duration(comparison.before)})`;
    case "slower":
      return `**${Math.round(comparison.change! * 100)}% slower** (before: ${duration(comparison.before)})`;
    case "faster":
      return `${Math.round(-comparison.change! * 100)}% faster (before: ${duration(comparison.before)})`;
  }
}

function outcome(result: SpeedResult): string {
  switch (result.status) {
    case "done":
      return duration(result.seconds);
    case "waiting":
      return `${duration(result.seconds)} to approval`;
    case "too-slow":
      return `stopped after ${duration(result.seconds)}`;
    case "failed":
      return "failed";
    case "cancelled":
      return "stopped";
  }
}

/** "3.2x the video's length", the plainest way to say how quick it was. */
function times(result: SpeedResult): string {
  if (result.seconds === null || result.status === "failed") return "";
  return `${(result.seconds / result.clipSeconds).toFixed(1)}x`;
}

function slowest(result: SpeedResult): string {
  const timed = result.steps.filter((step) => step.seconds !== null);
  if (timed.length === 0) return "";
  const top = timed.reduce((a, b) => (b.seconds! > a.seconds! ? b : a));
  return `${top.name} (${duration(top.seconds)})`;
}

function toolkitLine(results: SpeedResult[]): string {
  const states = results.map((result) => result.toolkit).filter((state) => state !== null);
  if (states.length === 0)
    return "How busy the toolkit was wasn't read (no toolkit address given).";
  const builds = [...new Set(states.map((state) => state.build ?? "unknown"))].join(", ");
  const cpu = states.map((state) => state.cpuPercent);
  return `Toolkit build ${builds}, ${states[0].cpus} cores. Its CPU before each run: ${Math.min(...cpu)}% to ${Math.max(...cpu)}%.`;
}

/**
 * The report of one batch in Markdown: a table of every run, the steps of each, and how
 * each compares with earlier runs of the same ready-made on the same video.
 */
export function batchReport(batch: SpeedResult[], history: SpeedResult[]): string {
  if (batch.length === 0) return "# Speed test\n\nNothing ran.\n";
  const first = batch[0];
  const when = new Date(first.at).toUTCString().replace(/:\d\d GMT$/, " UTC");
  const lines = [
    `# Speed test, ${when}`,
    "",
    `Dashboard: ${first.dashboard}. One run at a time. ${toolkitLine(batch)}`,
    "",
    "| Ready-made | Video | Time | Of video length | Slowest step | Compared with before |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  const comparisons = batch.map((result) => compare(result, history));
  batch.forEach((result, index) => {
    lines.push(
      `| ${result.readyMadeName} | ${result.clipName} | ${outcome(result)} | ${times(result)} | ${slowest(result)} | ${changeText(comparisons[index])} |`,
    );
  });
  const slower = batch.filter((_, index) => comparisons[index].verdict === "slower");
  const failed = batch.filter(
    (result) => result.status === "failed" || result.status === "too-slow",
  );
  lines.push("");
  if (slower.length > 0) {
    lines.push(
      `**${slower.length} ${slower.length === 1 ? "run is" : "runs are"} slower than before:** ${slower
        .map((result) => `${result.readyMadeName} on the ${result.clipName}`)
        .join("; ")}.`,
      "",
    );
  }
  if (failed.length > 0) {
    lines.push(
      `**Didn't finish:** ${failed
        .map(
          (result) =>
            `${result.readyMadeName} on the ${result.clipName}${result.error ? ` (${result.error})` : ""}`,
        )
        .join("; ")}.`,
      "",
    );
  }
  lines.push("## Step By Step", "");
  for (const result of batch) {
    lines.push(`### ${result.readyMadeName}, ${result.clipName}: ${outcome(result)}`, "");
    if (result.firstStepAfter !== null && result.firstStepAfter >= 1) {
      lines.push(`- Waited ${duration(result.firstStepAfter)} before the first step started`);
    }
    for (const step of result.steps) {
      const extra = [
        `${step.jobs} toolkit ${step.jobs === 1 ? "job" : "jobs"}`,
        ...(step.retries ? [`tried again ${step.retries}x`] : []),
        ...(step.status === "failed" ? ["failed"] : []),
      ].join(", ");
      lines.push(`- ${step.name}: ${duration(step.seconds)} (${extra})`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Every ready-made and video's time across all batches, newest batch last, so a trend
 * shows at a glance.
 */
export function trendReport(history: SpeedResult[], batches = 10): string {
  const order = [...new Set(history.map((result) => result.batch))].slice(-batches);
  if (order.length === 0) return "# Speed Test History\n\nNo runs yet.\n";
  const keys = [
    ...new Map(
      history
        .filter((result) => order.includes(result.batch))
        .map((result) => [
          `${result.readyMadeId}|${result.clipId}`,
          `${result.readyMadeName}, ${result.clipName}`,
        ]),
    ),
  ];
  const day = (batch: string) => {
    const at = history.find((result) => result.batch === batch)!.at;
    return at.slice(0, 16).replace("T", " ");
  };
  const lines = [
    "# Speed Test History",
    "",
    `| Ready-made, video | ${order.map(day).join(" | ")} |`,
    `| --- | ${order.map(() => "---").join(" | ")} |`,
  ];
  for (const [key, label] of keys) {
    const cells = order.map((batch) => {
      const result = history.find(
        (candidate) =>
          candidate.batch === batch && `${candidate.readyMadeId}|${candidate.clipId}` === key,
      );
      return result ? outcome(result) : "";
    });
    lines.push(`| ${label} | ${cells.join(" | ")} |`);
  }
  return `${lines.join("\n")}\n`;
}
