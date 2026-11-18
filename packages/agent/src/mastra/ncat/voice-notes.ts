import type { Attachment, Message } from 'chat';
import { env } from '../../lib/env';
import { convexSiteUrl, signForDashboard } from './slack';

/**
 * Voice notes sent to the agent in Slack or Discord. Before the agent reads a message, any
 * voice note or audio clip in it is turned into words by the team's own toolkit (through
 * the dashboard's /agent/voice-note), and the words are added to the message. The agent
 * then reads what was said, as if it had been typed, and the audio itself is not handed on.
 */

/** Notes larger than this are not sent: the dashboard refuses them too. */
export const MAX_VOICE_NOTE_BYTES = 25 * 1024 * 1024;
/** A message rarely carries more than one; past this many the rest are left out. */
const MAX_NOTES = 3;

export type Heard = { ok: true; text: string } | { ok: false; reason: string };

type Transcribe = (organizationId: string, audio: Uint8Array, mimeType: string) => Promise<Heard>;

const askDashboard: Transcribe = async (organizationId, audio, mimeType) => {
  const site = convexSiteUrl();
  const secret = env.MASTRA_JWT_SECRET;
  if (!site || !secret) return { ok: false, reason: "the dashboard can't be reached" };
  try {
    const response = await fetch(
      `${site}/agent/voice-note?organizationId=${encodeURIComponent(organizationId)}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${signForDashboard(secret)}`, 'content-type': mimeType },
        body: new Blob([audio as Uint8Array<ArrayBuffer>], { type: mimeType }),
        signal: AbortSignal.timeout(6 * 60_000),
      },
    );
    const answer = (await response.json().catch(() => ({}))) as { text?: unknown; error?: unknown };
    if (response.ok && typeof answer.text === 'string') return { ok: true, text: answer.text };
    return {
      ok: false,
      reason: typeof answer.error === 'string' ? answer.error : `the dashboard answered ${response.status}`,
    };
  } catch (error) {
    console.error('[voice-notes] could not reach the dashboard', error);
    return { ok: false, reason: "the dashboard can't be reached" };
  }
};

let transcribe: Transcribe = askDashboard;

/** For tests: answer for the dashboard. Pass nothing to undo. */
export function useTranscriberForTests(answer?: Transcribe): void {
  transcribe = answer ?? askDashboard;
}

/** The audio type of an attachment, or null when it is not a voice note or audio clip. */
export function voiceNoteType(attachment: Attachment): string | null {
  const mime = attachment.mimeType?.split(';')[0].trim().toLowerCase() ?? '';
  if (mime.startsWith('audio/')) return mime;
  // Discord's voice messages and some Slack clips name no type, only "audio".
  if (attachment.type === 'audio') return mime || 'audio/ogg';
  return null;
}

/** The line the agent reads for one note. */
export function heardLine(heard: Heard, many: boolean, index: number): string {
  const which = many ? `Voice note ${index + 1}` : 'Voice note';
  if (!heard.ok) {
    return `(${which} came with this message, but it could not be turned into words: ${heard.reason}. Ask them to type it instead.)`;
  }
  if (!heard.text) return `(${which} came with this message, but no words could be heard in it.)`;
  return `${which}, turned into words by the toolkit (it may have small mistakes): "${heard.text}"`;
}

async function bytesOf(attachment: Attachment): Promise<Uint8Array | null> {
  if (attachment.size && attachment.size > MAX_VOICE_NOTE_BYTES) return null;
  let data: Buffer | ArrayBuffer | Blob | undefined = attachment.data;
  if (!data && attachment.fetchData) data = await attachment.fetchData();
  if (!data && attachment.url) {
    const response = await fetch(attachment.url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) return null;
    data = await response.arrayBuffer();
  }
  if (!data) return null;
  const bytes =
    data instanceof Blob
      ? new Uint8Array(await data.arrayBuffer())
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return bytes.byteLength > 0 && bytes.byteLength <= MAX_VOICE_NOTE_BYTES ? bytes : null;
}

type Thread = { startTyping?: (status?: string) => Promise<void> };

/**
 * Turns the voice notes in a message into words, in place: their words are added to the
 * message's text, and the notes are taken out of its attachments. A message with no voice
 * note is left exactly as it was.
 */
export async function hearVoiceNotes(
  thread: Thread,
  message: Message,
  organizationId: string,
): Promise<void> {
  const notes = (message.attachments ?? []).flatMap((attachment) => {
    const mimeType = voiceNoteType(attachment);
    return mimeType ? [{ attachment, mimeType }] : [];
  });
  if (notes.length === 0) return;
  await thread.startTyping?.('is listening to your voice note…').catch(() => undefined);
  const kept = notes.slice(0, MAX_NOTES);
  const lines: string[] = [];
  for (const [index, note] of kept.entries()) {
    let heard: Heard;
    try {
      const bytes = await bytesOf(note.attachment);
      heard = bytes
        ? await transcribe(organizationId, bytes, note.mimeType)
        : { ok: false, reason: 'it is too large or could not be downloaded' };
    } catch {
      heard = { ok: false, reason: 'it could not be downloaded' };
    }
    lines.push(heardLine(heard, kept.length > 1, index));
  }
  const added = lines.join('\n\n');
  const said = message.text?.trim() ?? '';
  message.text = said ? `${said}\n\n${added}` : added;
  // The agent reads `formatted` first when there is one, so the words go there too.
  const formatted = message.formatted as { children?: unknown[] } | undefined;
  if (formatted && Array.isArray(formatted.children)) {
    for (const line of lines) {
      formatted.children.push({ type: 'paragraph', children: [{ type: 'text', value: line }] });
    }
  }
  const voice = new Set(notes.map((note) => note.attachment));
  message.attachments = message.attachments.filter((attachment) => !voice.has(attachment));
}
