import { describe, expect, test } from "vitest";

import { createSlackAppUrl, slackManifest } from "./slack-manifest";

describe("the Slack app manifest", () => {
  test("sends events and button presses to this dashboard", () => {
    const manifest = slackManifest("https://dash.example.test/", "Salt House");
    expect(manifest.settings.event_subscriptions.request_url).toBe(
      "https://dash.example.test/api/slack/events",
    );
    expect(manifest.settings.interactivity.request_url).toBe(
      "https://dash.example.test/api/slack/events",
    );
    expect(manifest.oauth_config.scopes.bot).toEqual(
      expect.arrayContaining([
        "app_mentions:read",
        "chat:write",
        "users:read.email",
        "channels:read",
        "channels:join",
      ]),
    );
    expect(manifest.settings.event_subscriptions.bot_events).toContain("app_mention");
  });

  test("names the app after the team, within Slack's 35 characters", () => {
    expect(slackManifest("https://d.test", "Salt House").display_information.name).toBe(
      "Salt House Agent",
    );
    const long = slackManifest("https://d.test", "A very long team name for a studio");
    expect(long.display_information.name.length).toBeLessThanOrEqual(35);
    expect(long.features.bot_user.display_name).toBe(long.display_information.name);
  });

  test("opens Slack's create-an-app page with the manifest filled in", () => {
    const url = new URL(createSlackAppUrl("https://d.test", "Salt House"));
    expect(url.origin + url.pathname).toBe("https://api.slack.com/apps");
    expect(url.searchParams.get("new_app")).toBe("1");
    expect(JSON.parse(url.searchParams.get("manifest_json") ?? "")).toEqual(
      slackManifest("https://d.test", "Salt House"),
    );
  });
});
