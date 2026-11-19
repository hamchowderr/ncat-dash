import { RequestContext } from '@mastra/core/request-context';
import { describe, expect, it } from 'vitest';
import {
  CostRouteProcessor,
  cacheBreakpoint,
  cheapModelFor,
  isSimpleChat,
  LONG_CACHE_KEY,
  lastUserText,
  MODEL_PICKED_KEY,
  ROUTE_KEY,
  takesEffort,
} from '../../src/mastra/lib/cost';
import { TurnContextProcessor, todaySection } from '../../src/mastra/lib/turn-context';

/** What a turn costs (lib/cost.ts): the model, the effort, the cache's lifetime. */

describe('isSimpleChat', () => {
  it.each([
    'How long can a YouTube Short be?',
    'What does the Remove silence step do?',
    'how do I make clips for Instagram?',
    'Is my clips automation switched on?',
    'Thanks!',
    'thank you so much',
    'Hi there',
    'ok great',
  ])('a small model can answer "%s"', (text) => {
    expect(isSimpleChat(text)).toBe(true);
  });

  it.each([
    'Every time I upload a podcast episode, cut it into short clips for TikTok.',
    'Try it on my latest upload.',
    'Make the captions bigger, and put our logo in the corner.',
    'Looks good. Switch it on.',
    'Can you add captions to it?',
    'What do you think, could you please switch it on?',
    'Thanks, now switch it on and try it on the newest upload please',
    `What does this do?\nAnd can you fix it`,
    `How ${'long '.repeat(80)}?`,
    '',
  ])('building needs the full model: "%s"', (text) => {
    expect(isSimpleChat(text)).toBe(false);
  });
});

describe('lastUserText', () => {
  it('reads the agent controller message, which arrives as a user signal', () => {
    const messages = [
      { role: 'user', content: { format: 2, parts: [{ type: 'text', text: 'first' }] } },
      { role: 'assistant', content: { format: 2, parts: [{ type: 'text', text: 'reply' }] } },
      {
        role: 'signal',
        type: 'user',
        content: { format: 2, parts: [{ type: 'text', text: 'How long is a Short?' }] },
      },
      { role: 'assistant', content: { format: 2, parts: [{ type: 'tool-invocation' }] } },
    ];
    expect(lastUserText(messages)).toBe('How long is a Short?');
  });

  it('reads plain and part-list user messages, and nothing else', () => {
    expect(lastUserText([{ role: 'user', content: 'plain' }])).toBe('plain');
    expect(lastUserText([{ role: 'user', content: [{ type: 'text', text: 'parts' }] }])).toBe(
      'parts',
    );
    expect(lastUserText([{ role: 'signal', type: 'system', content: 'not a person' }])).toBe('');
  });
});

describe('models and effort', () => {
  it('picks a cheap model from the same provider', () => {
    expect(cheapModelFor('anthropic/claude-sonnet-5-5')).toBe('anthropic/claude-haiku-5-5');
    expect(cheapModelFor('openai/gpt-4.1-mini')).toBe('openai/gpt-4.1-nano');
    expect(cheapModelFor('google/gemini-2.5-flash')).toBe('google/gemini-2.5-flash');
  });

  it('sends effort only to models that take it', () => {
    expect(takesEffort('anthropic/claude-sonnet-5-5')).toBe(true);
    expect(takesEffort('anthropic/claude-haiku-5-5')).toBe(true);
    expect(takesEffort('anthropic/claude-opus-5-5')).toBe(true);
    expect(takesEffort('anthropic/claude-haiku-4-5')).toBe(false);
    expect(takesEffort('openai/gpt-4.1-mini')).toBe(false);
  });
});

/** One processInputStep of the router, on this model and message. */
async function route(text: string, opts: { model?: string; picked?: boolean } = {}) {
  const requestContext = new RequestContext();
  if (opts.picked) requestContext.set(MODEL_PICKED_KEY, true);
  const processor = new CostRouteProcessor({ promptCache: true });
  const state: Record<string, unknown> = {};
  const args = {
    messages: [{ role: 'user', content: text }],
    requestContext,
    model: { modelId: opts.model ?? 'claude-sonnet-4-6', provider: 'anthropic.messages' },
    providerOptions: { anthropic: { thinking: { type: 'adaptive' } } },
    state,
  } as unknown as Parameters<CostRouteProcessor['processInputStep']>[0];
  const result = (await processor.processInputStep(args)) as {
    model?: string;
    providerOptions: { anthropic: Record<string, unknown> };
  };
  return { result, requestContext, processor, args };
}

