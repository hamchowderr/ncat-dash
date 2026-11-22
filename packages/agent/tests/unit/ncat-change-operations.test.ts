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

  it('leaves every change that is not a trigger alone', () => {
    const add = { op: 'add' as const, type: 'clips' };
    expect(asSent(add)).toBe(add);
  });

  // Found in the Product Overview thread (2026-11-22): the model sent an upload trigger
  // with no file type, Convex refused it as "Server Error", and it retried blind.
  it('lets an upload or folder trigger take any file when no type is given', () => {
    expect(asSent({ op: 'trigger', trigger: { kind: 'upload' } })).toEqual({
      op: 'trigger',
      trigger: { kind: 'upload', fileType: 'any' },
    });
    expect(asSent({ op: 'addTrigger', trigger: { kind: 'folder', prefix: 'in/' } })).toEqual({
      op: 'addTrigger',
      trigger: { kind: 'folder', prefix: 'in/', fileType: 'any' },
    });
  });

  it('drops settings no trigger has, which Convex would refuse', () => {
    expect(asSent({ op: 'trigger', trigger: { kind: 'manual', label: 'Go' } })).toEqual({
      op: 'trigger',
      trigger: { kind: 'manual' },
    });
  });

  it('says what is wrong with a trigger instead of sending it', () => {
    expect(() => asSent({ op: 'trigger', trigger: { kind: 'upload', fileType: 'pdf' } })).toThrow(
      /upload trigger is not right: fileType: .*list_step_types/,
    );
    expect(() => asSent({ op: 'trigger', trigger: { kind: 'schedule' } })).toThrow(/schedule:/);
    expect(() => asSent({ op: 'trigger', trigger: { kind: 'email' } })).toThrow(
      'There is no trigger "email".',
    );
  });
});

describe('an error the dashboard gave no reason for', () => {
  it('tells the model what to check instead of "Server Error"', () => {
    const message = plainError(new Error('[Request ID: 53d19a3d2110cc4d] Server Error'));
    expect(message).not.toContain('Request ID');
    expect(message).toMatch(/^Takewon could not do that/);
    expect(message).not.toContain('dashboard');
    expect(message).toContain('list_step_types');
  });

  it('keeps the dashboard\'s own reasons', () => {
    expect(plainError({ data: { message: 'There is no step called "x".' } })).toBe(
      'There is no step called "x".',
    );
  });
});
