import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { settingsUrl } from "./discord";
import { fromAgent } from "./lib/agentToken";
import { decryptSecret } from "./lib/crypto";
import { keepEnds, toolkitMessageText } from "./lib/toolkitMessage";
import { hookTokenOf, MAX_HOOK_KEY } from "./lib/hooks";
import { noStream, openaiAppsChallenge, serverCard } from "./mcp";
import { authorizationServer, serve } from "./mcpHttp";
import { settingsUrl as googleMeetSettingsUrl } from "./googleMeet";
import { settingsUrl as microsoftSettingsUrl } from "./microsoft";
import { settingsUrl as teamsSettingsUrl, TEAMS_STATE_PREFIX } from "./microsoftTeams";
import { DEFAULT_BOT_NAME, teamsAppPackage } from "./lib/teamsApp";
import { settingsUrl as dropboxSettingsUrl } from "./dropbox";
import { settingsUrl as zoomSettingsUrl } from "./zoom";
import { preflight, protectedResource } from "./oauth";

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
    const token = hookTokenOf(request, url);
    if (!automationId || !token) return new Response("Missing id or token", { status: 400 });
    const key = request.headers.get("idempotency-key")?.trim() || undefined;
    if (key !== undefined && key.length > MAX_HOOK_KEY) {
      return new Response(`Idempotency-Key can be at most ${MAX_HOOK_KEY} characters`, {
        status: 400,
      });
    }

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
      ...(key !== undefined ? { key } : {}),
    });
    switch (result.outcome) {
      case "started":
        return Response.json(
          { run_id: result.runId, status_url: statusUrl(url, result.runId) },
          {
            status: 202,
          },
        );
      case "repeat":
        // The same call again: the run it started the first time, not a second one.
        return Response.json(
          { run_id: result.runId, status_url: statusUrl(url, result.runId), repeat: true },
          { status: 200 },
        );
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

/** Where a caller reads how a run it started is going, with the same token. */
function statusUrl(url: URL, runId: string): string {
  const status = new URL("/automations/hook/run", url.origin);
  status.searchParams.set("id", url.searchParams.get("id") ?? "");
  status.searchParams.set("run", runId);
  return status.toString();
}

// How a run a webhook started is going, and its finished files once it is done. The
// caller proves it holds the automation's token, as when it started the run.
http.route({
  path: "/automations/hook/run",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const automationId = url.searchParams.get("id");
    const runId = url.searchParams.get("run");
    const token = hookTokenOf(request, url);
    if (!automationId || !runId || !token) {
      return new Response("Missing id, run or token", { status: 400 });
    }
    const answer = await ctx.runQuery(internal.hooks.runForCaller, { automationId, runId, token });
    if (answer === "forbidden") return new Response("Wrong token", { status: 403 });
    if (answer === null) return new Response("Unknown run", { status: 404 });
    return Response.json(answer);
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

// Approve or Send back pressed on an alert in Slack, passed on from /api/slack/events.
// Checked with the workspace's own signing secret.
http.route({
  path: "/slack/actions",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const status = await ctx.runAction(internal.chatAlertPresses.takeSlackPress, {
      body: await request.text(),
      timestamp: request.headers.get("x-slack-request-timestamp") ?? "",
      signature: request.headers.get("x-slack-signature") ?? "",
      now: Date.now(),
    });
    return new Response(null, { status });
  }),
});

// A message written in a Discord thread, handed over by the agent server's Gateway
// connection: a teammate's reply in a review's thread comes into the review. Only a
// caller holding MASTRA_JWT_SECRET is answered.
http.route({
  path: "/discord/review-reply",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!(await fromAgent(request))) return new Response("Not the agent server", { status: 401 });
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return new Response("Body must be JSON", { status: 400 });
    }
    const field = (name: string, max: number) =>
      typeof body[name] === "string" && (body[name] as string).length <= max
        ? (body[name] as string)
        : "";
    const args = {
      guildId: field("guildId", 64),
      threadId: field("threadId", 64),
      messageId: field("messageId", 64),
      discordUserId: field("discordUserId", 64),
      text: field("text", 4000),
    };
    if (!args.guildId || !args.threadId || !args.messageId || !args.discordUserId) {
      return new Response("Missing guildId, threadId, messageId or discordUserId", {
        status: 400,
      });
    }
    return Response.json(await ctx.runAction(internal.discordReview.takeReply, args));
  }),
});

