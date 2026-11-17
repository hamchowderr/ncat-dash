"use client";

import type { Brand } from "@ncat-dash/automation-core";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { BrandForm, type MusicTrack } from "./brand-form";

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
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>
          <h2>Brand</h2>
        </CardTitle>
        <CardDescription>
          Set these once. Any step that adds a logo, writes text or adds music uses them by itself,
          in every automation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <BrandForm brand={brand} music={music} canEdit={canEdit} />
      </CardContent>
    </Card>
  );
}
