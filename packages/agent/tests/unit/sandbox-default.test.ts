import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The shell (execute_command) runs as the agent server itself, so whoever chats with the
 * agent could read the server's settings (the shared secret, the bot tokens) and every
 * team's memory. A server only has it when WORKSPACE_SANDBOX turns it on. (The test
 * config turns it on for the kit's own tests; this file clears that.)
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the shell sandbox', () => {
  it('is off when WORKSPACE_SANDBOX is not set', async () => {
    vi.stubEnv('WORKSPACE_SANDBOX', undefined);
    vi.resetModules();
    const { env } = await import('../../src/lib/env');
    const { features } = await import('../../src/mastra/lib/features');
    expect(env.WORKSPACE_SANDBOX).toBe(false);
    expect(features.sandbox).toBe(false);
    // Nothing that needs the shell is offered either.
    expect(features.subagents.code).toBe(false);
    expect(features.browser).not.toBe('viewer');
  });

  it('is on only when asked for', async () => {
    vi.stubEnv('WORKSPACE_SANDBOX', 'true');
    vi.resetModules();
    const { features } = await import('../../src/mastra/lib/features');
    expect(features.sandbox).toBe(true);
  });
});
