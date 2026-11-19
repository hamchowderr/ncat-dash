import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { MOMENTS_EFFORT, MOMENTS_INSTRUCTIONS } from '../../src/mastra/ncat/moments';
import {
  batchAnswers,
  batchCheck,
  batchModel,
  batchSubmission,
  submitBatch,
  useAnthropicForTests,
} from '../../src/mastra/ncat/moments-batch';

/** Best moments and Chapters through the Message Batches API, at half price (ncat/moments-batch.ts). */

const request = batchSubmission.parse({
  requests: [
    {
      id: 'step_1',
      request: {
        kind: 'moments',
        duration: 600,
        transcript: '[00:00] Welcome back to the show.',
        settings: { count: 3, minSeconds: 15, maxSeconds: 60, platform: 'TikTok' },
      },
    },
  ],
}).requests;

/** A stand-in for the Anthropic client's batches API. */
function stand(opts: { status: 'in_progress' | 'ended'; results?: unknown[] }) {
  const created: unknown[] = [];
  const client = {
    messages: {
      batches: {
        create: async (body: unknown) => {
          created.push(body);
          return { id: 'msgbatch_abc' };
        },
        retrieve: async () => ({ processing_status: opts.status }),
        results: async () =>
          (async function* () {
            for (const r of opts.results ?? []) yield r;
          })(),
      },
    },
  };
  useAnthropicForTests(client as unknown as Anthropic);
  return created;
}

afterEach(() => useAnthropicForTests());

describe('moments batches', () => {
  it('offers no batches on the mock model, so Convex asks the usual way', () => {
    expect(batchModel()).toBeNull();
  });

  it('sends each question with the same instructions, thinking and effort as the live route', async () => {
    const created = stand({ status: 'in_progress' });
    expect(await submitBatch('claude-sonnet-5-5', request)).toBe('msgbatch_abc');
    const body = created[0] as {
      requests: { custom_id: string; params: Record<string, unknown> }[];
    };
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]?.custom_id).toBe('step_1');
    expect(body.requests[0]?.params).toMatchObject({
      model: 'claude-sonnet-5-5',
      system: MOMENTS_INSTRUCTIONS,
      thinking: { type: 'adaptive' },
      output_config: { effort: MOMENTS_EFFORT },
    });
    expect(JSON.stringify(body.requests[0]?.params)).not.toContain('budget_tokens');
  });

  it('answers nothing while the batch is still working', async () => {
    stand({ status: 'in_progress' });
    expect(await batchAnswers('msgbatch_abc')).toBeNull();
  });

  it('returns each answer, and an error for a failed or empty one', async () => {
    stand({
      status: 'ended',
      results: [
        {
          custom_id: 'a',
          result: {
            type: 'succeeded',
            message: {
              stop_reason: 'end_turn',
              content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: ' {"moments":[]} ' }],
            },
          },
        },
        { custom_id: 'b', result: { type: 'errored' } },
        { custom_id: 'c', result: { type: 'expired' } },
        {
          custom_id: 'd',
          result: { type: 'succeeded', message: { stop_reason: 'refusal', content: [] } },
        },
      ],
    });
    expect(await batchAnswers('msgbatch_abc')).toEqual([
      { id: 'a', answer: '{"moments":[]}' },
      { id: 'b', error: 'errored' },
      { id: 'c', error: 'expired' },
      { id: 'd', error: 'empty' },
    ]);
  });

  it('refuses ids that are not a step or a batch', () => {
    expect(batchCheck.safeParse({ batchId: 'msgbatch_abc' }).success).toBe(true);
    expect(batchCheck.safeParse({ batchId: '../etc' }).success).toBe(false);
    expect(
      batchSubmission.safeParse({ requests: [{ id: 'a b', request: request[0]?.request }] }).success,
    ).toBe(false);
    expect(batchSubmission.safeParse({ requests: [] }).success).toBe(false);
  });
});
