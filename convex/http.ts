import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

// The toolkit posts each job's result here. The URL carries the job id and a random
// per-job token, so only the toolkit that was handed this URL can report on the job.
http.route({
  path: "/toolkit/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const jobId = url.searchParams.get("job");
    const token = url.searchParams.get("token");
    if (!jobId || !token) return new Response("Missing job or token", { status: 400 });

    let payload: { code?: number; response?: unknown; message?: unknown };
    try {
      payload = await request.json();
    } catch {
      return new Response("Body must be JSON", { status: 400 });
    }

    const ok = payload.code === 200;
    let outcome: "recorded" | "ignored" | "forbidden";
    try {
      outcome = await ctx.runMutation(internal.jobs.finish, {
        jobId: jobId as Id<"jobs">,
        token,
        ok,
        result: ok ? payload.response : undefined,
        error: ok ? undefined : String(payload.message ?? "The step failed.").slice(0, 2000),
      });
    } catch {
      // A job id that is not an id at all.
      return new Response("Unknown job", { status: 404 });
    }
    if (outcome === "forbidden") return new Response("Wrong token", { status: 403 });
    return new Response(null, { status: 204 });
  }),
});

export default http;
