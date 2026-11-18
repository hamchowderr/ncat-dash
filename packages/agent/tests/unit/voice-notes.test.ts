import { afterEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  CONVEX_URL: undefined as string | undefined,
  CONVEX_SITE_URL: undefined as string | undefined,
  MASTRA_JWT_SECRET: undefined as string | undefined,
  SLACK_API_URL: undefined as string | undefined,
}));
vi.mock('../../src/lib/env', () => ({ env }));

import { asTheDiscordWriter, useDashboardForTests as discordAnswers } from '../../src/mastra/ncat/discord';
import { forgetSessions } from '../../src/mastra/ncat/session-store';
import { asTheWriter, useDashboardForTests as slackAnswers } from '../../src/mastra/ncat/slack';
import {
  hearVoiceNotes,
  heardLine,
  MAX_VOICE_NOTE_BYTES,
  useTranscriberForTests,
  voiceNoteType,
} from '../../src/mastra/ncat/voice-notes';

// Voice notes sent to the agent in Slack or Discord are read as the words said in them,
// turned into words by the team's own toolkit before the agent sees the message.

afterEach(() => {
  useTranscriberForTests();
  slackAnswers();
  discordAnswers();
  forgetSessions();
  for (const key of Object.keys(env) as (keyof typeof env)[]) env[key] = undefined;
  vi.unstubAllGlobals();
});

function note(overrides: Record<string, unknown> = {}) {
  return {
    type: 'audio' as const,
    mimeType: 'audio/webm',
    name: 'audio_message.webm',
    fetchData: async () => Buffer.from('fake audio bytes'),
    ...overrides,
  };
}

function message(text: string, attachments: unknown[]) {
  return {
    text,
    formatted: { type: 'root', children: text ? [{ type: 'paragraph', children: [{ type: 'text', value: text }] }] : [] },
    attachments,
    raw: { team: 'T1' },
    author: { userId: 'U1', isBot: false, isMe: false },
  } as never as Parameters<typeof hearVoiceNotes>[1];
}

describe('which attachments are voice notes', () => {
  it('takes audio of any kind, and leaves pictures and video alone', () => {
    expect(voiceNoteType(note() as never)).toBe('audio/webm');
    expect(voiceNoteType(note({ mimeType: 'audio/ogg; codecs=opus' }) as never)).toBe('audio/ogg');
    expect(voiceNoteType(note({ mimeType: undefined }) as never)).toBe('audio/ogg');
    expect(voiceNoteType({ type: 'image', mimeType: 'image/png' } as never)).toBeNull();
    expect(voiceNoteType({ type: 'video', mimeType: 'video/mp4' } as never)).toBeNull();
  });
});

describe('hearing a voice note', () => {
  it('adds the words to the message and takes the audio out', async () => {
    const asked: { organizationId: string; size: number; mimeType: string }[] = [];
    useTranscriberForTests(async (organizationId, audio, mimeType) => {
      asked.push({ organizationId, size: audio.byteLength, mimeType });
      return { ok: true, text: 'Make clips from every new episode' };
    });
    const picture = { type: 'image', mimeType: 'image/png', url: 'https://x/p.png' };
    const m = message('', [note(), picture]);
    const startTyping = vi.fn(async () => undefined);
    await hearVoiceNotes({ startTyping }, m, 'team_1');
    expect(asked).toEqual([{ organizationId: 'team_1', size: 16, mimeType: 'audio/webm' }]);
    expect(m.text).toBe(
      'Voice note, turned into words by the toolkit (it may have small mistakes): "Make clips from every new episode"',
    );
    expect(JSON.stringify(m.formatted)).toContain('Make clips from every new episode');
    expect(m.attachments).toEqual([picture]);
    expect(startTyping).toHaveBeenCalledWith('is listening to your voice note…');
  });

  it('keeps what was typed, and numbers several notes', async () => {
    let n = 0;
    useTranscriberForTests(async () => ({ ok: true, text: `part ${++n}` }));
    const m = message('Here you go', [note(), note()]);
    await hearVoiceNotes({}, m, 'team_1');
    expect(m.text).toBe(
      'Here you go\n\nVoice note 1, turned into words by the toolkit (it may have small mistakes): "part 1"\n\nVoice note 2, turned into words by the toolkit (it may have small mistakes): "part 2"',
    );
  });

  it('tells the agent when a note could not be read, so it can ask them to type it', async () => {
    useTranscriberForTests(async () => ({ ok: false, reason: 'Connect your toolkit first' }));
    const m = message('', [note()]);
    await hearVoiceNotes({}, m, 'team_1');
    expect(m.text).toContain('could not be turned into words: Connect your toolkit first');
    expect(m.attachments).toEqual([]);
  });

  it('does not send a note that is too large', async () => {
    const transcriber = vi.fn();
    useTranscriberForTests(transcriber);
    const m = message('', [note({ size: MAX_VOICE_NOTE_BYTES + 1 })]);
    await hearVoiceNotes({}, m, 'team_1');
    expect(transcriber).not.toHaveBeenCalled();
    expect(m.text).toContain('too large');
  });

  it('leaves a message with no voice note exactly as it was', async () => {
    const transcriber = vi.fn();
    useTranscriberForTests(transcriber);
    const m = message('hello', [{ type: 'file', mimeType: 'application/pdf' }]);
    const before = JSON.stringify(m);
    await hearVoiceNotes({}, m, 'team_1');
    expect(JSON.stringify(m)).toBe(before);
    expect(transcriber).not.toHaveBeenCalled();
  });

  it('says plainly when no words were heard', () => {
    expect(heardLine({ ok: true, text: '' }, false, 0)).toContain('no words could be heard');
  });
});

