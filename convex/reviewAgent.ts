import { type AutomationDraft, outline } from "@ncat-dash/automation-core";
import { AGENT_ANSWER_LIMIT, formatMoment, isVideoUrl } from "@ncat-dash/review-core";
import { callStep, getStep } from "@ncat-dash/step-catalog";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
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
const STILL_TIMEOUT_MS = 60_000;

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
    await ctx.db.patch(answer._id, {
      body: args.body.trim().slice(0, AGENT_ANSWER_LIMIT),
      agent: { askedBy: answer.agent.askedBy, state: args.ok ? "answered" : "failed" },
    });
  },
});

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
    JSON.stringify({ sub, iat, exp: iat + 300 }),
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

/** A still of the moment from the team's own toolkit, or null when there is none to be had. */
async function stillOf(
  toolkit: { baseUrl: string; apiKeyCipher: string } | null,
  question: ReviewQuestion,
): Promise<string | null> {
  const step = getStep("video-thumbnail");
  if (!toolkit || !step || !question.clip.isVideo || !question.moment) return null;
  try {
    const answer = (await callStep(
      { baseUrl: toolkit.baseUrl, apiKey: await decryptSecret(toolkit.apiKeyCipher) },
      step,
      { video_url: question.clip.url, second: question.moment.seconds },
      { signal: AbortSignal.timeout(STILL_TIMEOUT_MS) },
    )) as { response?: unknown } | null;
    const response = answer?.response;
    const url =
      typeof response === "string"
        ? response
        : typeof (response as { url?: unknown })?.url === "string"
          ? (response as { url: string }).url
          : null;
    return url && /^https?:\/\//.test(url) ? url : null;
  } catch {
    // The answer can still be given without seeing the frame.
    return null;
  }
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

    const still = await stillOf(loaded.toolkit, loaded.question);
    try {
      const response = await fetch(new URL("/ncat/review-reply", url), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await signAgentToken(secret, loaded.askedBy)}`,
        },
        body: JSON.stringify({ question: loaded.question, still }),
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
