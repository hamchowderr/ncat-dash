/**
 * The settings pages, grouped the way the settings menu lists them. Each has one short
 * line that sits under its title on the page itself (never in the menu).
 */
export const SETTINGS_GROUPS = [
  {
    label: "You",
    pages: [
      {
        slug: "notifications",
        title: "Notifications",
        description: "What you hear about, and how. Everyone on the team picks their own.",
      },
    ],
  },
  {
    label: "Team",
    pages: [
      {
        slug: "brand",
        title: "Brand",
        description: "Set once. Any step that adds a logo, text or music uses these by itself.",
      },
      {
        slug: "captions",
        title: "Captions",
        description:
          "How captions read and look. Every caption step uses these unless it is told otherwise.",
      },
      {
        slug: "team",
        title: "Members",
        description: "Who is on the team and what they can do.",
      },
    ],
  },
  {
    label: "Automations",
    pages: [
      {
        slug: "agent",
        title: "Agent",
        description: "How the agent builds automations for your team, in every chat.",
      },
      {
        slug: "runs",
        title: "Runs",
        description: "How runs use your toolkit, and what happens when a step fails.",
      },
      {
        slug: "editors",
        title: "Video Editors",
        description: "Where your team finishes videos. Runs with cuts can open in these.",
      },
    ],
  },
  {
    label: "Connections",
    pages: [
      {
        slug: "email",
        title: "Email",
        description:
          "Every email the dashboard sends, from alerts to invitations, goes out through toSend.",
      },
      {
        slug: "slack",
        title: "Slack",
        description: "Talk to the agent in Slack. It runs on your own Slack app.",
      },
      {
        slug: "discord",
        title: "Discord",
        description: "Talk to the agent in your Discord server.",
      },
      {
        slug: "mcp",
        title: "MCP",
        description:
          "Connect Claude, ChatGPT, Cursor and other AI apps to your automations through MCP.",
      },
    ],
  },
] as const;

type SettingsPage = (typeof SETTINGS_GROUPS)[number]["pages"][number];

export const SETTINGS_PAGES: readonly SettingsPage[] = SETTINGS_GROUPS.flatMap(
  (group): readonly SettingsPage[] => group.pages,
);

export type SettingsSlug = SettingsPage["slug"];

export const settingsPage = (slug: string) => SETTINGS_PAGES.find((page) => page.slug === slug);

/** Addresses settings used to have, and the page each now lives on. */
const MOVED: Record<string, SettingsSlug> = {
  jobs: "runs",
  failures: "runs",
  chat: "slack",
  members: "team",
  "ai-agents": "mcp",
};

/** The page an old address (`/settings/chat`) or old section link (`#jobs`) now lives on. */
export function settingsPageFor(hashOrSlug: string): SettingsSlug {
  const id = hashOrSlug.replace(/^#/, "");
  return settingsPage(id)?.slug ?? MOVED[id] ?? "brand";
}
