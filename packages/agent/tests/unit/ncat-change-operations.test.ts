import { describe, expect, it } from 'vitest';
import { asSent } from '../../src/mastra/ncat/tools';
import { plainError } from '../../src/mastra/ncat/convex';

// Both found by a real model run (recorded 2026-11-17).
describe('a change as the dashboard takes it', () => {
  it('drops "trigger:" from a trigger kind, as the step list names it', () => {
    expect(asSent({ op: 'trigger', trigger: { kind: 'trigger:upload', fileType: 'video' } })).toEqual({
      op: 'trigger',
      trigger: { kind: 'upload', fileType: 'video' },
    });
  });

  it('leaves every other change alone', () => {
    const op = { op: 'trigger' as const, trigger: { kind: 'upload' } };
    expect(asSent(op)).toBe(op);
    const add = { op: 'add' as const, type: 'clips' };
    expect(asSent(add)).toBe(add);
  });
});

describe('an error the dashboard gave no reason for', () => {
  it('tells the model what to check instead of "Server Error"', () => {
    const message = plainError(new Error('[Request ID: 53d19a3d2110cc4d] Server Error'));
    expect(message).not.toContain('Request ID');
    expect(message).toContain('list_step_types');
  });

  it('keeps the dashboard\'s own reasons', () => {
    expect(plainError({ data: { message: 'There is no step called "x".' } })).toBe(
      'There is no step called "x".',
    );
  });
});
