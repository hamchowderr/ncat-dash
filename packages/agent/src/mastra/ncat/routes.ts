import { registerApiRoute } from "@mastra/core/server";
import { z } from "zod";
import { resourceIdOf } from "../routes/resource";
import { reviewAgent } from "../agents/review";
import { reviewPrompt, reviewQuestion } from "./review";
import { rememberSession } from "./session-store";

const body = z.object({
  convexToken: z.string().min(20).max(8000),
  organizationId: z.string().max(200).nullish(),
  automationId: z.string().max(200).nullish(),
});

/**
 * POST /ncat/session: the dashboard says who is asking and what they have open, just
 * before it forwards a chat request for them (see ./session-store.ts).
 *
 * The person is the signed request's own `sub`, never a field in the body, so a caller
 * can only ever set their own session. That needs MASTRA_JWT_SECRET: without it there
 * is no trusted way to know who a request is for, and the route refuses.
 */
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
        ]);
        const answer = result.text.trim();
        if (!answer) return c.json({ error: "empty answer" }, 502);
        return c.json({ answer });
      } catch {
        return c.json({ error: "The model did not answer." }, 502);
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
