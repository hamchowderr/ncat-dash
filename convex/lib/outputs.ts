import { fileNameOfLink, plainName, runOutputNames, runStem } from "@takewon/automation-core";
import { getStep } from "@takewon/step-catalog";

/** Collects every http(s) URL inside a toolkit result, whatever its shape. */
export function collectUrls(value: unknown, found: string[] = [], depth = 0): string[] {
  if (depth > 6 || found.length >= 100) return found;
  if (typeof value === "string") {
    if (/^https?:\/\/\S+$/.test(value) && !found.includes(value)) found.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, found, depth + 1);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectUrls(item, found, depth + 1);
  }
  return found;
}

/**
 * Readable names for a run's files, by link: "Space interviews clip 1" rather than the
 * job id the toolkit named the file after. Steps are named in the canvas's order.
 */
export function outputNamesOf(
  run: { trigger: unknown; automationName: string; nodes: unknown[] },
  steps: { nodeId: string; outputs: string[]; labels?: { url: string; label: string }[] }[],
): Record<string, string> {
  const byNode = new Map(steps.map((step) => [step.nodeId, step]));
  const ordered = (run.nodes as { id: string; stepId?: string }[]).flatMap((node) => {
    const step = byNode.get(node.id);
    return step
      ? [{ stepId: node.stepId ?? null, outputs: step.outputs, labels: step.labels }]
      : [];
  });
  return runOutputNames(runStem(startingFileName(run.trigger), run.automationName), ordered);
}

/** The name of the file that started a run: as uploaded, or else from its address. */
export function startingFileName(trigger: unknown): string | null {
  const { file_name: name, file_url: url } = (trigger ?? {}) as Record<string, unknown>;
  if (typeof name === "string" && name) return name;
  if (typeof url !== "string") return null;
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}

/**
 * Readable names for the files of a step run by hand on the Steps page, by link: after the
 * file it was given ("Space interviews clip 1"), else after the step itself.
 */
export function handOutputNames(job: {
  stepId: string;
  input: unknown;
  outputs: string[];
}): Record<string, string> {
  const given = collectUrls(job.input)[0];
  const title = getStep(job.stepId)?.title ?? "Step";
  const stem = plainName(given ? fileNameOfLink(given) : null) ?? title;
  return runOutputNames(stem, [{ stepId: job.stepId, outputs: job.outputs }]);
}