describe('CostRouteProcessor', () => {
  // The test environment's CHAT_MODEL (vitest.config.ts).
  it('sends a simple question on the default model to Claude Haiku 5.5 at low effort', async () => {
    const { result, requestContext } = await route('How long can a YouTube Short be?');
    expect(result.model).toBe('anthropic/claude-haiku-5-5');
    expect(result.providerOptions.anthropic.effort).toBe('low');
    expect(requestContext.get(ROUTE_KEY)).toBe('simple');
  });

  it('keeps building on the default model at medium effort, keeping thinking on', async () => {
    const { result } = await route('Make me clips for TikTok from every upload.');
    expect(result.model).toBeUndefined();
    expect(result.providerOptions.anthropic).toMatchObject({
      thinking: { type: 'adaptive' },
      effort: 'medium',
      cacheControl: { type: 'ephemeral' },
    });
  });

  it("never moves a turn off a model the team or the composer picked", async () => {
    const { result } = await route('How long can a YouTube Short be?', { picked: true });
    expect(result.model).toBeUndefined();
    const other = await route('How long can a YouTube Short be?', { model: 'claude-opus-5-5' });
    expect(other.result.model).toBeUndefined();
  });

  it('keeps the first step’s choice for the rest of the turn', async () => {
    const { processor, args } = await route('Thanks!');
    const next = (await processor.processInputStep({
      ...args,
      messages: [{ role: 'assistant', content: 'tool call' }],
    } as unknown as typeof args)) as { model?: string };
    expect(next.model).toBe('anthropic/claude-haiku-5-5');
  });
});

describe('the cache lasts an hour for a chat-app turn', () => {
  it('asks for an hour only when the turn says so', () => {
    const chatApp = new RequestContext();
    chatApp.set(LONG_CACHE_KEY, true);
    expect(cacheBreakpoint(chatApp).anthropic.cacheControl).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(cacheBreakpoint(new RequestContext()).anthropic.cacheControl).toEqual({
      type: 'ephemeral',
    });
    expect(cacheBreakpoint().anthropic.cacheControl).toEqual({ type: 'ephemeral' });
  });

  it('puts the hour on the instructions breakpoint and the router’s request-level one', async () => {
    const requestContext = new RequestContext();
    requestContext.set(LONG_CACHE_KEY, true);
    const turn = new TurnContextProcessor({
      now: () => new Date('2026-10-16T05:30:00Z'),
      promptCache: true,
      sections: [todaySection],
    });
    const result = (await turn.processInputStep({
      systemMessages: [{ role: 'system', content: 'Instructions.' }],
      requestContext,
    } as unknown as Parameters<TurnContextProcessor['processInputStep']>[0])) as {
      systemMessages: { providerOptions?: { anthropic?: { cacheControl?: unknown } } }[];
    };
    expect(result.systemMessages[0]?.providerOptions?.anthropic?.cacheControl).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    });

    const processor = new CostRouteProcessor({ promptCache: true });
    const routed = (await processor.processInputStep({
      messages: [{ role: 'user', content: 'Make clips' }],
      requestContext,
      model: { modelId: 'claude-sonnet-4-6', provider: 'anthropic.messages' },
      providerOptions: {},
      state: {},
    } as unknown as Parameters<CostRouteProcessor['processInputStep']>[0])) as {
      providerOptions: { anthropic: { cacheControl?: unknown } };
    };
    expect(routed.providerOptions.anthropic.cacheControl).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('adds no request-level breakpoint with prompt caching off', async () => {
    const processor = new CostRouteProcessor({ promptCache: false });
    const routed = (await processor.processInputStep({
      messages: [{ role: 'user', content: 'Make clips' }],
      requestContext: new RequestContext(),
      model: { modelId: 'claude-sonnet-4-6', provider: 'anthropic.messages' },
      providerOptions: {},
      state: {},
    } as unknown as Parameters<CostRouteProcessor['processInputStep']>[0])) as {
      providerOptions: { anthropic: Record<string, unknown> };
    };
    expect(routed.providerOptions.anthropic.cacheControl).toBeUndefined();
  });
});
