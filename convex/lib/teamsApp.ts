/**
 * The Microsoft Teams app a team uploads to its Teams so the agent can be added there.
 * It is a zip of a manifest naming the dashboard's one bot, and two icons. Teams wants a
 * colour icon (192 px) and a white outline icon (32 px) on a clear background.
 */

import { zipSync } from "fflate";

const COLOR_ICON =
  "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";
const OUTLINE_ICON =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCxQHKTnNrGL7AAAAmUlEQVRYw+3WsQkCQRCF4V0RDcyNTSzADkxswxpMzyKsxTZswD6s4DPazIODUx7C/gXM/gyzb6aUTqczERwRFYAHdkmBxgXLpAC8cEgKNG7YJAUap7QA3LFNCjTOqEkBeGKfFGgMWI3Vndwm5sVgrfXjW4uvtWicayllPbvKv81A7BdEcyCWhLFdEN2GsXsgehFlb8JO51e8AQ80Ykj1aI+6AAAAAElFTkSuQmCC";

/** What the agent is called in Teams, unless whoever runs the dashboard names it. */
export const DEFAULT_BOT_NAME = "Takewon";

/** The manifest for the dashboard's bot. Exported for the tests. */
export function teamsManifest(options: { botId: string; name: string; siteUrl: string }) {
  const site = options.siteUrl.replace(/\/+$/, "");
  const name = options.name.slice(0, 30);
  return {
    $schema:
      "https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
    manifestVersion: "1.17",
    version: "1.0.0",
    id: options.botId,
    developer: {
      name,
      websiteUrl: site,
      privacyUrl: site,
      termsOfUseUrl: site,
    },
    name: { short: name, full: `${name} agent` },
    description: {
      short: "Build and run your video automations from Teams.",
      full: "Ask the agent to build, test and run your team's video automations, check on runs and find clips. It acts as you, with the rights you have in the dashboard. Alerts about failed runs, approvals and review comments can post to a channel.",
    },
    icons: { color: "color.png", outline: "outline.png" },
    accentColor: "#5B3DF5",
    bots: [
      {
        botId: options.botId,
        scopes: ["personal", "team", "groupChat"],
        supportsFiles: false,
        isNotificationOnly: false,
      },
    ],
    permissions: ["identity", "messageTeamMembers"],
    // Lets the bot read replies in a review thread without being tagged, so a teammate's
    // reply in Teams goes into the review the way it does from Slack.
    webApplicationInfo: { id: options.botId, resource: "https://RscBasedStoreApp" },
    authorization: {
      permissions: {
        resourceSpecific: [{ name: "ChannelMessage.Read.Group", type: "Application" }],
      },
    },
    validDomains: site ? [new URL(site).host] : [],
  };
}

/**
 * A zip of the files, made with fflate (a maintained zip library that runs in Convex's
 * default runtime). Teams takes the package as a plain zip with the files at its top.
 */
export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[file.name] = file.data;
  // A fixed date keeps the package byte-for-byte the same each time it is made.
  // Stored, not compressed, as before: the package is a few kilobytes, and the files stay
  // readable in the zip as they are.
  return zipSync(entries, { level: 0, mtime: new Date("2026-01-01T00:00:00Z") });
}

function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/** The app package, ready to upload in Teams. */
export function teamsAppPackage(options: { botId: string; name: string; siteUrl: string }) {
  const manifest = new TextEncoder().encode(JSON.stringify(teamsManifest(options), null, 2));
  return zip([
    { name: "manifest.json", data: manifest },
    { name: "color.png", data: fromBase64(COLOR_ICON) },
    { name: "outline.png", data: fromBase64(OUTLINE_ICON) },
  ]);
}
