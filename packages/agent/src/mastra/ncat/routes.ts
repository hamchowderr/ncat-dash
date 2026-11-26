import { registerApiRoute } from "@mastra/core/server";
import { RequestContext } from "@mastra/core/request-context";
import { z } from "zod";
import { env } from "../../lib/env";
import { resourceIdOf } from "../routes/resource";
import { reviewAgent } from "../agents/review";
import { lookAgent, lookPrompt, lookRequest } from "./look";
import { dashboardUsage, momentsAgent, momentsPrompt, momentsRequest } from "./moments";
import {
  batchAnswers,
  batchCheck,
  batchModel,
  batchSubmission,
  submitBatch,
} from "./moments-batch";
import { reviewPrompt, reviewQuestion } from "./review";
import { scenesAgent, scenesPrompt, scenesRequest } from "./scenes";
import {
  translateAgent,
  translateModel,
  translatePrompt,
  translateRequest,
  translateWordsAgent,
  translateWordsPrompt,
  translateWordsRequest,
} from "./translate";
import { TEAM_KEY, teamKey } from "./team-key";
import { rememberSession, SCREEN_KINDS } from "./session-store";

const body = z.object({
  convexToken: z.string().min(20).max(8000),
  organizationId: z.string().max(200).nullish(),
  automationId: z.string().max(200).nullish(),
  screen: z
    .object({ kind: z.enum(SCREEN_KINDS), id: z.string().min(1).max(200) })
    .nullish(),
});

/**
 * POST /ncat/session: the dashboard says who is asking and what they have open, just
 * before it forwards a chat request for them (see ./session-store.ts).
 *
 * The person is the signed request's own `sub`, never a field in the body, so a caller
 * can only ever set their own session. That needs MASTRA_JWT_SECRET: without it there
 * is no trusted way to know who a request is for, and the route refuses.
 */
/** The team a request from the dashboard is for, when it says. */
function organizationOf(body: unknown): string | undefined {
  const id = (body as { organizationId?: unknown } | undefined)?.organizationId;
  return typeof id === "string" && id.length > 0 && id.length <= 200 ? id : undefined;
}

/** One-shot routes have no conversation, but their signed caller still identifies the trace. */
function tracingOptions(userId: string, operation: string) {
  return { tracingOptions: { metadata: { userId, operation } } };
}

