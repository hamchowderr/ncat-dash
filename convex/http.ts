import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { fromAgent } from "./lib/agentToken";
import { toolkitMessageText } from "./lib/toolkitMessage";

const http = httpRouter();

// FFmpeg's log opens with a long banner and says what went wrong at the end, so a long
// error keeps its start and its end rather than being cut after the banner.
function keepEnds(text: string, max = 6000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, 1500)}\n…\n${text.slice(text.length - (max - 1500))}`;
}

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
        error: ok ? undefined : keepEnds(toolkitMessageText(payload.message)),
      });
    } catch {
      // A job id that is not an id at all.
      return new Response("Unknown job", { status: 404 });
    }
    if (outcome === "forbidden") return new Response("Wrong token", { status: 403 });
    return new Response(null, { status: 204 });
  }),
});

// Starts an automation whose trigger is "webhook". The address carries the automation's
// id and its secret token. A JSON body is optional; "file_url" in it becomes the file
// the run works on, and the rest of the body is kept with the run for its steps.
http.route({
  path: "/automations/hook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const automationId = url.searchParams.get("id");
    const token = url.searchParams.get("token");
    if (!automationId || !token) return new Response("Missing id or token", { status: 400 });

    let body: unknown = {};
    const text = await request.text();
    if (text.length > 100_000) return new Response("Body too large", { status: 413 });
    if (text.trim() !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        return new Response("Body must be JSON", { status: 400 });
      }
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return new Response("Body must be a JSON object", { status: 400 });
      }
    }

    const result = await ctx.runMutation(internal.automations.startFromHook, {
      automationId,
      token,
      body,
    });
    switch (result.outcome) {
      case "started":
        return Response.json({ run_id: result.runId }, { status: 202 });
      case "forbidden":
        return new Response("Wrong token", { status: 403 });
      case "off":
        return new Response("This automation is switched off", { status: 409 });
      case "invalid":
        return new Response(result.message, { status: 422 });
      default:
        return new Response("Unknown automation", { status: 404 });
    }
  }),
});

// The agent server asks for a Slack workspace's token and signing secret here, and who a
// Slack user is on the team. Only a caller holding MASTRA_JWT_SECRET is answered.
async function slackQuestion(request: Request): Promise<Record<string, string> | Response> {
  if (!(await fromAgent(request))) return new Response("Not the agent server", { status: 401 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string" && value.length > 0 && value.length <= 64) fields[key] = value;
    }
    return fields;
  } catch {
    return new Response("Body must be JSON", { status: 400 });
  }
}

http.route({
  path: "/slack/installation",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const asked = await slackQuestion(request);
    if (asked instanceof Response) return asked;
    if (!asked.slackTeamId) return new Response("Missing slackTeamId", { status: 400 });
    const found = await ctx.runAction(internal.slack.installation, {
      slackTeamId: asked.slackTeamId,
    });
    return Response.json(found, { status: found ? 200 : 404 });
  }),
});

http.route({
  path: "/slack/person",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const asked = await slackQuestion(request);
    if (asked instanceof Response) return asked;
    if (!asked.slackTeamId || !asked.slackUserId) {
      return new Response("Missing slackTeamId or slackUserId", { status: 400 });
    }
    const found = await ctx.runAction(internal.slack.person, {
      slackTeamId: asked.slackTeamId,
      slackUserId: asked.slackUserId,
    });
    return Response.json(found);
  }),
});

// Slack events the dashboard passes on from /api/slack/events: replies in a review's
// Slack thread. Checked with the workspace's own signing secret, not the agent token.
http.route({
  path: "/slack/events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const status = await ctx.runAction(internal.slackReview.takeEvent, {
      body: await request.text(),
      timestamp: request.headers.get("x-slack-request-timestamp") ?? "",
      signature: request.headers.get("x-slack-signature") ?? "",
      now: Date.now(),
    });
    return new Response(null, { status });
  }),
});

export default http;
