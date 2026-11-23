/**
 * The settings menu, grouped the way the sidebar lists it, and the apps on the
 * Integrations page. Each page has one short line that sits under its title on the page
 * itself (never in the menu). Linear's settings are the model: a short menu, and one
 * Integrations page where every app opens a page of its own.
 */
export const SETTINGS_GROUPS = [
  {
    label: "You",
    pages: [
      {
        slug: "account",
        title: "Account",
        description: "Your name, email address and password, and where you are signed in.",
      },
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
        slug: "team",
        title: "Members",
        description: "Who is on the team and what they can do.",
      },
      {
        slug: "integrations",
        title: "Integrations",
        description: "The apps your team works with. Open one to connect it or change it.",
      },
    ],
  },
  {
    label: "Look",
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
        slug: "motion",
        title: "Motion",
        description: "How motion graphics and sound effects look. Every motion step uses these.",
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
        slug: "broll",
        title: "B-Roll",
        description: "Where cutaway footage comes from: your own library first, then free stock.",
      },
      {
        slug: "editors",
        title: "Video Editors",
        description: "Where your team finishes videos. Runs with cuts can open in these.",
      },
    ],
  },
] as const;

/** The apps on the Integrations page, in the groups it lists them under. */
export const INTEGRATION_GROUPS = [
  {
    label: "Chat",
    apps: [
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
        slug: "telegram",
        title: "Telegram",
        description:
          "Talk to the agent and get alerts in Telegram, with Approve right in the chat.",
      },
      {
        slug: "teams",
        title: "Microsoft Teams",
        description: "Talk to the agent in Teams, and get alerts in a channel.",
      },
    ],
  },
  {
    label: "Meeting Recordings",
    apps: [
      {
        slug: "zoom",
        title: "Zoom",
        description: "Meeting recordings come into Uploads by themselves, ready to clip.",
      },
      {
        slug: "google-meet",
        title: "Google Meet",
        description: "Meet recordings come into Uploads by themselves, ready to clip.",
      },
      {
        slug: "microsoft",
        title: "Microsoft 365",
        description: "Teams meeting recordings come into Uploads by themselves, ready to clip.",
      },
    ],
  },
  {
    label: "Files",
    apps: [
      {
        slug: "dropbox",
        title: "Dropbox",
        description:
          "Footage in the folders you pick comes into Uploads; finished clips can go back.",
      },
      {
        slug: "video-links",
        title: "Video Links",
        description:
          "Bring in videos from TikTok, Instagram, YouTube and other sites by pasting a link.",
      },
    ],
  },
  {
    label: "AI Apps",
    apps: [
      {
        slug: "mcp",
        title: "MCP",
        description:
          "Connect Claude, ChatGPT, Cursor and other AI apps to your automations through MCP.",
      },
    ],
  },
  {
    label: "Sending Email",
    apps: [
      {
        slug: "email",
        title: "Email",
        description:
          "Every email the dashboard sends, from alerts to invitations, goes out through toSend.",
      },
    ],
  },
] as const;

type SettingsPage = (typeof SETTINGS_GROUPS)[number]["pages"][number];
type Integration = (typeof INTEGRATION_GROUPS)[number]["apps"][number];

export const SETTINGS_PAGES: readonly SettingsPage[] = SETTINGS_GROUPS.flatMap(
  (group): readonly SettingsPage[] => group.pages,
);

export const INTEGRATIONS: readonly Integration[] = INTEGRATION_GROUPS.flatMap(
  (group): readonly Integration[] => group.apps,
);

export type SettingsSlug = SettingsPage["slug"];
export type IntegrationSlug = Integration["slug"];

export const settingsPage = (slug: string) => SETTINGS_PAGES.find((page) => page.slug === slug);
export const integration = (slug: string) => INTEGRATIONS.find((app) => app.slug === slug);

/** Where a settings page or an app's page lives. */
export const settingsHref = (slug: SettingsSlug | IntegrationSlug) =>
  integration(slug) ? `/settings/integrations/${slug}` : `/settings/${slug}`;

/**
 * What a settings address shows: the page (or app) for its title and line, and the menu
 * item that stays lit. An app's page lights Integrations, the way Linear's do.
 */
export function settingsLocation(pathname: string) {
  const [, , first = "", second = ""] = pathname.split("/");
  if (first === "integrations" && second) {
    const app = integration(second);
    return app ? { page: app, menu: "integrations" as SettingsSlug, app: app.slug } : null;
  }
  const page = settingsPage(first);
  return page ? { page, menu: page.slug, app: null } : null;
}

/** Addresses settings used to have, and the page each now lives on. */
const MOVED: Record<string, SettingsSlug | IntegrationSlug> = {
  jobs: "runs",
  failures: "runs",
  chat: "slack",
  members: "team",
  "ai-agents": "mcp",
};

/**
 * The address an old one (`/settings/slack`, `/settings/chat`) or an old section link
 * (`#jobs`) now lives at. Anything unknown opens Brand.
 */
export function settingsPathFor(hashOrSlug: string): string {
  const id = hashOrSlug.replace(/^#/, "");
  const known = settingsPage(id)?.slug ?? integration(id)?.slug ?? MOVED[id];
  return settingsHref(known ?? "brand");
}
