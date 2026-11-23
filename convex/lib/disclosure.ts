import { findDisclosure, type StepDefinition, userInputSchema } from "@takewon/step-catalog";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { listenRequest, wordsFor } from "./moments";
import { enqueueAll, failStep } from "./runner";

/**
 * Steps that keep a paid creator's ad disclosure in every cut (Length Cuts, Hook And
 * Ending Variants) need each video's words. Before such a step's jobs are queued, the run
 * transcribes the videos it has not heard before ("hear"; convex/disclosure.ts reads the
 * words in and keeps them), then queues the jobs, which are handed the words as they are
 * sent (convex/jobs.ts). What was found is kept on the step for the run page.
 */

/** A step's settings with their defaults, as `readsWords` reads them. */
export function settingsOf(definition: StepDefinition, input: unknown): Record<string, unknown> {
  const parsed = userInputSchema(definition).safeParse(input);
  return (parsed.success ? parsed.data : (input ?? {})) as Record<string, unknown>;
}

/** The files, by setting name, whose words one job of `definition` needs. */
export function wordFiles(definition: StepDefinition, input: unknown): Record<string, string> {
  if (!definition.readsWords) return {};
  const settings = settingsOf(definition, input);
  const files: Record<string, string> = {};
  for (const field of definition.readsWords(settings)) {
    const url = settings[field];
    if (typeof url === "string" && /^https?:\/\//.test(url)) files[field] = url;
  }
  return files;
}

/** What the run page says about one video: the disclosure kept, or null when none was heard. */
export type DisclosureNote = { source: string; text: string | null };

/**
 * Before the jobs of a step that keeps the disclosure: "hearing" when the videos are
 * being transcribed first (the step comes back once they are), "failed" when that could
 * not start, else what was found in each job's videos.
 */
export async function hearFirst(
  ctx: MutationCtx,
  run: Doc<"runs">,
  step: Doc<"runSteps">,
  byNode: Map<string, Doc<"runSteps">>,
  definition: StepDefinition,
  planned: Record<string, unknown>[],
  heard: boolean,
): Promise<"hearing" | "failed" | DisclosureNote[]> {
  const perJob = planned.map((input) => wordFiles(definition, input));
  const urls = [...new Set(perJob.flatMap((files) => Object.values(files)))];
  if (urls.length === 0) return [];
  if (!heard) {
    const unheard: string[] = [];
    for (const url of urls) {
      if (!(await wordsFor(ctx, run.organizationId, url))) unheard.push(url);
    }
    if (unheard.length > 0) {
      const queued = await enqueueAll(
        ctx,
        run,
        step,
        unheard.map((url) => ({ stepId: "media-transcribe", input: listenRequest(url) })),
      );
      if (!queued.ok) {
        await failStep(ctx, run, step, byNode, queued.message);
        return "failed";
      }
      await ctx.db.patch(step._id, {
        status: "running",
        stage: "hear",
        jobIds: queued.jobIds,
        startedAt: step.startedAt ?? Date.now(),
      });
      return "hearing";
    }
  }
  return disclosureNotes(ctx, run.organizationId, definition, planned);
}

/** For each job: its main video, and the disclosure heard in any of its videos. */
export async function disclosureNotes(
  ctx: QueryCtx,
  organizationId: string,
  definition: StepDefinition,
  planned: Record<string, unknown>[],
): Promise<DisclosureNote[]> {
  const notes: DisclosureNote[] = [];
  for (const input of planned) {
    const files = wordFiles(definition, input);
    const entries = Object.entries(files);
    if (entries.length === 0) continue;
    const settings = settingsOf(definition, input);
    const said =
      typeof settings.disclosure_words === "string" ? settings.disclosure_words : undefined;
    let text: string | null = null;
    for (const [, url] of entries) {
      const spoken = await wordsFor(ctx, organizationId, url);
      const found = spoken ? findDisclosure(spoken.words, said) : null;
      if (found) {
        text = found.text;
        break;
      }
    }
    const primary = definition.primaryInput ? files[definition.primaryInput] : undefined;
    notes.push({ source: primary ?? entries[0][1], text });
  }
  return notes;
}

/** The words of each file one job needs, by setting name, from the team's transcripts. */
export async function wordsForJob(
  ctx: QueryCtx,
  organizationId: string,
  definition: StepDefinition,
  input: unknown,
) {
  const words: Record<string, { text: string; start: number; end: number }[]> = {};
  for (const [field, url] of Object.entries(wordFiles(definition, input))) {
    const spoken = await wordsFor(ctx, organizationId, url);
    if (spoken) words[field] = spoken.words;
  }
  return words;
}