describe('the dashboard side', () => {
  it('posts the bytes, signed, to /agent/voice-note for the team', async () => {
    env.CONVEX_SITE_URL = 'https://dash.example.site';
    env.MASTRA_JWT_SECRET = 'a-secret-that-is-long-enough-for-hs256';
    const fetchMock = vi.fn(async () => Response.json({ text: 'hi there' }));
    vi.stubGlobal('fetch', fetchMock);
    const m = message('', [note()]);
    await hearVoiceNotes({}, m, 'team 1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://dash.example.site/agent/voice-note?organizationId=team%201');
    expect((init.headers as Record<string, string>).authorization).toMatch(/^Bearer .+\..+\..+$/);
    expect((init.headers as Record<string, string>)['content-type']).toBe('audio/webm');
    expect(m.text).toContain('"hi there"');
  });

  it('passes on the reason the dashboard gives', async () => {
    env.CONVEX_SITE_URL = 'https://dash.example.site';
    env.MASTRA_JWT_SECRET = 'a-secret-that-is-long-enough-for-hs256';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Voice notes can be up to 25 MB.' }, { status: 422 })));
    const m = message('', [note()]);
    await hearVoiceNotes({}, m, 'team_1');
    expect(m.text).toContain('Voice notes can be up to 25 MB.');
  });
});

describe('in Slack and Discord', () => {
  const context = () => ({ requestContext: { set: () => undefined } });

  it('Slack: the agent gets the words of a voice note from someone on the team', async () => {
    slackAnswers(async (path) =>
      path === '/slack/person'
        ? ({ ok: true, userId: 'u1', name: 'Ada', organizationId: 'team_1', convexToken: 'jwt' } as never)
        : null,
    );
    useTranscriberForTests(async (organizationId) => ({ ok: true, text: `for ${organizationId}` }));
    const m = message('', [note()]);
    const next = vi.fn();
    await asTheWriter({ id: 'slack:C1:1.2', post: vi.fn() } as never, m as never, next, context() as never);
    expect(next).toHaveBeenCalledOnce();
    expect((next.mock.calls[0][1] as { text: string }).text).toContain('"for team_1"');
  });

  it('Discord: the same, and nothing is heard for someone not on the team', async () => {
    discordAnswers(async () => ({ ok: false, reason: 'not_linked' }));
    const transcriber = vi.fn();
    useTranscriberForTests(transcriber);
    const next = vi.fn();
    await asTheDiscordWriter(
      { id: 'discord:1:2', post: vi.fn() } as never,
      message('', [note()]) as never,
      next,
      context() as never,
    );
    expect(transcriber).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();

    discordAnswers(async () => ({ ok: true, userId: 'u1', name: 'Ada', organizationId: 'team_2', convexToken: 'jwt' }));
    useTranscriberForTests(async (organizationId) => ({ ok: true, text: `for ${organizationId}` }));
    const m = message('', [note({ mimeType: 'audio/ogg' })]);
    await asTheDiscordWriter({ id: 'discord:1:2', post: vi.fn() } as never, m as never, next, context() as never);
    expect(m.text).toContain('"for team_2"');
  });
});