export const createNcatRoutes = () => [
  registerApiRoute("/ncat/session", {
    method: "POST",
    handler: async (c) => {
      const userId = resourceIdOf(c);
      if (!userId) {
        return c.json({ error: "Set MASTRA_JWT_SECRET on the agent server and the web app." }, 401);
      }
      const parsed = body.safeParse(await c.req.json().catch(() => undefined));
      if (!parsed.success) return c.json({ error: "invalid body" }, 400);
      rememberSession(userId, {
        convexToken: parsed.data.convexToken,
        organizationId: parsed.data.organizationId ?? null,
        automationId: parsed.data.automationId ?? null,
        screen: parsed.data.screen ?? null,
      });
      return c.json({ ok: true });
    },
  }),
  // POST /ncat/review-reply: Convex asks for the agent's answer to an "@Agent" comment
  // in a review room. Signed like every other call, so only a dashboard holding
  // MASTRA_JWT_SECRET can ask, and the answer goes back in the response for Convex to
  // write: this server never writes to the dashboard for it.
  registerApiRoute("/ncat/review-reply", {
    method: "POST",
    handler: async (c) => {
      if (!resourceIdOf(c)) {
        return c.json(
          { error: "Set MASTRA_JWT_SECRET on the agent server and the dashboard." },
          401,
        );
      }
      const parsed = reviewQuestion.safeParse(await c.req.json().catch(() => undefined));
      if (!parsed.success) return c.json({ error: "invalid body" }, 400);
      const { question, still, frames = null, sense = null } = parsed.data;
      // The still is fetched here and sent as bytes: a toolkit's bucket can be private or
      // on a local network that the model provider cannot reach by URL.
      const [image, sheet] = await Promise.all([
        still ? fetchStill(still) : null,
        frames ? fetchStill(frames) : null,
      ]);
      const prompt = reviewPrompt(question, image !== null, sense, sheet !== null);
      const pictures = [image, sheet].filter((picture) => picture !== null);
      try {
        const result = await reviewAgent.generate([
          {
            role: "user",
            content: pictures.length
              ? [
                  { type: "text", text: prompt },
                  ...pictures.map((picture) => ({
                    type: "image" as const,
                    image: picture.bytes,
                    mediaType: picture.mediaType,
                  })),
                ]
              : prompt,
          },
        ], tracingOptions(resourceIdOf(c)!, "review_reply"));
        const answer = result.text.trim();
        if (!answer) return c.json({ error: "empty answer" }, 502);
        return c.json({ answer });
      } catch {
        return c.json({ error: "The model did not answer." }, 502);
      }
    },
  }),
  // POST /ncat/moments: Convex asks for the best moments of a transcript, or its chapters,
  // for the Best moments and Chapters steps. Signed like the rest; the model's answer goes
  // back as text, which the dashboard reads and checks against the transcript itself.
  registerApiRoute("/ncat/moments", {
    method: "POST",
    handler: async (c) => {
      if (!resourceIdOf(c)) {
        return c.json(
          { error: "Set MASTRA_JWT_SECRET on the agent server and the dashboard." },
          401,
        );
      }
      const body = await c.req.json().catch(() => undefined);
      const parsed = momentsRequest.safeParse(body);
      if (!parsed.success) return c.json({ error: "invalid body" }, 400);
      try {
        // The team's own Anthropic key, when the dashboard says which team and it has one.
        const requestContext = new RequestContext();
        const key = await teamKey(organizationOf(body));
        if (key) requestContext.set(TEAM_KEY, key);
        const result = await momentsAgent.generate(
          [{ role: "user", content: momentsPrompt(parsed.data) }],
          { requestContext, ...tracingOptions(resourceIdOf(c)!, "moments") },
        );
        const answer = result.text.trim();
        if (!answer) return c.json({ error: "empty answer" }, 502);
        // What it used, so the dashboard can keep the run under its AI limit.
        return c.json({
          answer,
          model: env.CHAT_MODEL,
          usage: dashboardUsage(result.usage, result.providerMetadata),
        });
      } catch {
        return c.json({ error: "The model did not answer." }, 502);
      }
    },
  }),
  // POST /ncat/scenes: Convex asks, when someone presses "Suggest scenes" on a storyboard,
  // which lines are better shown another way than Full Screen, and a name for each chapter.
  // The answer goes back as text; the dashboard checks it against the storyboard itself.
  registerApiRoute("/ncat/scenes", {
    method: "POST",
    handler: async (c) => {
      if (!resourceIdOf(c)) {
        return c.json(
          { error: "Set MASTRA_JWT_SECRET on the agent server and the dashboard." },
          401,
        );
      }
      const body = await c.req.json().catch(() => undefined);
      const parsed = scenesRequest.safeParse(body);
      if (!parsed.success) return c.json({ error: "invalid body" }, 400);
      try {
        const requestContext = new RequestContext();
        const key = await teamKey(organizationOf(body));
        if (key) requestContext.set(TEAM_KEY, key);
        const result = await scenesAgent.generate(
          [{ role: "user", content: scenesPrompt(parsed.data) }],
          { requestContext, ...tracingOptions(resourceIdOf(c)!, "scenes") },
        );
        const answer = result.text.trim();
        if (!answer) return c.json({ error: "empty answer" }, 502);
        return c.json({
          answer,
          model: env.CHAT_MODEL,
          usage: dashboardUsage(result.usage, result.providerMetadata),
        });
      } catch {
        return c.json({ error: "The model did not answer." }, 502);
      }
    },
  }),
  // POST /ncat/translate: Convex asks for a batch of a video's subtitle lines in another
  // language, once per video and language. The lines go back as the model wrote them;
  // the dashboard checks there is one for each line it sent.
  registerApiRoute("/ncat/translate", {
    method: "POST",
    handler: async (c) => {
      if (!resourceIdOf(c)) {
        return c.json(
          { error: "Set MASTRA_JWT_SECRET on the agent server and the dashboard." },
          401,
        );
      }
      const body = await c.req.json().catch(() => undefined);
      const parsed = translateRequest.safeParse(body);
      if (!parsed.success) return c.json({ error: "invalid body" }, 400);
      try {
        const requestContext = new RequestContext();
        const key = await teamKey(organizationOf(body));
        if (key) requestContext.set(TEAM_KEY, key);
        const result = await translateAgent.generate(
          [{ role: "user", content: translatePrompt(parsed.data) }],
          { requestContext, ...tracingOptions(resourceIdOf(c)!, "translate") },
        );
        const answer = result.text.trim();
        if (!answer) return c.json({ error: "empty answer" }, 502);
        return c.json({
          answer,
          model: translateModel(),
          usage: dashboardUsage(result.usage, result.providerMetadata),
        });
      } catch {
        return c.json({ error: "The model did not answer." }, 502);
      }
    },
  }),
  // POST /ncat/translate-words: Convex asks, once per video and language, for translated
  // captions where each translated word names the spoken words it stands for, so the
  // dashboard can light it up as the speaker says it (Caption video with a language).
  registerApiRoute("/ncat/translate-words", {
    method: "POST",
    handler: async (c) => {
      if (!resourceIdOf(c)) {
        return c.json(
          { error: "Set MASTRA_JWT_SECRET on the agent server and the dashboard." },
          401,
        );
      }
      const body = await c.req.json().catch(() => undefined);
      const parsed = translateWordsRequest.safeParse(body);
      if (!parsed.success) return c.json({ error: "invalid body" }, 400);
      try {
        const requestContext = new RequestContext();
        const key = await teamKey(organizationOf(body));
        if (key) requestContext.set(TEAM_KEY, key);
        const result = await translateWordsAgent.generate(
          [{ role: "user", content: translateWordsPrompt(parsed.data) }],
          { requestContext, ...tracingOptions(resourceIdOf(c)!, "translate_words") },
        );
        const answer = result.text.trim();
        if (!answer) return c.json({ error: "empty answer" }, 502);
        return c.json({
          answer,
          model: translateModel(),
          usage: dashboardUsage(result.usage, result.providerMetadata),
        });
      } catch {
        return c.json({ error: "The model did not answer." }, 502);
      }
    },
  }),
  // POST /ncat/look: Convex asks, once, what a sample video looks like, for Settings →
  // Looks. The sheet of frames is fetched here and sent as bytes, like a review still.
  // Without it there is nothing to see, so the route says so rather than guess.
  registerApiRoute("/ncat/look", {
    method: "POST",
    handler: async (c) => {
      if (!resourceIdOf(c)) {
        return c.json(
          { error: "Set MASTRA_JWT_SECRET on the agent server and the dashboard." },
          401,
        );
      }
      const body = await c.req.json().catch(() => undefined);
      const parsed = lookRequest.safeParse(body);
      if (!parsed.success) return c.json({ error: "invalid body" }, 400);
      const sheet = await fetchStill(parsed.data.sheet);
      if (!sheet) return c.json({ error: "The frames could not be fetched." }, 502);
      try {
        const requestContext = new RequestContext();
        const key = await teamKey(organizationOf(body));
        if (key) requestContext.set(TEAM_KEY, key);
        const result = await lookAgent.generate(
          [
            {
              role: "user",
              content: [
                { type: "text", text: lookPrompt(parsed.data) },
                { type: "image" as const, image: sheet.bytes, mediaType: sheet.mediaType },
              ],
            },
          ],
          { requestContext, ...tracingOptions(resourceIdOf(c)!, "look") },
        );
        const answer = result.text.trim();
        if (!answer) return c.json({ error: "empty answer" }, 502);
        return c.json({ answer });
      } catch {
        return c.json({ error: "The model did not answer." }, 502);
      }
    },
  }),
  // POST /ncat/moments/batch: the same questions for a run nobody is watching, sent to
  // Anthropic as one batch at half the price (./moments-batch.ts). Answers { batchId }, or
  // 409 when this server cannot batch, and then Convex asks POST /ncat/moments instead.
  registerApiRoute("/ncat/moments/batch", {
    method: "POST",
    handler: async (c) => {
      if (!resourceIdOf(c)) {
        return c.json(
          { error: "Set MASTRA_JWT_SECRET on the agent server and the dashboard." },
          401,
        );
      }
      const model = batchModel();
      if (!model) return c.json({ error: "This agent server cannot send batches." }, 409);
      const body = await c.req.json().catch(() => undefined);
      const parsed = batchSubmission.safeParse(body);
      if (!parsed.success) return c.json({ error: "invalid body" }, 400);
      try {
        const key = await teamKey(organizationOf(body));
        return c.json({
          batchId: await submitBatch(model, parsed.data.requests, key, resourceIdOf(c)!),
        });
      } catch {
        return c.json({ error: "The batch could not be sent." }, 502);
      }
    },
  }),
  // POST /ncat/moments/batch/answers: { batchId } → { pending: true } while it works, then
  // { answers: [{ id, answer } | { id, error }] }.
  registerApiRoute("/ncat/moments/batch/answers", {
    method: "POST",
    handler: async (c) => {
      if (!resourceIdOf(c)) {
        return c.json(
          { error: "Set MASTRA_JWT_SECRET on the agent server and the dashboard." },
          401,
        );
      }
      if (!batchModel()) return c.json({ error: "This agent server cannot send batches." }, 409);
      const body = await c.req.json().catch(() => undefined);
      const parsed = batchCheck.safeParse(body);
      if (!parsed.success) return c.json({ error: "invalid body" }, 400);
      try {
        // Read with the key it was sent with: the team's own, when it has one.
        const key = await teamKey(organizationOf(body));
        const answers = await batchAnswers(parsed.data.batchId, key, resourceIdOf(c)!);
        return c.json(answers ? { answers } : { pending: true });
      } catch {
        return c.json({ error: "The batch could not be read." }, 502);
      }
    },
  }),
];

const STILL_LIMIT = 5_000_000;

/** The still as bytes, or null when it cannot be had; the answer can do without it. */
async function fetchStill(url: string): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const mediaType = response.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (!response.ok || !/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > 0 && bytes.length <= STILL_LIMIT ? { bytes, mediaType } : null;
  } catch {
    return null;
  }
}