// Approve or Send back pressed on an alert in Discord. Discord delivers presses to the
// agent server's Gateway connection, which passes them on. Only a caller holding
// MASTRA_JWT_SECRET is answered.
http.route({
  path: "/discord/alert-action",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const asked = await slackQuestion(request);
    if (asked instanceof Response) return asked;
    const decision = asked.decision;
    if (
      !asked.runStepId ||
      !asked.discordUserId ||
      (decision !== "approve" && decision !== "send_back")
    ) {
      return new Response("Missing runStepId, discordUserId or decision", { status: 400 });
    }
    const answer = await ctx.runAction(internal.chatAlertPresses.discordPress, {
      runStepId: asked.runStepId,
      discordUserId: asked.discordUserId,
      decision,
    });
    return Response.json(answer);
  }),
});

// The agent server asks who a Discord user is on the team that owns the server they
// wrote in. Only a caller holding MASTRA_JWT_SECRET is answered.
http.route({
  path: "/discord/person",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const asked = await slackQuestion(request);
    if (asked instanceof Response) return asked;
    if (!asked.guildId || !asked.discordUserId) {
      return new Response("Missing guildId or discordUserId", { status: 400 });
    }
    const found = await ctx.runAction(internal.discord.person, {
      guildId: asked.guildId,
      discordUserId: asked.discordUserId,
    });
    return Response.json(found);
  }),
});

// The agent server asks who a Telegram user is on the team: in a group, the team that
// added the bot there; in a direct chat, the team they linked last. Only a caller
// holding MASTRA_JWT_SECRET is answered.
http.route({
  path: "/telegram/person",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const asked = await slackQuestion(request);
    if (asked instanceof Response) return asked;
    if (!asked.chatId || !asked.telegramUserId) {
      return new Response("Missing chatId or telegramUserId", { status: 400 });
    }
    const found = await ctx.runAction(internal.telegram.person, {
      chatId: asked.chatId,
      telegramUserId: asked.telegramUserId,
      isGroup: asked.isGroup === "true",
    });
    return Response.json(found);
  }),
});

// Someone sent the bot /start with a code from Settings: link them, or the group, to the
// team. Only a caller holding MASTRA_JWT_SECRET is answered.
http.route({
  path: "/telegram/link",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const asked = await slackQuestion(request);
    if (asked instanceof Response) return asked;
    if (!asked.code || !asked.chatId || !asked.telegramUserId) {
      return new Response("Missing code, chatId or telegramUserId", { status: 400 });
    }
    const found = await ctx.runMutation(internal.telegram.link, {
      code: asked.code,
      chatId: asked.chatId,
      telegramUserId: asked.telegramUserId,
      isGroup: asked.isGroup === "true",
      telegramName: asked.telegramName || "Telegram account",
      ...(asked.chatTitle ? { chatTitle: asked.chatTitle } : {}),
      ...(asked.username ? { username: asked.username } : {}),
    });
    return Response.json(found);
  }),
});

// Someone pressed Approve or Send back on an alert in Telegram. Only a caller holding
// MASTRA_JWT_SECRET is answered.
http.route({
  path: "/telegram/decide",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const asked = await slackQuestion(request);
    if (asked instanceof Response) return asked;
    const decision = asked.decision;
    if (
      !asked.runStepId ||
      !asked.telegramUserId ||
      (decision !== "approve" && decision !== "send_back")
    ) {
      return new Response("Missing runStepId, telegramUserId or decision", { status: 400 });
    }
    const found = await ctx.runMutation(internal.telegram.decide, {
      runStepId: asked.runStepId,
      telegramUserId: asked.telegramUserId,
      decision,
    });
    return Response.json(found);
  }),
});

