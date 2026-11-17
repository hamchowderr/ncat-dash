import { registerApiRoute } from "@mastra/core/server";
import { z } from "zod";
import { resourceIdOf } from "../routes/resource";
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
];
