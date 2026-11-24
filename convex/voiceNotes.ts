import { callStep, getStep, ToolkitError } from "@takewon/step-catalog";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { type ActionCtx, internalAction } from "./_generated/server";
import { bucketOf, deleteObject, presign, type Bucket } from "./lib/bucket";

/**
 * Voice notes sent to the agent in Slack or Discord. Each is put in the team's bucket,
 * turned into words by the team's own toolkit (its transcribe request, faster-whisper on
 * Chowderr's fork), and removed again. The words are what the agent reads. No audio goes
 * to anyone but the team's toolkit. (In the dashboard's own chat the browser dictates
 * live instead, which is faster.)
 */

/** Voice notes longer than this are refused: a note is a few minutes at most. */
export const MAX_VOICE_NOTE_BYTES = 25 * 1024 * 1024;
const UPLOAD_LINK_SECONDS = 10 * 60;
const READ_LINK_SECONDS = 30 * 60;
const TRANSCRIBE_TIMEOUT_MS = 5 * 60 * 1000;

const NO_TOOLKIT = "Connect your toolkit first: it is what turns voice notes into words.";

const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
};

/** The file ending for a recording's type ("audio/webm;codecs=opus" is webm), or null. */
export function voiceNoteExtension(contentType: string): string | null {
  return EXTENSIONS[contentType.split(";")[0].trim().toLowerCase()] ?? null;
}

const KEY = /^voice-notes\/[0-9a-f-]{36}\.(webm|ogg|m4a|mp4|mp3|wav)$/;

/** True for a key a voice note is stored under, so nothing else in the bucket is read. */
export function isVoiceNoteKey(key: string): boolean {
  return KEY.test(key);
}

/** The words in a toolkit transcribe answer, tidied, or "" when it heard none. */
export function transcriptOf(answer: unknown): string {
  const response = (answer as { response?: unknown } | null)?.response;
  const text = (response as { text?: unknown } | null)?.text;
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
}

async function teamBucket(ctx: ActionCtx, organizationId: string): Promise<Bucket> {
  const storage = await ctx.runQuery(internal.storage.load, { organizationId });
  if (!storage) throw new ConvexError({ code: "no_toolkit", message: NO_TOOLKIT });
  return await bucketOf(storage);
}

/** Has the team's toolkit transcribe the note at `key`, then removes the note. */
async function transcribeKey(bucket: Bucket, key: string): Promise<string> {
  const step = getStep("media-transcribe");
  if (!step) throw new Error("The transcribe step is missing from the catalog.");
  try {
    const mediaUrl = await presign(bucket, "GET", key, READ_LINK_SECONDS);
    // No webhook: the toolkit answers when the words are ready. A note is short.
    const answer = await callStep(
      { baseUrl: bucket.baseUrl, apiKey: bucket.apiKey },
      step,
      { media_url: mediaUrl, include_text: true, response_type: "direct" },
      { signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS) },
    );
    return transcriptOf(answer);
  } catch (error) {
    const message =
      error instanceof ToolkitError
        ? `Your toolkit could not turn the voice note into words (HTTP ${error.status}).`
        : "Your toolkit could not be reached to turn the voice note into words.";
    throw new ConvexError({ code: "transcribe_failed", message });
  } finally {
    await deleteObject(bucket, key).catch(() => undefined);
  }
}

/**
 * The words of a voice note sent to the agent in Slack or Discord. The agent server
 * already found who sent it on the team, and passes the bytes here (see http.ts).
 */
export const transcribeAudio = internalAction({
  args: { organizationId: v.string(), audio: v.bytes(), contentType: v.string() },
  returns: v.object({ text: v.string() }),
  handler: async (ctx, args) => {
    const extension = voiceNoteExtension(args.contentType);
    if (!extension) {
      throw new ConvexError({ code: "not_audio", message: "That file is not audio." });
    }
    if (args.audio.byteLength === 0 || args.audio.byteLength > MAX_VOICE_NOTE_BYTES) {
      throw new ConvexError({ code: "too_large", message: "Voice notes can be up to 25 MB." });
    }
    const bucket = await teamBucket(ctx, args.organizationId);
    const key = `voice-notes/${crypto.randomUUID()}.${extension}`;
    const uploadUrl = await presign(bucket, "PUT", key, UPLOAD_LINK_SECONDS);
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": args.contentType.split(";")[0].trim() },
      body: args.audio,
    });
    if (!put.ok) {
      throw new ConvexError({
        code: "transcribe_failed",
        message: "The voice note could not be put in your team's storage.",
      });
    }
    return { text: await transcribeKey(bucket, key) };
  },
});
