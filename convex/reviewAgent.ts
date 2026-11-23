import { type AutomationDraft, outline } from "@ncat-dash/automation-core";
import {
  AGENT,
  AGENT_ANSWER_LIMIT,
  type ClipSense,
  FRAMES_GRID,
  FRAMES_PER_SECOND,
  FRAMES_SPAN,
  formatMoment,
  isVideoUrl,
  LISTEN_SPAN,
  measureCode,
  readMeasurements,
  senseFrom,
  transcriptNear,
  windowAround,
} from "@ncat-dash/review-core";
import { callStep, getStep } from "@ncat-dash/step-catalog";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { notify } from "./lib/alerts";
import { decryptSecret } from "./lib/crypto";
import { brandOf } from "./lib/queue";

// How the agent answers "@Agent" in a review room.
//
// Convex gathers what the agent needs to know (the clip, the moment, the thread, the
// automation that made the clip) and a still of the moment from the team's own toolkit,
// sends it to the agent server, and writes the answer itself. The agent server gets no
// key to Convex, and the person who asked cannot write the answer for it.

/** Long enough for a thoughtful answer from a slow model, short of Convex's action limit. */
const AGENT_TIMEOUT_MS = 240_000;
/** Each look at the clip through the toolkit (still, measuring, frames, transcript). */
const LOOK_TIMEOUT_MS = 100_000;

export type ReviewQuestion = {
  review: { title: string; status: string };
  clip: { title: string; version: number; versions: number; url: string; isVideo: boolean };
  moment: { seconds: number; label: string } | null;
  thread: { author: string; body: string; isAgent: boolean }[];
  otherNotes: { at: string | null; author: string; body: string; resolved: boolean }[];
  automation: { name: string; outline: string; runStatus: string } | null;
  askedBy: string;
};

export const load = internalQuery({
  args: { answerId: v.id("reviewComments") },
  handler: async (ctx, args) => {
    const answer = await ctx.db.get(args.answerId);
    if (!answer?.agent || answer.agent.state !== "thinking" || !answer.parentId) return null;
    const [review, clip] = await Promise.all([
      ctx.db.get(answer.reviewId),
      ctx.db.get(answer.clipId),
    ]);
    if (!review || !clip) return null;

    const comments = await ctx.db
      .query("reviewComments")
      .withIndex("by_clip", (q) => q.eq("clipId", clip._id))
      .take(500);
    const rootId = answer.parentId;
    const shown = (comment: Doc<"reviewComments">) =>
      !(comment.agent && comment.agent.state !== "answered");
    const thread = comments
      .filter(
        (comment) => (comment._id === rootId || comment.parentId === rootId) && shown(comment),
      )
      .map((comment) => ({
        author: comment.authorName,
        body: comment.body,
        isAgent: comment.agent !== undefined,
      }));
    const root = comments.find((comment) => comment._id === rootId);
    const version = clip.versions[(root?.version ?? clip.versions.length) - 1] ?? clip.versions[0];
    const isVideo = isVideoUrl(version.url);
    const otherNotes = comments
      .filter(
        (comment) =>
          !comment.parentId &&
          comment._id !== rootId &&
          comment.version === (root?.version ?? answer.version),
      )
      .slice(0, 40)
      .map((comment) => ({
        at: isVideo ? formatMoment(comment.time) : null,
        author: comment.authorName,
        body: comment.body.slice(0, 500),
        resolved: comment.resolved,
      }));

    let automation: ReviewQuestion["automation"] = null;
    if (review.runId) {
      const run = await ctx.db.get(review.runId);
      const made = run ? await ctx.db.get(run.automationId) : null;
      if (run && made) {
        const brand = await brandOf(ctx, made.organizationId);
        const live = {
          name: made.name,
          trigger: made.trigger,
          nodes: made.nodes,
          edges: made.edges,
        } as AutomationDraft;
        automation = {
          name: run.automationName,
          outline: outline(live, brand),
          runStatus: run.status,
        };
      }
    }

    const asker = comments.find(
      (comment) => comment.authorId === answer.agent?.askedBy && comment.parentId === rootId,
    );
    const question: ReviewQuestion = {
      review: { title: review.title, status: review.status },
      clip: {
        title: clip.title,
        version: root?.version ?? answer.version,
        versions: clip.versions.length,
        url: version.url,
        isVideo,
      },
      moment: isVideo
        ? { seconds: root?.time ?? answer.time, label: formatMoment(root?.time ?? answer.time) }
        : null,
      thread,
      otherNotes,
      automation,
      askedBy: asker?.authorName ?? root?.authorName ?? "A teammate",
    };

    const connection = await ctx.db
      .query("toolkitConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", answer.organizationId))
      .first();
    return {
      askedBy: answer.agent.askedBy,
      question,
      toolkit: connection
        ? { baseUrl: connection.baseUrl, apiKeyCipher: connection.apiKeyCipher }
        : null,
    };
  },
});

