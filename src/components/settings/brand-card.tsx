"use client";

import type { Brand } from "@ncat-dash/automation-core";

import { BrandForm, type MusicTrack } from "./brand-form";
import { SettingsSection } from "./settings-shell";

/** The team's brand in Settings. The same form is shown once while setting up. */
export function BrandCard({
  brand,
  music,
  canEdit,
}: {
  brand: Brand;
  music: MusicTrack[];
  canEdit: boolean;
}) {
  return (
    <SettingsSection>
      <BrandForm brand={brand} music={music} canEdit={canEdit} rows />
    </SettingsSection>
  );
}
