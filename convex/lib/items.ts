import { type AutomationEdge, type AutomationNode, upstreamOf } from "@ncat-dash/automation-core";
import { getStep } from "@ncat-dash/step-catalog";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { earlierFiles, startingFiles } from "./chain";

/** What a file is, as far as an automation step cares. */
export type ItemKind = "video" | "audio" | "image" | "captions" | "text" | "other";

/**
 * A file a step handed on, with where it came from: the file it was made from (`from`)
 * and the file that started it all (`source`). A file the run started with is its own
 * source and came from nothing. `source` is null when a file was made from several
 * that started in different places, such as two uploads joined into one video.
 */
export type Item = {
  url: string;
  from: string | null;
  source: string | null;
  kind: ItemKind;
  label?: string;
};

const KINDS: [ItemKind, RegExp][] = [
  ["video", /\.(mp4|mov|m4v|webm|mkv|avi)(\?|#|$)/i],
  ["audio", /\.(mp3|m4a|wav|aac|ogg|flac|opus)(\?|#|$)/i],
  ["image", /\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i],
  ["captions", /\.(srt|vtt|ass|ssa)(\?|#|$)/i],
  ["text", /\.(txt|json|md|csv)(\?|#|$)/i],
];

/** What a file is, from its address. */
export function itemKind(url: string): ItemKind {
  return KINDS.find(([, pattern]) => pattern.test(url))?.[0] ?? "other";
}

/** A file the run started with. */
function startingItem(url: string): Item {
  return { url, from: null, source: url, kind: itemKind(url) };
}

/** The one source all these items share, or null when they started in different places. */
function sharedSource(items: (Item | undefined)[]): string | null {
  const sources = new Set(items.map((item) => item?.source ?? null));
  if (sources.size !== 1) return null;
  return [...sources][0];
}

/** Every file address in a job's input, its main file first. */
function inputFiles(job: Doc<"jobs">): string[] {
  const input = (job.input ?? {}) as Record<string, unknown>;
  const main = getStep(job.stepId)?.primaryInput;
  const first = main && typeof input[main] === "string" ? [input[main] as string] : [];
  const rest: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string" && /^https?:\/\//.test(value)) rest.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(input);
  return [...new Set([...first, ...rest])];
}

/**
 * Where each of a finished step's files came from. A file it passed on unchanged keeps
 * the item it arrived with. A file a job made came from that job's main input. A file
 * made some other way came from the step's one incoming file when it had one, and
 * otherwise shares a source only when everything it was given did.
 */
export async function itemsFor(
  ctx: MutationCtx,
  step: Doc<"runSteps">,
  incoming: string[],
  known: Map<string, Item>,
): Promise<Item[]> {
  const madeBy = new Map<string, Doc<"jobs">>();
  for (const jobId of step.jobIds) {
    const job = await ctx.db.get(jobId);
    if (!job) continue;
    for (const url of job.outputs) if (!madeBy.has(url)) madeBy.set(url, job);
  }
  const labels = new Map((step.labels ?? []).map((one) => [one.url, one.label]));
  const given = incoming.map((url) => known.get(url) ?? startingItem(url));
  const files = [...new Set([...step.outputs, ...Object.values(step.branches ?? {}).flat()])];

  return files.map((url): Item => {
    const label = labels.get(url);
    const withLabel = (item: Item): Item => (label ? { ...item, label } : item);
    const passedOn = known.get(url) ?? given.find((item) => item.url === url);
    if (passedOn) return withLabel({ ...passedOn, url });

    const job = madeBy.get(url);
    if (job) {
      const inputs = inputFiles(job).filter((file) => file !== url);
      const parents = inputs.map(
        (file) => known.get(file) ?? given.find((item) => item.url === file),
      );
      const main = inputs[0];
      if (main) {
        const mainItem = parents[0];
        const ofRun = parents.filter((item): item is Item => item !== undefined);
        return withLabel({
          url,
          from: main,
          source: ofRun.length > 0 ? sharedSource(ofRun) : (mainItem?.source ?? main),
          kind: itemKind(url),
        });
      }
    }

    if (given.length === 1) {
      return withLabel({ url, from: given[0].url, source: given[0].source, kind: itemKind(url) });
    }
    return withLabel({ url, from: null, source: sharedSource(given), kind: itemKind(url) });
  });
}

/**
 * Writes down where the files of every finished step came from, for each step that does
 * not have it yet. Steps are worked through from the trigger on, so each step sees the
 * items of the steps before it. Nothing reads these yet; they are kept so later steps
 * can pair files by where they started.
 */
export async function recordItems(
  ctx: MutationCtx,
  run: Doc<"runs">,
  byNode: Map<string, Doc<"runSteps">>,
): Promise<void> {
  const nodes = run.nodes as AutomationNode[];
  const edges = run.edges as AutomationEdge[];
  const known = new Map<string, Item>();
  for (const url of [...startingFiles(run.trigger), ...earlierFiles(run.trigger).flat()]) {
    if (!known.has(url)) known.set(url, startingItem(url));
  }
  const starting = startingFiles(run.trigger);

  const settled = new Map<string, Item[] | null>();
  const visit = async (nodeId: string, path: Set<string>): Promise<Item[] | null> => {
    if (settled.has(nodeId)) return settled.get(nodeId)!;
    if (path.has(nodeId)) return null;
    path.add(nodeId);
    const step = byNode.get(nodeId);
    const sources = upstreamOf(nodeId, edges);
    for (const source of sources) await visit(source, path);
    path.delete(nodeId);

    let items: Item[] | null = null;
    if (step?.items) items = step.items as Item[];
    else if (
      step &&
      (step.status === "done" || (step.status === "failed" && step.outputs.length > 0))
    ) {
      const incoming =
        sources.length === 0
          ? starting
          : sources.flatMap((source) => {
              const before = byNode.get(source);
              if (!before) return [];
              const ways = before.branches;
              return ways ? Object.values(ways).flat() : before.outputs;
            });
      items = await itemsFor(ctx, step, incoming, known);
      await ctx.db.patch(step._id, { items });
      byNode.set(nodeId, { ...step, items });
    }
    for (const item of items ?? []) if (!known.has(item.url)) known.set(item.url, item);
    settled.set(nodeId, items);
    return items;
  };
  for (const node of nodes) await visit(node.id, new Set());
}
