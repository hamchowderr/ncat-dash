"use client";

import { McpSettings } from "./mcp-settings";
import type { SettingsSlug } from "./settings-pages";
import {
  AgentSettings,
  BrandSettings,
  CaptionsSettings,
  DiscordSettings,
  EditorsSettings,
  EmailSettings,
  NotificationsSettings,
  RunsSettings,
  SlackSettings,
  TeamSettings,
} from "./settings-view";

const SECTIONS: Record<SettingsSlug, () => React.ReactNode> = {
  brand: BrandSettings,
  captions: CaptionsSettings,
  editors: EditorsSettings,
  agent: AgentSettings,
  runs: RunsSettings,
  notifications: NotificationsSettings,
  email: EmailSettings,
  slack: SlackSettings,
  discord: DiscordSettings,
  mcp: McpSettings,
  team: TeamSettings,
};

/** One page of settings. */
export function SettingsSection({ slug }: { slug: SettingsSlug }) {
  const Section = SECTIONS[slug];
  return <Section />;
}
