import { describe, expect, test } from "vitest";

import { createSlackAppUrl, slackManifest } from "./slack-manifest";

describe("the Slack app manifest", () => {
  test("sends events and button presses to this dashboard", () => {
    const manifest = slackManifest("https://dash.example.test/");
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
        "chat:write.customize",
        "users:read.email",
        "channels:read",
        "channels:join",
      ]),
    );
    expect(manifest.settings.event_subscriptions.bot_events).toContain("app_mention");
  });

  test("names the app and its bot Takewon", () => {
    const manifest = slackManifest("https://d.test");
    expect(manifest.display_information.name).toBe("Takewon");
    expect(manifest.features.bot_user.display_name).toBe("Takewon");
  });

  test("opens Slack's create-an-app page with the manifest filled in", () => {
    const url = new URL(createSlackAppUrl("https://d.test"));
    expect(url.origin + url.pathname).toBe("https://api.slack.com/apps");
    expect(url.searchParams.get("new_app")).toBe("1");
    expect(JSON.parse(url.searchParams.get("manifest_json") ?? "")).toEqual(
      slackManifest("https://d.test"),
    );
  });
});
