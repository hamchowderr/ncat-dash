"use client";

import type { SettingsSlug } from "./settings-pages";
import {
  AgentSettings,
  BrandSettings,
  ChatSettings,
  EditorsSettings,
  EmailSettings,
  NotificationsSettings,
  RunsSettings,
  TeamSettings,
} from "./settings-view";

const SECTIONS: Record<SettingsSlug, () => React.ReactNode> = {
  brand: BrandSettings,
  editors: EditorsSettings,
  agent: AgentSettings,
  runs: RunsSettings,
  notifications: NotificationsSettings,
  email: EmailSettings,
  chat: ChatSettings,
  team: TeamSettings,
};

/** One page of settings. */
export function SettingsSection({ slug }: { slug: SettingsSlug }) {
  const Section = SECTIONS[slug];
  return <Section />;
}