export const settle = internalMutation({
  args: {
    answerId: v.id("reviewComments"),
    body: v.string(),
    ok: v.boolean(),
  },
  handler: async (ctx, args) => {
    const answer = await ctx.db.get(args.answerId);
    // Deleted while the agent was thinking, or already settled by an earlier try.
    if (!answer?.agent || answer.agent.state !== "thinking") return;
    const body = args.body.trim().slice(0, AGENT_ANSWER_LIMIT);
    await ctx.db.patch(answer._id, {
      body,
      agent: { askedBy: answer.agent.askedBy, state: args.ok ? "answered" : "failed" },
    });
    // The person who asked hears that the answer is in, wherever they chose to. A failed
    // try says so in the thread, where they can ask again.
    if (!args.ok) return;
    const [review, clip] = await Promise.all([
      ctx.db.get(answer.reviewId),
      ctx.db.get(answer.clipId),
    ]);
    await notify(ctx, {
      organizationId: answer.organizationId,
      kind: "agent_answer",
      recipients: [answer.agent.askedBy],
      automationName: review?.title || clip?.title || "A review",
      message: body,
      retries: 0,
      reviewId: answer.reviewId,
      clipId: answer.clipId,
      commentId: answer.parentId ?? answer._id,
      from: AGENT.name,
    });
  },
});

/** The agent server only takes tokens with this audience (packages/agent lib/auth.ts). */
export const AGENT_AUDIENCE = "takewon-agent";

function base64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let text = "";
  for (const byte of raw) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The short-lived token the agent server accepts: HS256 with the shared secret, as the web app signs it. */
