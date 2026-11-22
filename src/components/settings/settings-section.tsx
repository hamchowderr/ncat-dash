"use client";

import { BrollCard } from "./broll-card";
import { McpSettings } from "./mcp-settings";
import { IntegrationsList } from "./integrations-list";
import type { IntegrationSlug, SettingsSlug } from "./settings-pages";
import {
  AgentSettings,
  BrandSettings,
  CaptionsSettings,
  DiscordSettings,
  EditorsSettings,
  EmailSettings,
  MotionSettings,
  NotificationsSettings,
  RunsSettings,
  SlackSettings,
  TeamSettings,
} from "./settings-view";
import { DropboxCard } from "./dropbox-card";
import { GoogleMeetCard } from "./google-meet-card";
import { MicrosoftCard } from "./microsoft-card";
import { TelegramCard } from "./telegram-card";
import { TeamsCard } from "./teams-card";
import { VideoLinksCard } from "./video-links-card";
import { ZoomCard } from "./zoom-card";

const SECTIONS: Record<SettingsSlug, () => React.ReactNode> = {
  brand: BrandSettings,
  captions: CaptionsSettings,
  broll: BrollCard,
  motion: MotionSettings,
  editors: EditorsSettings,
  agent: AgentSettings,
  runs: RunsSettings,
  notifications: NotificationsSettings,
  team: TeamSettings,
  integrations: IntegrationsList,
};

const APPS: Record<IntegrationSlug, () => React.ReactNode> = {
  email: EmailSettings,
  slack: SlackSettings,
  discord: DiscordSettings,
  telegram: TelegramCard,
  zoom: ZoomCard,
  "google-meet": GoogleMeetCard,
  microsoft: MicrosoftCard,
  teams: TeamsCard,
  dropbox: DropboxCard,
  "video-links": VideoLinksCard,
  mcp: McpSettings,
};

/** One page of settings. */
export function SettingsSection({ slug }: { slug: SettingsSlug }) {
  const Section = SECTIONS[slug];
  return <Section />;
}

/** One app's page under Integrations. */
export function IntegrationSection({ slug }: { slug: IntegrationSlug }) {
  const App = APPS[slug];
  return <App />;
}