// A reply in a Telegram group to one of the bot's posts about a review. A linked
// teammate's reply goes into the review room. Only a caller holding MASTRA_JWT_SECRET is
// answered.
http.route({
  path: "/telegram/review-reply",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!(await fromAgent(request))) return new Response("Not the agent server", { status: 401 });
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return new Response("Body must be JSON", { status: 400 });
    }
    const replyTo = Number(body.replyTo);
    const messageId = Number(body.messageId);
    if (
      typeof body.chatId !== "string" ||
      typeof body.telegramUserId !== "string" ||
      typeof body.text !== "string" ||
      !Number.isInteger(replyTo) ||
      !Number.isInteger(messageId)
    ) {
      return new Response("Missing chatId, telegramUserId, text, replyTo or messageId", {
        status: 400,
      });
    }
    const answer = await ctx.runMutation(internal.telegramReview.reply, {
      chatId: body.chatId.slice(0, 64),
      telegramUserId: body.telegramUserId.slice(0, 64),
      text: body.text.slice(0, 4000),
      replyTo,
      messageId,
    });
    return Response.json(answer);
  }),
});

// The agent server asks before one of the agent's own schedules fires: may this team
// (and person, when known) still start something? Only a caller holding
// MASTRA_JWT_SECRET is answered.
http.route({
  path: "/agent/scheduled-turn",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const asked = await slackQuestion(request);
    if (asked instanceof Response) return asked;
    if (!asked.organizationId) return new Response("Missing organizationId", { status: 400 });
    const answer = await ctx.runMutation(internal.access.scheduledTurn, {
      organizationId: asked.organizationId,
      ...(asked.userId ? { userId: asked.userId } : {}),
    });
    return Response.json(answer);
  }),
});

// The agent server sends a voice note someone sent it in Slack or Discord, and gets its
// words back. It has already found who sent it, and on which team (?organizationId=).
// Only a caller holding MASTRA_JWT_SECRET is answered.
http.route({
  path: "/agent/voice-note",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!(await fromAgent(request))) return new Response("Not the agent server", { status: 401 });
    const organizationId = new URL(request.url).searchParams.get("organizationId") ?? "";
    if (!organizationId || organizationId.length > 200) {
      return new Response("Missing organizationId", { status: 400 });
    }
    const contentType = request.headers.get("content-type") ?? "";
    const audio = await request.arrayBuffer();
    try {
      const { text } = await ctx.runAction(internal.voiceNotes.transcribeAudio, {
        organizationId,
        audio,
        contentType,
      });
      return Response.json({ text });
    } catch (error) {
      const data = (error as { data?: { message?: unknown } }).data;
      const message =
        typeof data?.message === "string" ? data.message : "The voice note could not be read.";
      return Response.json({ error: message }, { status: 422 });
    }
  }),
});

// The agent server asks for a team's own Anthropic key here, to run that team's chats and
// AI steps on it (anthropicKey.ts). 404 when the team has none. Only a caller holding
// MASTRA_JWT_SECRET is answered.
http.route({
  path: "/agent/team-key",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const asked = await slackQuestion(request);
    if (asked instanceof Response) return asked;
    if (!asked.organizationId) return new Response("Missing organizationId", { status: 400 });
    const cipher = await ctx.runQuery(internal.anthropicKey.forAgent, {
      organizationId: asked.organizationId,
    });
    if (!cipher) return new Response("No key", { status: 404 });
    return Response.json({ key: await decryptSecret(cipher) });
  }),
});

// Discord sends people back here after they add the bot to a server or link their own
// account from Settings. The state is the one-time id Settings started the sign-in with.
http.route({
  path: "/discord/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    let location: string;
    if (!code || !state) {
      location = settingsUrl(
        url.searchParams.get("error") === "access_denied" ? "cancelled" : "refused",
      );
    } else {
      location = await ctx.runAction(internal.discord.finishLink, {
        code,
        state,
        ...(url.searchParams.get("guild_id") ? { guildId: url.searchParams.get("guild_id")! } : {}),
      });
    }
    return new Response(null, { status: 302, headers: { location } });
  }),
});

// Zoom sends people back here after they connect their Zoom account from Settings.
http.route({
  path: "/zoom/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const location =
      code && state
        ? await ctx.runAction(internal.zoom.finishLink, { code, state })
        : zoomSettingsUrl(
            url.searchParams.get("error") === "access_denied" ? "cancelled" : "refused",
          );
    return new Response(null, { status: 302, headers: { location } });
  }),
});

