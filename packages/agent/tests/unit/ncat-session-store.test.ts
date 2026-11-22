import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  forgetSessions,
  personOf,
  rememberMade,
  rememberSession,
  sessionOf,
  workingAutomationOf,
} from '../../src/mastra/ncat/session-store';

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

describe('a person on two teams', () => {
  it('gets one session per team, so memory kept per resource stays apart', () => {
    rememberSession('ada~team_1', { ...hand('a1'), organizationId: 'team_1' });
    rememberSession('ada~team_2', { ...hand('b1'), organizationId: 'team_2' });
    expect(sessionOf('ada~team_1')?.organizationId).toBe('team_1');
    expect(sessionOf('ada~team_2')?.organizationId).toBe('team_2');
    expect(sessionOf('ada~team_2')?.automationId).toBe('b1');
  });

  it('is read back as the person', () => {
    expect(personOf('ada~team_1')).toBe('ada');
    expect(personOf('ada')).toBe('ada');
    expect(personOf('channel:slack:C1:1.2')).toBeNull();
  });
});
