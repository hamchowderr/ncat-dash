import { describe, expect, test } from "vitest";
import {
  aiLimitProblem,
  checkSpend,
  costOfUsage,
  dollarsText,
  guessCost,
  priceOf,
} from "../src/ai-spend";

describe("what an AI answer costs", () => {
  test("prices Sonnet 5.5 at $2 in and $10 out per million tokens", () => {
    // 100,000 in at $2/M = $0.20; 10,000 out at $10/M = $0.10.
    expect(
      costOfUsage("anthropic/claude-sonnet-5-5", { inputTokens: 100_000, outputTokens: 10_000 }),
    ).toBe(300_000);
  });

  test("counts cache reads at their own price and cache writes at 1.25 times input", () => {
    expect(
      costOfUsage("claude-sonnet-5-5", { cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 }),
    ).toBe(100_000 + 2_500_000);
  });

  test("a batch answer costs half", () => {
    const usage = { inputTokens: 40_000, outputTokens: 2_000 };
    expect(costOfUsage("claude-sonnet-5-5", usage, true)).toBe(
      costOfUsage("claude-sonnet-5-5", usage) / 2,
    );
  });

  test("a model the list does not know is priced as the dearest, so a limit still holds", () => {
    expect(priceOf("someone/new-model")).toEqual(priceOf("claude-opus-5-5"));
    expect(priceOf("")).toEqual(priceOf("anthropic/claude-opus-5-5"));
  });

  test("ignores counts that are missing or not numbers", () => {
    expect(costOfUsage("claude-haiku-5-5", { inputTokens: Number.NaN, outputTokens: -4 })).toBe(0);
  });
});

describe("guessing before asking", () => {
  test("guesses more than a real answer of the same length costs", () => {
    const chars = 60_000;
    const real = costOfUsage("claude-sonnet-5-5", { inputTokens: chars / 4, outputTokens: 3_000 });
    expect(guessCost("claude-sonnet-5-5", chars)).toBeGreaterThan(real);
  });

  test("a longer transcript is a bigger guess, and a batch half of it", () => {
    expect(guessCost("", 90_000)).toBeGreaterThan(guessCost("", 30_000));
    expect(guessCost("", 30_000, true)).toBe(Math.ceil(guessCost("", 30_000) / 2));
  });
});

describe("the run's limit", () => {
  test("lets a step ask when there is no limit", () => {
    expect(checkSpend(null, 9_000_000, 0, 9_000_000)).toEqual({ ok: true });
  });

  test("lets a step ask while the run stays at or under its limit", () => {
    expect(checkSpend(1_000_000, 400_000, 100_000, 500_000)).toEqual({ ok: true });
  });

  test("stops a step that would take the run past its limit, saying what was used", () => {
    const check = checkSpend(1_000_000, 700_000, 100_000, 300_000);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.message).toBe(
      "This run has used $0.80 of its $1.00 limit for AI, and this step could take up to $0.30 more, so it stopped before asking. Raise the limit in Settings → Runs, then try the run again.",
    );
  });

  test("says it plainly when the first question alone is over the limit", () => {
    const check = checkSpend(50_000, 0, 0, 120_000);
    expect(check.ok ? "" : check.message).toBe(
      "This run's limit for AI is $0.05, and this step could take up to $0.12, so it stopped before asking. Raise the limit in Settings → Runs, then try the run again.",
    );
  });
});

describe("amounts as people read them", () => {
  test("in dollars and cents, with less than a cent said so", () => {
    expect(dollarsText(0)).toBe("$0.00");
    expect(dollarsText(4_000)).toBe("under $0.01");
    expect(dollarsText(41_000)).toBe("$0.04");
    expect(dollarsText(1_500_000)).toBe("$1.50");
  });

  test("a limit is blank, or from 5 cents to $100", () => {
    expect(aiLimitProblem(null)).toBeNull();
    expect(aiLimitProblem(0.5)).toBeNull();
    expect(aiLimitProblem(0.01)).toMatch(/from \$0\.05 to \$100/);
    expect(aiLimitProblem(101)).toMatch(/from \$0\.05 to \$100/);
    expect(aiLimitProblem(Number.NaN)).toMatch(/dollars/);
  });
});