// Zoom's events: finished cloud recordings, the app being removed, and Zoom checking the
// address. Each is signed with the Zoom app's secret token (zoom.ts checks it). The
// per-person app sends to /zoom/events, the whole-account app to /zoom/account-events.
for (const [path, wholeAccount] of [
  ["/zoom/events", false],
  ["/zoom/account-events", true],
] as const) {
  http.route({
    path,
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      const body = await request.text();
      if (body.length > 1_000_000) return new Response("Body too large", { status: 413 });
      const answer = await ctx.runAction(internal.zoom.takeEvent, {
        body,
        timestamp: request.headers.get("x-zm-request-timestamp") ?? "",
        signature: request.headers.get("x-zm-signature") ?? "",
        ...(wholeAccount ? { wholeAccount: true } : {}),
      });
      return answer.json
        ? Response.json(answer.json, { status: answer.status })
        : new Response(null, { status: answer.status });
    }),
  });
}

// Google sends people back here after they connect their Google account for Meet.
http.route({
  path: "/google-meet/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const location =
      code && state
        ? await ctx.runAction(internal.googleMeet.finishLink, { code, state })
        : googleMeetSettingsUrl(
            url.searchParams.get("error") === "access_denied" ? "cancelled" : "refused",
          );
    return new Response(null, { status: 302, headers: { location } });
  }),
});

// Microsoft sends people back here after they connect their Microsoft 365 account.
http.route({
  path: "/microsoft/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    // A sign-in started from the Teams settings page comes back here too.
    const forTeams = state?.startsWith(TEAMS_STATE_PREFIX) ?? false;
    const failed = url.searchParams.get("error") === "access_denied" ? "cancelled" : "refused";
    const location =
      code && state
        ? forTeams
          ? await ctx.runAction(internal.microsoftTeams.finishLink, {
              code,
              nonce: state.slice(TEAMS_STATE_PREFIX.length),
            })
          : await ctx.runAction(internal.microsoft.finishLink, { code, state })
        : forTeams
          ? teamsSettingsUrl(failed)
          : microsoftSettingsUrl(failed);
    return new Response(null, { status: 302, headers: { location } });
  }),
});

// The agent server asks who wrote to the bot in Microsoft Teams. Teams' ids and addresses
// are longer than Slack's, so this one reads its own body.
http.route({
  path: "/teams/person",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!(await fromAgent(request))) return new Response("Not the agent server", { status: 401 });
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return new Response("Body must be JSON", { status: 400 });
    }
    const text = (key: string) => {
      const value = body[key];
      return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : "";
    };
    const tenantId = text("tenantId");
    const aadObjectId = text("aadObjectId");
    if (!tenantId || !aadObjectId) {
      return new Response("Missing tenantId or aadObjectId", { status: 400 });
    }
    const teamId = text("teamId");
    const serviceUrl = text("serviceUrl");
    // Teams always names an https address to post to; the browser tests' stand-in is local.
    const found = await ctx.runAction(internal.microsoftTeamsChat.person, {
      tenantId,
      aadObjectId,
      ...(teamId &&
      (serviceUrl.startsWith("https://") || serviceUrl.startsWith("http://127.0.0.1:"))
        ? { team: { teamId, teamName: text("teamName") || "Team", serviceUrl } }
        : {}),
    });
    return Response.json(found);
  }),
});

// Approve or Send back pressed on an alert in Microsoft Teams. Teams hands the press to the
// agent server, which passes it here with who pressed it (their Microsoft account).
http.route({
  path: "/teams/alert-action",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!(await fromAgent(request))) return new Response("Not the agent server", { status: 401 });
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return new Response("Body must be JSON", { status: 400 });
    }
    const text = (key: string) => {
      const value = body[key];
      return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : "";
    };
    const decision = text("decision");
    const runStepId = text("runStepId");
    if (!text("tenantId") || !text("aadObjectId") || !runStepId) {
      return new Response("Missing tenantId, aadObjectId or runStepId", { status: 400 });
    }
    if (decision !== "approve" && decision !== "send_back") {
      return new Response("Unknown decision", { status: 400 });
    }
    const answer = await ctx.runMutation(internal.microsoftTeams.alertPress, {
      tenantId: text("tenantId"),
      aadObjectId: text("aadObjectId"),
      runStepId,
      decision,
    });
    return Response.json(answer);
  }),
});

