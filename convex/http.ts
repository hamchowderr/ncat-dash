import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { settingsUrl } from "./discord";
import { fromAgent } from "./lib/agentToken";
import { decryptSecret } from "./lib/crypto";
import { keepEnds, toolkitMessageText } from "./lib/toolkitMessage";
import { noStream, serve } from "./mcp";
import { settingsUrl as googleMeetSettingsUrl } from "./googleMeet";
import { settingsUrl as microsoftSettingsUrl } from "./microsoft";
import { settingsUrl as teamsSettingsUrl, TEAMS_STATE_PREFIX } from "./microsoftTeams";
import { DEFAULT_BOT_NAME, teamsAppPackage } from "./lib/teamsApp";
import { settingsUrl as dropboxSettingsUrl } from "./dropbox";
import { settingsUrl as zoomSettingsUrl } from "./zoom";
import {
  authorizationServer,
  authorize,
  preflight,
  protectedResource,
  register,
  revoke,
  token,
} from "./oauth";

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
http.route({ path: "/oauth/authorize", method: "GET", handler: authorize });
http.route({ path: "/oauth/token", method: "POST", handler: token });
http.route({ path: "/oauth/register", method: "POST", handler: register });
http.route({ path: "/oauth/revoke", method: "POST", handler: revoke });
for (const path of [
  "/mcp",
  "/oauth/token",
  "/oauth/register",
  "/oauth/revoke",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server",
]) {
  http.route({ path, method: "OPTIONS", handler: preflight });
}

export default http;
