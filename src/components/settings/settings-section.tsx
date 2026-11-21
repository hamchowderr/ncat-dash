"use client";

import { BrollCard } from "./broll-card";
import { LooksCard } from "./looks-card";
import { McpSettings } from "./mcp-settings";
import type { SettingsSlug } from "./settings-pages";
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
import { ZoomCard } from "./zoom-card";

const SECTIONS: Record<SettingsSlug, () => React.ReactNode> = {
  brand: BrandSettings,
  captions: CaptionsSettings,
  looks: LooksCard,
  broll: BrollCard,
  motion: MotionSettings,
  editors: EditorsSettings,
  agent: AgentSettings,
  runs: RunsSettings,
  notifications: NotificationsSettings,
  email: EmailSettings,
  slack: SlackSettings,
  discord: DiscordSettings,
  telegram: TelegramCard,
  zoom: ZoomCard,
  "google-meet": GoogleMeetCard,
  microsoft: MicrosoftCard,
  teams: TeamsCard,
  dropbox: DropboxCard,
  mcp: McpSettings,
  team: TeamSettings,
};

/** One page of settings. */
export function SettingsSection({ slug }: { slug: SettingsSlug }) {
  const Section = SECTIONS[slug];
  return <Section />;
}