export async function signAgentToken(secret: string, sub: string, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const body = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({ sub, aud: AGENT_AUDIENCE, iat, exp: iat + 300 }),
  )}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${base64url(new Uint8Array(signature))}`;
}

type Toolkit = { baseUrl: string; apiKeyCipher: string };

/** One toolkit call, or null when it fails or takes too long: the answer can do without it. */
async function ask(
  connection: { baseUrl: string; apiKey: string },
  stepId: string,
  input: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const step = getStep(stepId);
  if (!step) return null;
  try {
    const answer = (await callStep(connection, step, input, {
      signal: AbortSignal.timeout(timeoutMs),
    })) as { response?: unknown } | null;
    return answer?.response ?? null;
  } catch {
    return null;
  }
}

const isUrl = (value: unknown): value is string =>
  typeof value === "string" && /^https?:\/\//.test(value);

/** The address a toolkit call answered with: a bare one, `{ url }`, or `[{ file_url }]`. */
function urlIn(response: unknown, index = 0): string | null {
  if (isUrl(response)) return response;
  if (isUrl((response as { url?: unknown })?.url)) return (response as { url: string }).url;
  const item = Array.isArray(response) ? response[index] : null;
  return isUrl((item as { file_url?: unknown })?.file_url)
    ? (item as { file_url: string }).file_url
    : null;
}

export type Look = { still: string | null; frames: string | null; sense: ClipSense | null };

/**
 * What the agent gets to see and hear of the clip, all from the team's own toolkit: the
 * still of the moment, frames around it as one picture, the cuts, the loudness, the quiet
 * gaps, and what is said near the moment. Anything the toolkit cannot give is left out.
 */
export async function lookAt(toolkit: Toolkit | null, question: ReviewQuestion): Promise<Look> {
  if (!toolkit || !question.clip.isVideo || !question.moment) {
    return { still: null, frames: null, sense: null };
  }
  const connection = {
    baseUrl: toolkit.baseUrl,
    apiKey: await decryptSecret(toolkit.apiKeyCipher),
  };
  const url = question.clip.url;
  const moment = question.moment.seconds;

  const [stillResponse, measuredResponse] = await Promise.all([
    ask(connection, "video-thumbnail", { video_url: url, second: moment }, LOOK_TIMEOUT_MS),
    ask(
      connection,
      "code-execute-python",
      { code: measureCode(url, moment), timeout: 95 },
      LOOK_TIMEOUT_MS,
    ),
  ]);
  const measured = readMeasurements((measuredResponse as { result?: unknown } | null)?.result);
  const duration = measured?.duration ?? null;

  // The frames, and the sound to transcribe, cut out in one FFmpeg call.
  const framesWindow = windowAround(moment, FRAMES_SPAN, duration);
  const listenWindow = windowAround(moment, LISTEN_SPAN, duration);
  const listen = measured?.hasAudio === true && listenWindow.length > 0;
  const cut = await ask(
    connection,
    "ffmpeg-compose",
    {
      inputs: [
        {
          file_url: url,
          options: [
            { option: "-ss", argument: framesWindow.start },
            { option: "-t", argument: framesWindow.length },
          ],
        },
        ...(listen
          ? [
              {
                file_url: url,
                options: [
                  { option: "-ss", argument: listenWindow.start },
                  { option: "-t", argument: listenWindow.length },
                ],
              },
            ]
          : []),
      ],
      outputs: [
        {
          options: [
            { option: "-map", argument: "0:v:0" },
            {
              option: "-vf",
              argument: `fps=${FRAMES_PER_SECOND},scale=480:-2,tile=${FRAMES_GRID.across}x${FRAMES_GRID.down}`,
            },
            { option: "-frames:v", argument: 1 },
            { option: "-f", argument: "image2" },
          ],
        },
        ...(listen
          ? [
              {
                options: [
                  { option: "-map", argument: "1:a:0" },
                  { option: "-ac", argument: 1 },
                  { option: "-b:a", argument: "64k" },
                  { option: "-f", argument: "mp3" },
                ],
              },
            ]
          : []),
      ],
    },
    LOOK_TIMEOUT_MS,
  );
  const frames = urlIn(cut, 0);
  const sound = listen ? urlIn(cut, 1) : null;
  const heard = sound
    ? await ask(
        connection,
        "media-transcribe",
        { media_url: sound, include_text: false, include_segments: true },
        LOOK_TIMEOUT_MS,
      )
    : null;
  const transcript = heard
    ? transcriptNear((heard as { segments?: unknown }).segments, listenWindow.start)
    : null;

  return {
    still: urlIn(stillResponse),
    frames,
    sense: senseFrom(measured, moment, frames ? framesWindow : null, transcript),
  };
}

/** Gets the agent's answer to one "@Agent" comment and writes it in the thread. */
export const answer = internalAction({
  args: { answerId: v.id("reviewComments") },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(internal.reviewAgent.load, { answerId: args.answerId });
    if (!loaded) return;
    const fail = (body: string) =>
      ctx.runMutation(internal.reviewAgent.settle, { answerId: args.answerId, body, ok: false });

    const url = process.env.AGENT_URL;
    const secret = process.env.MASTRA_JWT_SECRET;
    if (!url || !secret) {
      await fail(
        "The agent is not set up on this dashboard yet. Whoever runs it sets AGENT_URL and MASTRA_JWT_SECRET for Convex.",
      );
      return;
    }

    const look = await lookAt(loaded.toolkit, loaded.question);
    try {
      const response = await fetch(new URL("/ncat/review-reply", url), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await signAgentToken(secret, loaded.askedBy)}`,
        },
        body: JSON.stringify({ question: loaded.question, ...look }),
        signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
      });
      const result = (await response.json().catch(() => null)) as {
        answer?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok || typeof result?.answer !== "string" || result.answer.trim() === "") {
        await fail("The agent could not answer this time. Ask again in a moment.");
        return;
      }
      await ctx.runMutation(internal.reviewAgent.settle, {
        answerId: args.answerId,
        body: result.answer,
        ok: true,
      });
    } catch {
      await fail("The agent could not be reached. Ask again in a moment.");
    }
  },
});
