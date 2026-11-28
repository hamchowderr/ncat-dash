import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { sameSecret } from "./lib/hooks";

// The Factory's HTTP endpoints (docs/factory.md), guarded the way the automation webhook
// is (docs/webhooks.md): a shared token, compared in constant time. The token is the
// Convex setting FACTORY_INTAKE_TOKEN, sent as `Authorization: Bearer <token>`. Without
// the setting every call is turned away.

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/** Whether the call carries the Factory's token. */
export function factoryAllowed(request: Request): boolean {
  const kept = process.env.FACTORY_INTAKE_TOKEN?.trim();
  if (!kept) return false;
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return bearer ? sameSecret(bearer[1], kept) : false;
}

/** The ticket id and what follows it in /factory/tickets/<id>[/fixed]. */
function pathOf(request: Request): { id: string; rest: string } | null {
  const tail = new URL(request.url).pathname.replace(/^\/factory\/tickets\/?/, "");
  const [id, rest = "", extra] = tail.split("/").map(decodeURIComponent);
  if (!id || extra !== undefined) return null;
  return { id, rest };
}

/** GET /factory/tickets[?cursor=<c>]: sent requests not fixed yet. */
export const listTickets = httpAction(async (ctx, request) => {
  if (!factoryAllowed(request)) return json(403, { error: "forbidden" });
  const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
  const page = await ctx.runQuery(internal.factory.list, cursor ? { cursor } : {});
  return json(200, page);
});

/** GET /factory/tickets/<id>: one sent request, or 404 once it is fixed or gone. */
export const getTicket = httpAction(async (ctx, request) => {
  if (!factoryAllowed(request)) return json(403, { error: "forbidden" });
  const path = pathOf(request);
  if (!path || path.rest !== "") return json(404, { error: "not_found" });
  const ticket = await ctx.runQuery(internal.factory.get, { id: path.id });
  return ticket ? json(200, ticket) : json(404, { error: "not_found" });
});

/** POST /factory/tickets/<id>/fixed: the Factory fixed it. Saying so again is harmless. */
export const ticketFixed = httpAction(async (ctx, request) => {
  if (!factoryAllowed(request)) return json(403, { error: "forbidden" });
  const path = pathOf(request);
  if (!path || path.rest !== "fixed") return json(404, { error: "not_found" });
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "Send a JSON object with beadId and reason." });
  }
  const { beadId, reason, closedAt } = body;
  if (typeof beadId !== "string" || !beadId.trim() || typeof reason !== "string") {
    return json(400, { error: "beadId and reason are required strings." });
  }
  let closed: number | undefined;
  if (closedAt !== undefined) {
    closed = typeof closedAt === "string" ? Date.parse(closedAt) : NaN;
    if (!Number.isFinite(closed)) return json(400, { error: "closedAt is not a date." });
  }
  const outcome = await ctx.runMutation(internal.factory.markFixed, {
    id: path.id,
    beadId,
    reason,
    ...(closed !== undefined ? { closedAt: closed } : {}),
  });
  if (outcome === "missing") return json(404, { error: "not_found" });
  return json(200, { ok: true, repeat: outcome === "already" });
});
