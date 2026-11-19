/**
 * # What a turn costs: which model, how hard it thinks, how long its cache lives
 *
 * The agent builds automations on the server's CHAT_MODEL (Claude Sonnet 5.5). Most of
 * what a session costs is that model reading the same long prompt (tool schemas and
 * instructions, about 24,000 tokens) on every step, so the levers here are:
 *
 * - Effort. Sonnet 5.5 and the other current Claude models think adaptively, and
 *   `effort` sets how much. Building runs at CHAT_EFFORT (medium); a simple chat at low.
 *   (They reject the old fixed thinking budget; see agents/chat.ts.)
 * - The model. A turn that only asks something or says thanks, with no model picked by
 *   the team or the composer, runs on SIMPLE_CHAT_MODEL (Claude Haiku 5.5, a twentieth of
 *   Sonnet's price). `isSimpleChat` decides, from the person's message alone.
 * - The cache's lifetime. Anthropic keeps a cached prompt five minutes by default. A chat
 *   in Slack or Discord has longer gaps between messages, so its turns ask for an hour
 *   (`LONG_CACHE_KEY` on the request context, set by ncat/slack.ts and ncat/discord.ts).
 *   An hour costs twice the input price to write instead of 1.25 times, and pays for
 *   itself on the second message that would otherwise have missed.
 */
import type { ProcessInputStepArgs, Processor } from '@mastra/core/processors';
import type { RequestContext } from '@mastra/core/request-context';
import { env } from '../../lib/env';
import { onTeamKey, teamKeyForTurn } from '../ncat/team-key';

/** Request-context key: the turn comes from a chat app, so its cache should last an hour. */
export const LONG_CACHE_KEY = 'longCache';

/** Request-context key: the team or the composer chose this turn's model, so keep it. */
export const MODEL_PICKED_KEY = 'modelPicked';

/** Request-context key, set for the turn: 'build' or 'simple'. */
export const ROUTE_KEY = 'costRoute';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Anthropic's cache breakpoint for this turn, as AI SDK provider options. */
export function cacheBreakpoint(requestContext?: Pick<RequestContext, 'get'>) {
  const long = requestContext?.get(LONG_CACHE_KEY) === true;
  return {
    anthropic: { cacheControl: long ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' } },
  } as const;
}

/** A cheap model from the same provider as `modelId`, for titles and memory notes. */
export function cheapModelFor(modelId: string): string {
  if (modelId.startsWith('anthropic/')) return 'anthropic/claude-haiku-5-5';
  if (modelId.startsWith('openai/')) return 'openai/gpt-4.1-nano';
  // Unknown provider (or AIMock): the chat model itself, which certainly has a key.
  return modelId;
}

// Asking, greeting or thanking, with nothing for the agent to build or change.
const ASKING =
  /^(what|what's|whats|how|why|when|where|which|who|is|are|does|do|did|should i|can i|could i|tell me|explain)\b/i;
const SMALL_TALK =
  /^(hi|hello|hey|thanks|thank you|thx|ty|cool|great|nice|ok|okay|got it|perfect|awesome|good (morning|afternoon|evening))\b[\s!.,]*([a-z']+[\s!.,]*){0,3}$/i;
// Asking the agent to do something, even when worded as a question.
const REQUEST = /\b(can you|could you|would you|will you|please|pls|let'?s|i want|i need|i'd like|go ahead)\b/i;

/**
 * True when a message only asks something or makes small talk, so a small model can
 * answer it. Anything that asks the agent to do something, or is long, is not.
 */
export function isSimpleChat(text: string): boolean {
  const message = text.trim();
  if (!message || message.length > 280 || message.includes('\n')) return false;
  if (SMALL_TALK.test(message)) return true;
  return ASKING.test(message) && !REQUEST.test(message);
}

/** The text of the last thing the person said in these messages. */
export function lastUserText(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: string; type?: string; content?: unknown };
    // The person's message reaches processors as a user "signal" in the agent controller.
    const fromPerson =
      message?.role === 'user' || (message?.role === 'signal' && message?.type === 'user');
    if (!fromPerson) continue;
    const content = message.content as
      | string
      | { parts?: { type?: string; text?: string }[]; content?: string }
      | { type?: string; text?: string }[];
    if (typeof content === 'string') return content;
    if (Array.isArray(content))
      return content.map((p) => (p?.type === 'text' ? (p.text ?? '') : '')).join(' ');
    if (content?.parts)
      return content.parts.map((p) => (p?.type === 'text' ? (p.text ?? '') : '')).join(' ');
    if (typeof content?.content === 'string') return content.content;
    return '';
  }
  return '';
}

/** Whether `modelId` takes `effort` and adaptive thinking (every current Claude model). */
export function takesEffort(modelId: string): boolean {
  return /claude-(sonnet|haiku|opus)-5|claude-(fable|mythos)|claude-opus-4-[678]|claude-sonnet-4-6/.test(
    modelId,
  );
}

/** The model id a step's model goes by, in `provider/model` form when it can tell. */
function idOf(model: unknown): string {
  if (typeof model === 'string') return model;
  const m = model as { modelId?: string; provider?: string } | undefined;
  if (!m?.modelId) return '';
  if (m.modelId.includes('/')) return m.modelId;
  const provider = (m.provider ?? '').split('.')[0];
  return provider ? `${provider}/${m.modelId}` : m.modelId;
}

/**
 * Picks each turn's model and effort (see the top of this file). The choice is made on
 * a turn's first step and kept for its other steps, so one turn never changes model in
 * the middle of a tool loop.
 */
export class CostRouteProcessor implements Processor<'cost-route'> {
  readonly id = 'cost-route' as const;
  private readonly promptCache: boolean;

  constructor({ promptCache = env.PROMPT_CACHE }: { promptCache?: boolean } = {}) {
    this.promptCache = promptCache;
  }

  async processInputStep({ messages, requestContext, model, providerOptions, state }: ProcessInputStepArgs) {
    const current = idOf(model);
    if (state.route === undefined) {
      const picked = requestContext?.get(MODEL_PICKED_KEY) === true;
      const simple =
        !picked &&
        !!env.SIMPLE_CHAT_MODEL &&
        current === env.CHAT_MODEL &&
        isSimpleChat(lastUserText(messages ?? []));
      state.route = simple ? 'simple' : 'build';
      requestContext?.set(ROUTE_KEY, state.route);
    }
    const simple = state.route === 'simple';
    const modelId = simple ? env.SIMPLE_CHAT_MODEL : current;
    const effort: Effort = simple ? 'low' : env.CHAT_EFFORT;
    const anthropic = {
      ...((providerOptions?.anthropic as Record<string, unknown> | undefined) ?? {}),
      ...(takesEffort(modelId) ? { effort } : {}),
      // The request-level breakpoint, with this turn's lifetime.
      ...(this.promptCache ? cacheBreakpoint(requestContext).anthropic : {}),
    };
    return {
      // On the team's own Anthropic key when it has one, like the chat model.
      ...(simple
        ? { model: onTeamKey(env.SIMPLE_CHAT_MODEL, await teamKeyForTurn(requestContext)) }
        : {}),
      providerOptions: { ...providerOptions, anthropic } as ProcessInputStepArgs['providerOptions'],
    };
  }
}
