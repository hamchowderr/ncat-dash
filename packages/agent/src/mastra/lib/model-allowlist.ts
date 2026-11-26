// Models a turn may run on: the composer's pick, or a team's (Settings → Agent in the
// dashboard, AGENT_MODELS in automation-core). Keep in sync with web `MODELS` in
// components/chat/composer.tsx. An id not listed here falls back to the agent's own
// `model: env.CHAT_MODEL` rather than erroring.
export const MODEL_ALLOWLIST: ReadonlySet<string> = new Set([
  'anthropic/claude-sonnet-5-5',
  'anthropic/claude-opus-5-5',
  'anthropic/claude-haiku-5-5',
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-opus-4-8',
  'anthropic/claude-haiku-4-5',
  'openai/gpt-4.1-mini',
  'openai/gpt-4o-mini',
  'openai/gpt-4.1-nano',
]);
