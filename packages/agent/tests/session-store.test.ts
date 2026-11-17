import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  forgetSessions,
  rememberMade,
  rememberSession,
  sessionOf,
  workingAutomationOf,
} from '../src/mastra/ncat/session-store';

const hand = (automationId: string | null) => ({
  convexToken: 'token',
  organizationId: 'team_1',
  automationId,
});

afterEach(() => {
  forgetSessions();
  vi.useRealTimers();
});

describe('what the dashboard hands over', () => {
  it('is kept per person', () => {
    rememberSession('ada', hand('a1'));
    expect(sessionOf('ada')?.automationId).toBe('a1');
    expect(sessionOf('grace')).toBeNull();
    expect(sessionOf(undefined)).toBeNull();
  });

  it('is dropped once the token is too old to work', () => {
    vi.useFakeTimers();
    rememberSession('ada', hand('a1'));
    vi.advanceTimersByTime(31 * 60 * 1000);
    expect(sessionOf('ada')).toBeNull();
  });
});

describe('the automation a tool works on', () => {
  it('is the one on screen', () => {
    rememberSession('ada', hand('a1'));
    rememberMade('ada', 'made');
    expect(workingAutomationOf(sessionOf('ada')!)).toBe('a1');
  });

  it('is the one the agent just made when none is on screen, across hand-overs', () => {
    rememberSession('ada', hand(null));
    rememberMade('ada', 'made');
    rememberSession('ada', hand(null));
    expect(workingAutomationOf(sessionOf('ada')!)).toBe('made');
  });

  it('is nothing when neither is known', () => {
    rememberSession('ada', hand(null));
    expect(workingAutomationOf(sessionOf('ada')!)).toBeNull();
  });
});