// A message in a Teams reply thread: when the thread is a review thread, it becomes the
// writer's reply in the review room, and the agent server does not answer it.
http.route({
  path: "/teams/review-reply",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!(await fromAgent(request))) return new Response("Not the agent server", { status: 401 });
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return new Response("Body must be JSON", { status: 400 });
    }
    const text = (key: string, limit = 512) => {
      const value = body[key];
      return typeof value === "string" && value.length > 0 && value.length <= limit ? value : "";
    };
    const fields = {
      tenantId: text("tenantId"),
      aadObjectId: text("aadObjectId"),
      conversationId: text("conversationId"),
      rootActivityId: text("rootActivityId"),
      activityId: text("activityId"),
      text: text("text", 20_000),
    };
    if (Object.values(fields).some((value) => !value)) {
      return Response.json({ handled: false });
    }
    const botName = text("botName", 100);
    const answer = await ctx.runAction(internal.microsoftTeamsReview.reply, {
      ...fields,
      ...(botName ? { botName } : {}),
    });
    return Response.json(answer);
  }),
});

// The Teams app a team uploads to its Teams: the dashboard's one bot, and its icons.
http.route({
  path: "/teams/app.zip",
  method: "GET",
  handler: httpAction(async () => {
    const botId = process.env.TEAMS_APP_ID;
    if (!botId) return new Response("Teams is not set up on this dashboard", { status: 404 });
    const name = process.env.TEAMS_APP_NAME || DEFAULT_BOT_NAME;
    const zip = teamsAppPackage({ botId, name, siteUrl: process.env.SITE_URL ?? "" });
    return new Response(zip.buffer as ArrayBuffer, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${name.replace(/[^\w .-]/g, "")} for Teams.zip"`,
      },
    });
  }),
});

// Microsoft's change notices for watched OneDrives. When a watch is made, Microsoft first
// checks the address by sending a token to say back as plain text.
http.route({
  path: "/microsoft/events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const validationToken = new URL(request.url).searchParams.get("validationToken");
    if (validationToken !== null) {
      return new Response(validationToken.slice(0, 1000), {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    const body = await request.text();
    if (body.length > 1_000_000) return new Response("Body too large", { status: 413 });
    const answer = await ctx.runAction(internal.microsoft.takeEvent, { body });
    return new Response(null, { status: answer.status });
  }),
});

// Dropbox sends people back here after they connect their Dropbox.
http.route({
  path: "/dropbox/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const location =
      code && state
        ? await ctx.runAction(internal.dropbox.finishLink, { code, state })
        : dropboxSettingsUrl(
            url.searchParams.get("error") === "access_denied" ? "cancelled" : "refused",
          );
    return new Response(null, { status: 302, headers: { location } });
  }),
});

// Dropbox checks the notices address by asking it to say a challenge back.
http.route({
  path: "/dropbox/events",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const challenge = new URL(request.url).searchParams.get("challenge") ?? "";
    return new Response(challenge.slice(0, 1000), {
      status: 200,
      headers: { "content-type": "text/plain", "x-content-type-options": "nosniff" },
    });
  }),
});

// Dropbox's notices that files changed in connected accounts, signed with the app's secret.
http.route({
  path: "/dropbox/events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();
    if (body.length > 1_000_000) return new Response("Body too large", { status: 413 });
    const answer = await ctx.runAction(internal.dropbox.takeEvent, {
      body,
      signature: request.headers.get("x-dropbox-signature") ?? "",
    });
    return new Response(null, { status: answer.status });
  }),
});

// The dashboard as an MCP server, for Claude and other AI agents (mcp.ts).
http.route({ path: "/mcp", method: "POST", handler: serve });
http.route({ path: "/mcp", method: "GET", handler: noStream });
// Who the server is and where to reach it, for directories and apps (MCP Server Cards).
http.route({ path: "/mcp/server-card", method: "GET", handler: serverCard });
http.route({
  path: "/.well-known/openai-apps-challenge",
  method: "GET",
  handler: openaiAppsChallenge,
});
http.route({ path: "/mcp", method: "DELETE", handler: noStream });

// Agents sign in with OAuth (oauth.ts). They find how from the MCP address's metadata.
for (const path of [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
]) {
  http.route({ path, method: "GET", handler: protectedResource });
}
http.route({
  path: "/.well-known/oauth-authorization-server",
  method: "GET",
  handler: authorizationServer,
});
for (const path of [
  "/mcp",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server",
]) {
  http.route({ path, method: "OPTIONS", handler: preflight });
}

