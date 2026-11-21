import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "../../lib/env";
import {
  type DashboardUsage,
  MOMENTS_EFFORT,
  MOMENTS_INSTRUCTIONS,
  momentsPrompt,
  momentsRequest,
} from "./moments";

/**
 * Best moments and Chapters for automations that run with nobody watching, through
 * Anthropic's Message Batches API: the same question as POST /ncat/moments, answered
 * within minutes (24 hours at most) at half the price. Convex sends a run's questions
 * here and checks back (convex/moments.ts there); a step someone is watching still asks
 * POST /ncat/moments and gets its answer at once.
 *
 * Batches need the Anthropic API itself, so they are offered only when CHAT_MODEL is an
 * `anthropic/` model and ANTHROPIC_API_KEY is set. Otherwise `batchModel()` is null and
 * the routes answer 409, and Convex asks the usual way.
 */

export const batchSubmission = z.object({
  requests: z
    .array(z.object({ id: z.string().regex(/^[\w-]{1,64}$/), request: momentsRequest }))
    .min(1)
    .max(20),
});

export const batchCheck = z.object({ batchId: z.string().regex(/^msgbatch_[\w-]{1,100}$/) });

/** The Anthropic model batches go to, or null when this server cannot batch. */
export function batchModel(): string | null {
  if (!env.CHAT_MODEL.startsWith("anthropic/") || !env.ANTHROPIC_API_KEY || env.USE_AIMOCK) {
    return null;
  }
  return env.CHAT_MODEL.slice("anthropic/".length);
}

let client: Anthropic | undefined;
let standIn: ((apiKey: string | null) => Anthropic) | undefined;
/** For tests: the client batches go through, by the key asked for. Pass nothing to undo. */
export function useAnthropicForTests(
  stand?: Anthropic | ((apiKey: string | null) => Anthropic),
): void {
  standIn = stand === undefined ? undefined : typeof stand === "function" ? stand : () => stand;
}
/** The client for a team's own key, or the server's when it has none. */
function anthropic(apiKey: string | null = null): Anthropic {
  if (standIn) return standIn(apiKey);
  if (apiKey) return new Anthropic({ apiKey });
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

/** Sends the questions as one batch, on the team's own key when given. Returns its id. */
export async function submitBatch(
  model: string,
  requests: z.infer<typeof batchSubmission>["requests"],
  apiKey: string | null = null,
): Promise<string> {
  const batch = await anthropic(apiKey).messages.batches.create({
    requests: requests.map(({ id, request }) => ({
      custom_id: id,
      params: {
        model,
        max_tokens: 16_000,
        system: MOMENTS_INSTRUCTIONS,
        thinking: { type: "adaptive" },
        output_config: { effort: MOMENTS_EFFORT },
        messages: [{ role: "user", content: momentsPrompt(request) }],
      },
    })),
  });
  return batch.id;
}

/** One question's answer, or why there is none, with what it used (at full price). */
export type BatchAnswer = ({ id: string; answer: string } | { id: string; error: string }) & {
  model?: string;
  usage?: DashboardUsage;
};

/** The batch's answers once it has ended, or null while it is still working. */
export async function batchAnswers(
  batchId: string,
  apiKey: string | null = null,
): Promise<BatchAnswer[] | null> {
  const batches = anthropic(apiKey).messages.batches;
  const batch = await batches.retrieve(batchId);
  if (batch.processing_status !== "ended") return null;
  const answers: BatchAnswer[] = [];
  for await (const result of await batches.results(batchId)) {
    if (result.result.type !== "succeeded") {
      answers.push({ id: result.custom_id, error: result.result.type });
      continue;
    }
    const message = result.result.message;
    // What it used, so the dashboard can keep the run under its AI limit.
    const used = message.usage
      ? {
          model: message.model,
          usage: {
            inputTokens: message.usage.input_tokens ?? 0,
            outputTokens: message.usage.output_tokens ?? 0,
            cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
          },
        }
      : {};
    const text = message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    answers.push(
      message.stop_reason === "refusal" || !text
        ? { id: result.custom_id, error: "empty", ...used }
        : { id: result.custom_id, answer: text, ...used },
    );
  }
  return answers;
}
