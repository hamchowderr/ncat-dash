/** The settings pages, in the order the menu lists them. */
export const SETTINGS_PAGES = [
  { slug: "brand", title: "Brand", description: "Logo, colour, font and music" },
  { slug: "editors", title: "Video editors", description: "Where your team finishes videos" },
  { slug: "agent", title: "Agent", description: "Model, house rules and platforms" },
  { slug: "runs", title: "Runs", description: "Jobs at once and retries" },
  { slug: "notifications", title: "Notifications", description: "What you hear about" },
  { slug: "email", title: "Email", description: "How the dashboard sends email" },
  { slug: "chat", title: "Chat apps", description: "Slack and Discord" },
  { slug: "team", title: "Team", description: "Members and invitations" },
] as const;

export type SettingsSlug = (typeof SETTINGS_PAGES)[number]["slug"];

/** Old links pointed at sections of one long page; this finds the page each now lives on. */
export function settingsPageFor(hash: string): SettingsSlug {
  const id = hash.replace(/^#/, "");
  const old: Record<string, SettingsSlug> = {
    jobs: "runs",
    failures: "runs",
    slack: "chat",
    discord: "chat",
  };
  return SETTINGS_PAGES.find((page) => page.slug === id)?.slug ?? old[id] ?? "brand";
}
