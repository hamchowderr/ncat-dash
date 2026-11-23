import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mayFire,
  ownerOf,
  scheduleHooks,
  useDashboardForTests,
} from '../../src/mastra/ncat/schedule-gate';
import { forgetSessions, rememberSession } from '../../src/mastra/ncat/session-store';

// The agent's own schedules fire with nobody watching, so each fire asks the dashboard
// first: none once the team's trial is over, or the team or person is blocked.

afterEach(() => {
  useDashboardForTests();
  forgetSessions();
});

describe('who a schedule is for', () => {
  it('is the team and person signed in on the turn that made it', () => {
    rememberSession('user_1', { convexToken: 't', organizationId: 'team_1', automationId: null });
    expect(ownerOf('user_1')).toEqual({ organizationId: 'team_1', userId: 'user_1' });
  });

  it('is the person, not the team-and-person id the dashboard chat runs under', () => {
    rememberSession('user_1~team_1', {
      convexToken: 't',
      organizationId: 'team_1',
      automationId: null,
    });
    expect(ownerOf('user_1~team_1')).toEqual({ organizationId: 'team_1', userId: 'user_1' });
  });

  it('in Slack or Discord it is the team only, since the thread is not one person', () => {
    rememberSession('channel:slack:C1:1.2', {
      convexToken: 't',
      organizationId: 'team_1',
      automationId: null,
    });
    expect(ownerOf('channel:slack:C1:1.2')).toEqual({ organizationId: 'team_1' });
  });

  it('is nobody when there is no team open', () => {
    expect(ownerOf('user_2')).toBeNull();
  });
});

describe('before a schedule fires', () => {
  it('fires when the dashboard says yes, asking with the team and person', async () => {
    const asked = vi.fn(async () => ({ ok: true as const }));
    useDashboardForTests(asked);
    expect(await mayFire({ metadata: { organizationId: 'team_1', userId: 'user_1' } })).toBe(true);
    expect(asked).toHaveBeenCalledWith({ organizationId: 'team_1', userId: 'user_1' });
  });

  it('is skipped once the trial is over or the team is blocked', async () => {
    useDashboardForTests(async () => ({ ok: false, message: 'Your free trial has ended.' }));
    const schedule = { metadata: { organizationId: 'team_1' } };
    expect(await mayFire(schedule)).toBe(false);
    // Mastra skips a fire whose prepare hook answers null.
    expect(await scheduleHooks.prepare({ schedule })).toBeNull();
  });

  it('is skipped when the dashboard cannot be reached; the next fire asks again', async () => {
    useDashboardForTests(async () => null);
    expect(await mayFire({ metadata: { organizationId: 'team_1' } })).toBe(false);
  });

  it('a schedule with no team on it fires as before, without asking', async () => {
    const asked = vi.fn();
    useDashboardForTests(asked);
    expect(await mayFire({})).toBe(true);
    expect(await scheduleHooks.prepare({ schedule: {} })).toBeUndefined();
    expect(asked).not.toHaveBeenCalled();
  });
});
