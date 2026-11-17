"use client";

import { api } from "@convex/_generated/api";
import type { Brand, BrandKey } from "@ncat-dash/automation-core";
import { BRAND_KEYS } from "@ncat-dash/automation-core";
import { useMutation } from "convex/react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { FileChoice } from "@/components/steps/step-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

/**
 * The things a team sets once and every automation uses. A step that needs a logo, a
 * colour, a font or music takes it from here, so it is never asked for on the step.
 */
export function BrandCard({ brand, canEdit }: { brand: Brand; canEdit: boolean }) {
  const team = useActiveTeam();
  const setBrand = useMutation(api.teamSettings.setBrand);
  const [typed, setTyped] = useState<Brand | null>(null);
  const [pending, setPending] = useState(false);
  const shown = typed ?? brand;
  const set = (key: BrandKey, value: string) => setTyped({ ...shown, [key]: value });
  const hex = /^#[0-9A-Fa-f]{6}$/.test(shown.color ?? "") ? shown.color : "#000000";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!typed) return;
    setPending(true);
    try {
      await setBrand({
        organizationId: team.id,
        brand: Object.fromEntries(
          BRAND_KEYS.flatMap((key) => (typed[key]?.trim() ? [[key, typed[key]!.trim()]] : [])),
        ),
      });
      setTyped(null);
      toast.success("Saved");
    } catch (caught) {
      toast.error(errorMessage(caught, "Your brand could not be saved. Try again."));
    } finally {
      setPending(false);
    }
  }

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
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="brand-logo">Logo</FieldLabel>
              <FileChoice
                id="brand-logo"
                label="Logo"
                value={shown.logo ?? ""}
                onChange={(value) => set("logo", value)}
                disabled={!canEdit}
              />
              <FieldDescription>
                A PNG with a clear background works best. Pick one of your uploads or paste its
                address.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="brand-color">Brand colour</FieldLabel>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Pick the brand colour"
                  value={hex}
                  onChange={(event) => set("color", event.target.value.toUpperCase())}
                  disabled={!canEdit}
                  className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-1 disabled:cursor-not-allowed"
                />
                <Input
                  id="brand-color"
                  value={shown.color ?? ""}
                  onChange={(event) => set("color", event.target.value)}
                  placeholder="#FFCC00"
                  className="w-36"
                  autoComplete="off"
                  disabled={!canEdit}
                />
              </div>
              <FieldDescription>Used for text written on videos and pictures.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="brand-font">Font</FieldLabel>
              <Input
                id="brand-font"
                value={shown.font ?? ""}
                onChange={(event) => set("font", event.target.value)}
                placeholder="The Bold Font"
                autoComplete="off"
                disabled={!canEdit}
              />
              <FieldDescription>
                The name of a font installed on your toolkit. Left empty, text uses The Bold Font.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="brand-music">Background music</FieldLabel>
              <FileChoice
                id="brand-music"
                label="Background music"
                value={shown.music ?? ""}
                onChange={(value) => set("music", value)}
                disabled={!canEdit}
              />
              <FieldDescription>
                The track mixed under a video when a step adds music.
              </FieldDescription>
            </Field>
            {canEdit ? (
              <Field>
                <Button type="submit" className="w-fit" disabled={pending || !typed}>
                  {pending ? "Saving" : "Save brand"}
                </Button>
              </Field>
            ) : (
              <FieldDescription>Only a team owner or admin can change these.</FieldDescription>
            )}
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