// One-click unsubscribe (email.unsubscribe). Opening the link shows a page with one
// button, so a mail scanner that follows links changes nothing; the button, and a mail
// app's own Unsubscribe button (RFC 8058, a POST), switch the email off.
function unsubscribePage(title: string, body: string, form?: string): Response {
  const escape = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head><body style="margin:0;padding:48px 16px;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0b0b12;"><div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;"><h1 style="margin:0 0 12px;font-size:22px;">${escape(title)}</h1><p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4f5260;">${escape(body)}</p>${form ?? ""}</div></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

http.route({
  path: "/email/unsubscribe",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    const value = token.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    return unsubscribePage(
      "Unsubscribe",
      "Stop getting these emails? You still see this news under the bell in the app, and you can switch emails back on in your notification settings.",
      `<form method="post"><input type="hidden" name="token" value="${value}"><button type="submit" style="background:#5b3df5;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:15px;font-weight:600;cursor:pointer;">Unsubscribe</button></form>`,
    );
  }),
});

http.route({
  path: "/email/unsubscribe",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    let token = url.searchParams.get("token") ?? "";
    const type = request.headers.get("content-type") ?? "";
    let oneClick = false;
    if (type.includes("form")) {
      const form = await request.formData();
      oneClick = form.get("List-Unsubscribe") === "One-Click";
      const fromForm = form.get("token");
      if (typeof fromForm === "string" && fromForm) token = fromForm;
    }
    const done = await ctx.runMutation(internal.email.unsubscribe, { token });
    if (oneClick)
      return new Response(done ? "Unsubscribed" : "Unknown link", { status: done ? 200 : 400 });
    if (!done) {
      return unsubscribePage(
        "That link didn't work",
        "Change which emails you get in the app, under Settings, Notifications.",
      );
    }
    return unsubscribePage(
      "You're unsubscribed",
      done.title
        ? `You won't get emails for "${done.title}" any more. Switch them back on any time in your notification settings.`
        : "You won't get any more alert or summary emails from this team. Switch them back on any time in your notification settings.",
    );
  }),
});

// Product news (news.ts). The unsubscribe link in every newsletter, the confirmation link
// a website sign-up gets, and the address the website's newsletter box posts to. Opening
// a link shows a page with one button, so a mail scanner that follows links changes
// nothing.
function hiddenTokenForm(token: string, label: string): string {
  const value = token.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<form method="post"><input type="hidden" name="token" value="${value}"><button type="submit" style="background:#5b3df5;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:15px;font-weight:600;cursor:pointer;">${label}</button></form>`;
}

async function tokenOf(request: Request): Promise<{ token: string; oneClick: boolean }> {
  let token = new URL(request.url).searchParams.get("token") ?? "";
  let oneClick = false;
  if ((request.headers.get("content-type") ?? "").includes("form")) {
    const form = await request.formData();
    oneClick = form.get("List-Unsubscribe") === "One-Click";
    const fromForm = form.get("token");
    if (typeof fromForm === "string" && fromForm) token = fromForm;
  }
  return { token, oneClick };
}

http.route({
  path: "/email/news/unsubscribe",
  method: "GET",
  handler: httpAction(async (_ctx, request) =>
    unsubscribePage(
      "Unsubscribe from product news",
      "Stop getting product news emails? Emails about your account, like password resets, still come.",
      hiddenTokenForm(new URL(request.url).searchParams.get("token") ?? "", "Unsubscribe"),
    ),
  ),
});

http.route({
  path: "/email/news/unsubscribe",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const { token, oneClick } = await tokenOf(request);
    const done = await ctx.runMutation(internal.news.unsubscribe, { token });
    if (oneClick)
      return new Response(done ? "Unsubscribed" : "Unknown link", { status: done ? 200 : 400 });
    if (!done)
      return unsubscribePage(
        "That link didn't work",
        "Write to us and we'll take you off the list.",
      );
    return unsubscribePage(
      "You're unsubscribed",
      `${done} won't get product news any more. If you have an account, you can switch it back on in Settings, Notifications.`,
    );
  }),
});

http.route({
  path: "/email/news/confirm",
  method: "GET",
  handler: httpAction(async (_ctx, request) =>
    unsubscribePage(
      "Confirm product news",
      "Click below and we'll send the occasional email about new features and tips. You can stop any time.",
      hiddenTokenForm(
        new URL(request.url).searchParams.get("token") ?? "",
        "Yes, send me product news",
      ),
    ),
  ),
});

