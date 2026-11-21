/**
 * # What the AI steps of one run may spend
 *
 * Only a few steps ask the AI anything while a run goes: Best moments, Chapters, Plan
 * B-Roll and AI motion planning. Each asks once per video, never per edit, and an answer
 * already given for the same question is reused. A team can still put a ceiling on what
 * one run spends on them (Settings → Runs). Before a step asks, the dashboard holds a
 * generous guess of what the question costs; if that would take the run past its limit,
 * the step stops with a plain reason and nothing is spent. Once the answer is in, the
 * guess is replaced with what Anthropic says it used.
 *
 * Money is kept in millionths of a dollar ("micros"), so sums stay exact.
 */

export const MICROS_PER_DOLLAR = 1_000_000;

/** The limit a team can set, in dollars. Blank means no limit. */
export const MIN_AI_LIMIT_DOLLARS = 0.05;
export const MAX_AI_LIMIT_DOLLARS = 100;

/** Anthropic's published prices, US dollars per million tokens (November 2026). */
export const AI_PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** Writing the five-minute cache costs this many times the input price. */
const CACHE_WRITE = 1.25;
/** The Message Batches API costs half. */
const BATCH = 0.5;

/** The price list entry for a model id such as "anthropic/claude-sonnet-5-5". */
export function priceOf(model: string) {
  const bare = model.replace(/^[a-z-]+\//, "");
  // A model the list does not know is priced as the dearest, so a limit still holds.
  return AI_PRICES[bare] ?? AI_PRICES["claude-opus-5-5"];
}

/** What a model reported using for one answer. Every count is optional. */
export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

const count = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/** What one answer cost, in micros, rounded up. */
export function costOfUsage(model: string, usage: AiUsage, batch = false): number {
  const price = priceOf(model);
  // Prices are per million tokens, so a token at $1 per million costs one micro.
  const micros =
    count(usage.inputTokens) * price.input +
    count(usage.cacheWriteTokens) * price.input * CACHE_WRITE +
    count(usage.cacheReadTokens) * price.cacheRead +
    count(usage.outputTokens) * price.output;
  return Math.ceil(micros * (batch ? BATCH : 1));
}

// About this many characters make a token in English text; fewer than average, so the
// guess runs high.
const CHARS_PER_TOKEN = 3;
// What the model writes back, thinking included, at most: picks are short.
const OUTPUT_GUESS_TOKENS = 8_000;
// The instructions sent with every question.
const INSTRUCTION_TOKENS = 1_000;

/**
 * A generous guess of what one question costs before it is asked, from the length of
 * what is sent: what a step holds against the run's limit until the real cost is known.
 */
export function guessCost(model: string, questionChars: number, batch = false): number {
  return costOfUsage(
    model,
    {
      inputTokens: INSTRUCTION_TOKENS + Math.ceil(Math.max(0, questionChars) / CHARS_PER_TOKEN),
      outputTokens: OUTPUT_GUESS_TOKENS,
    },
    batch,
  );
}

/** "$0.04", or "under $0.01" for less than a cent. */
export function dollarsText(micros: number): string {
  if (micros > 0 && micros < 10_000) return "under $0.01";
  return `$${(micros / MICROS_PER_DOLLAR).toFixed(2)}`;
}

/** A limit in dollars as typed, checked: null for no limit, or a problem in plain words. */
export function aiLimitProblem(dollars: number | null): string | null {
  if (dollars === null) return null;
  if (!Number.isFinite(dollars)) return "Type an amount in dollars, such as 0.50.";
  if (dollars < MIN_AI_LIMIT_DOLLARS || dollars > MAX_AI_LIMIT_DOLLARS) {
    return `The limit is from $${MIN_AI_LIMIT_DOLLARS.toFixed(2)} to $${MAX_AI_LIMIT_DOLLARS}, or blank for no limit.`;
  }
  return null;
}

export type SpendCheck = { ok: true } | { ok: false; message: string };

/**
 * Whether a run may hold `wanted` more against its limit, given what it has spent and
 * holds already. The refusal says what was spent and what to do, for the step's error.
 */
export function checkSpend(
  limitMicros: number | null,
  spentMicros: number,
  heldMicros: number,
  wantedMicros: number,
): SpendCheck {
  if (limitMicros === null) return { ok: true };
  if (spentMicros + heldMicros + wantedMicros <= limitMicros) return { ok: true };
  const fix = "Raise the limit in Settings → Runs, then try the run again.";
  const more = dollarsText(wantedMicros);
  return {
    ok: false,
    message:
      spentMicros + heldMicros > 0
        ? `This run has used ${dollarsText(spentMicros + heldMicros)} of its ${dollarsText(limitMicros)} limit for AI, and this step could take up to ${more} more, so it stopped before asking. ${fix}`
        : `This run's limit for AI is ${dollarsText(limitMicros)}, and this step could take up to ${more}, so it stopped before asking. ${fix}`,
  };
}
