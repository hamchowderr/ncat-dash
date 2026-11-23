import { outboundPool } from "./pools";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// The Webhook trigger's address: reading what a call sends, and the rules for answering
// it. The routes are in convex/http.ts, the work in convex/hooks.ts.

/** How long a call's Idempotency-Key is remembered. */
export const HOOK_KEY_MS = 24 * 60 * 60 * 1000;
/** The longest Idempotency-Key kept. */
export const MAX_HOOK_KEY = 200;
/** The most files one call can hand over. */
export const MAX_HOOK_FILES = 100;

const LINK = /^https?:\/\/\S+$/;

/** What a webhook call asks for, read from its JSON body. */
export interface HookCall {
  /** The file the run works on, from `file_url` (or `url`). */
  fileUrl?: string;
  /** Several files, from `files`: a list of links. */
  files?: string[];
  /** Where the run's end is reported, from `callback_url`. */
  callbackUrl?: string;
}

/** Reads a call's body. Says what is wrong, in plain words, when it cannot be used. */
export function readHookCall(
  body: Record<string, unknown>,
): { ok: true; call: HookCall } | { ok: false; message: string } {
  const call: HookCall = {};
  const fileUrl = [body.file_url, body.url].find(
    (value): value is string => typeof value === "string" && LINK.test(value),
  );
  if (fileUrl) call.fileUrl = fileUrl;
  if (body.files !== undefined) {
    if (!Array.isArray(body.files) || !body.files.every((each) => typeof each === "string")) {
      return { ok: false, message: "files must be a list of links." };
    }
    const files = body.files.filter((each) => each !== "");
    if (files.length > MAX_HOOK_FILES) {
      return { ok: false, message: `files can hold at most ${MAX_HOOK_FILES} links.` };
    }
    const bad = files.find((each) => !LINK.test(each));
    if (bad !== undefined)
      return { ok: false, message: `This is not a link: ${bad.slice(0, 100)}` };
    if (files.length > 0) call.files = files;
  }
  if (body.callback_url !== undefined) {
    if (typeof body.callback_url !== "string" || !LINK.test(body.callback_url)) {
      return { ok: false, message: "callback_url must be an http or https link." };
    }
    call.callbackUrl = body.callback_url;
  }
  return { ok: true, call };
}

/** What the run is started with: the file or files, and the whole body for its steps. */
export function hookTrigger(
  call: HookCall,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const fileUrl = call.fileUrl ?? call.files?.[0];
  return {
    ...(fileUrl ? { file_url: fileUrl } : {}),
    ...(call.files ? { files: call.files } : {}),
    body,
  };
}

/**
 * The token a call sends: in an `X-Takewon-Token` header, as `Authorization: Bearer`, or
 * (as the address has always carried it) in the address itself.
 */
export function hookTokenOf(request: Request, url: URL): string | null {
  const header = request.headers.get("x-takewon-token");
  if (header) return header.trim();
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  if (bearer) return bearer[1];
  return url.searchParams.get("token");
}

/** Whether two secrets are the same, taking as long whichever character differs. */
export function sameSecret(given: string, kept: string): boolean {
  let differs = given.length === kept.length ? 0 : 1;
  for (let i = 0; i < kept.length; i++) {
    differs |= kept.charCodeAt(i) ^ given.charCodeAt(i % Math.max(given.length, 1));
  }
  return differs === 0;
}

/** The signature of a callback body: HMAC-SHA256 with the automation's token, in hex. */
export async function signCallback(body: string, token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** When a run ends: books the report to its callback address, if its webhook gave one. */
export async function reportRunEnd(ctx: MutationCtx, run: Doc<"runs">): Promise<void> {
  if (!run.callbackUrl || run.test) return;
  await outboundPool.enqueueAction(ctx, internal.hooks.sendCallback, { runId: run._id });
}
