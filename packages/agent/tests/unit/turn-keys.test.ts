import { describe, expect, it } from 'vitest';
import { createChatAgent } from '../../src/mastra/agents/chat';
import { FULL_FEATURES } from '../../src/mastra/lib/features';
import { turnRequestContextSchema } from '../../src/mastra/lib/turn-keys';

describe("what a chat turn carries on its request context", () => {
  it('takes every value this server sets, with its type', () => {
    expect(
      turnRequestContextSchema.safeParse({
        webSearch: true,
        timeZone: 'America/Los_Angeles',
        connectorsOff: ['slack'],
        'turn.userId': 'user_1~team_1',
        modelPicked: true,
        longCache: true,
        noWorkspace: false,
      }).success,
    ).toBe(true);
  });

  it("lets Mastra's and the controller's own keys through untouched", () => {
    const parsed = turnRequestContextSchema.safeParse({
      controller: { session: { modelId: 'anthropic/claude-sonnet-5-5' } },
      mastra__resourceId: 'user_1~team_1',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a value of the wrong type', () => {
    expect(turnRequestContextSchema.safeParse({ webSearch: 'yes' }).success).toBe(false);
    expect(turnRequestContextSchema.safeParse({ connectorsOff: 'slack' }).success).toBe(false);
    expect(turnRequestContextSchema.safeParse({ 'turn.userId': '' }).success).toBe(false);
  });

  it('is what the chat agent checks before each turn', () => {
    const agent = createChatAgent(FULL_FEATURES);
    expect((agent as unknown as { requestContextSchema?: unknown }).requestContextSchema).toBe(
      turnRequestContextSchema,
    );
  });
});