http.route({
  path: "/email/news/confirm",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const { token } = await tokenOf(request);
    const userAgent = request.headers.get("user-agent");
    const done = await ctx.runMutation(internal.news.confirm, {
      token,
      ...(userAgent ? { userAgent } : {}),
    });
    if (!done)
      return unsubscribePage(
        "That link has expired",
        "Sign up again on the website and we'll send a fresh link.",
      );
    return unsubscribePage(
      "You're in",
      `${done} will get product news. Every email has a link to stop.`,
    );
  }),
});

/** Websites allowed to post to the newsletter box from a browser (NEWS_SIGNUP_ORIGINS). */
function newsOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const allowed = (process.env.NEWS_SIGNUP_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

function newsCors(origin: string | null): Record<string, string> {
  return origin
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        Vary: "Origin",
      }
    : {};
}

http.route({
  path: "/email/news/subscribe",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    const origin = newsOrigin(request);
    return new Response(null, { status: origin ? 204 : 403, headers: newsCors(origin) });
  }),
});

http.route({
  path: "/email/news/subscribe",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const origin = newsOrigin(request);
    const isForm = (request.headers.get("content-type") ?? "").includes("form");
    let email = "";
    let trap = "";
    try {
      if (isForm) {
        const form = await request.formData();
        email = String(form.get("email") ?? "");
        trap = String(form.get("website") ?? "");
      } else {
        const body = (await request.json()) as { email?: unknown; website?: unknown };
        email = typeof body.email === "string" ? body.email : "";
        trap = typeof body.website === "string" ? body.website : "";
      }
    } catch {
      email = "";
    }
    const userAgent = request.headers.get("user-agent");
    // A filled-in hidden "website" field is a bot: say thanks and do nothing.
    const outcome = trap
      ? "ok"
      : await ctx.runMutation(internal.news.requestFromWebsite, {
          email,
          ...(userAgent ? { userAgent } : {}),
        });
    if (isForm && !origin) {
      return outcome === "invalid"
        ? unsubscribePage("That address doesn't look right", "Go back and check the email address.")
        : outcome === "busy"
          ? unsubscribePage("Too many sign-ups right now", "Try again in a few minutes.")
          : unsubscribePage(
              "Check your inbox",
              "We sent you an email. Click the button in it to confirm, and you're on the list.",
            );
    }
    const status = outcome === "ok" ? 200 : outcome === "invalid" ? 400 : 429;
    return new Response(JSON.stringify({ outcome }), {
      status,
      headers: { "Content-Type": "application/json", ...newsCors(origin) },
    });
  }),
});

// toSend tells us when an email bounces or is marked as spam (https://tosend.com/docs/guide/webhooks/).
// Signed with TOSEND_WEBHOOK_SECRET: X-ToSend-Signature is sha256=<hex HMAC of the body>.
http.route({
  path: "/email/events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.TOSEND_WEBHOOK_SECRET?.trim();
    if (!secret) return new Response("Not set up", { status: 404 });
    const body = await request.text();
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signed = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
    );
    const expected = `sha256=${Array.from(signed, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if ((request.headers.get("x-tosend-signature") ?? "").trim().toLowerCase() !== expected) {
      return new Response("Bad signature", { status: 401 });
    }
    let event: {
      type?: unknown;
      test?: unknown;
      data?: Record<string, unknown>;
    };
    try {
      event = JSON.parse(body);
    } catch {
      return new Response("Not JSON", { status: 400 });
    }
    const data = event.data ?? {};
    const email = typeof data.email === "string" ? data.email : "";
    if (event.test === true || !email || (event.type !== "bounced" && event.type !== "complaint")) {
      return new Response("OK", { status: 200 });
    }
    const when = Date.parse(typeof data.timestamp === "string" ? data.timestamp : "");
    await ctx.runMutation(internal.email.recordProblem, {
      email,
      kind: event.type,
      permanent: event.type === "complaint" || data.is_hard_bounce === true,
      reason: typeof data.reason === "string" ? data.reason : String(event.type),
      at: Number.isFinite(when) ? when : Date.now(),
    });
    return new Response("OK", { status: 200 });
  }),
});

export default http;
