"use client";

import type { Brand } from "@takewon/automation-core";

import { StartPageTour } from "@/components/tours/page-tour";

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
      <StartPageTour tourId="brand" />
      <BrandForm brand={brand} music={music} canEdit={canEdit} rows />
    </SettingsSection>
  );
}
