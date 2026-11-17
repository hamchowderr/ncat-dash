/** Where a team's Slack app sends everything: the dashboard's own address. */
export function slackEventsUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/slack/events`;
}

/**
 * The Slack app manifest for a team's own agent app: the bot, what it may read and post,
 * and where Slack sends events and button presses. Nothing in it is secret.
 */
export function slackManifest(origin: string, teamName: string) {
  const url = slackEventsUrl(origin);
  const name = `${teamName} Agent`.slice(0, 35);
  return {
    display_information: {
      name,
      description:
        "Builds and runs your team's video automations, and answers questions about them.",
      background_color: "#1f2937",
    },
    features: {
      app_home: {
        home_tab_enabled: false,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      bot_user: { display_name: name, always_online: true },
    },
    oauth_config: {
      scopes: {
        bot: [
          // Being tagged, and the messages around it, in channels and DMs.
          "app_mentions:read",
          "channels:history",
          "groups:history",
          "im:history",
          "im:read",
          "im:write",
          // Answering.
          "chat:write",
          "reactions:write",
          // Telling who wrote: their email address is how the dashboard knows them.
          "users:read",
          "users:read.email",
        ],
      },
    },
    settings: {
      event_subscriptions: {
        request_url: url,
        bot_events: ["app_mention", "message.channels", "message.groups", "message.im"],
      },
      interactivity: { is_enabled: true, request_url: url },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}

/** Opens Slack's "create an app" page with the manifest filled in. */
export function createSlackAppUrl(origin: string, teamName: string): string {
  const manifest = JSON.stringify(slackManifest(origin, teamName));
  return `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(manifest)}`;
}
