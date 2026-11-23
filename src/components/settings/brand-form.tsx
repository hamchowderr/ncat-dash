"use client";

import { api } from "@convex/_generated/api";
import type { Brand } from "@takewon/automation-core";
import { readUploadRef } from "@takewon/automation-core";
import { useMutation, useQuery } from "convex/react";
import { FileX, Music, Upload, X } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { FileChoice, UploadPicker } from "@/components/steps/step-fields";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { useBrandUpload } from "@/lib/use-brand-upload";
import { cn } from "@/lib/utils";

export type MusicTrack = { name: string; file: string };

type Typed = { brand: Brand; music: MusicTrack[] };

/** The brand items that hold one value; music is a library of tracks. */
const SINGLE_KEYS = ["logo", "color", "font", "card", "intro", "outro"] as const;
type SingleKey = (typeof SINGLE_KEYS)[number];

/** A track's name to start with: its file name without the ending, kept apart from the rest. */
function trackName(fileName: string, taken: string[]): string {
  const base =
    fileName
      .replace(/\.[A-Za-z0-9]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim()
      .slice(0, 50) || "Track";
  let name = base;
  for (let n = 2; taken.some((other) => other.toLowerCase() === name.toLowerCase()); n += 1) {
    name = `${base} ${n}`;
  }
  return name;
}

/**
 * The things a team sets once and every automation uses: its logo, colour and font, and
 * a library of music. Shown while setting up and again in Settings.
 */
export function BrandForm({
  brand,
  music,
  canEdit,
  submitLabel = "Save brand",
  onSaved,
  save,
  rows = false,
  essentials = false,
}: {
  brand: Brand;
  music: MusicTrack[];
  canEdit: boolean;
  submitLabel?: string;
  onSaved?: () => void;
  /** Saves somewhere other than the team's own brand, such as a client's. */
  save?: (typed: Typed) => Promise<unknown>;
  /** Settings shows each setting as a row, its control on the right. */
  rows?: boolean;
  /**
   * Only the logo and colour, the two most steps use. Setting up shows these; the rest
   * (font, card, intro, outro, music) stay as they were and are set in Settings.
   */
  essentials?: boolean;
}) {
  const team = useActiveTeam();
  const setBrand = useMutation(api.teamSettings.setBrand);
  const uploads = useQuery(api.storage.listUploads, { organizationId: team.id });
  const { send, busy } = useBrandUpload();
  const picker = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState<Typed | null>(null);
  const [pending, setPending] = useState(false);
  const shown = typed ?? { brand, music };
  const set = (key: SingleKey, value: string) =>
    setTyped({ ...shown, brand: { ...shown.brand, [key]: value } });
  const orientation = rows ? "responsive" : "vertical";
  const hex = /^#[0-9A-Fa-f]{6}$/.test(shown.brand.color ?? "") ? shown.brand.color : "#000000";

  const trackUploads = shown.music.flatMap((track) => readUploadRef(track.file) ?? []);
  const trackNames = useQuery(
    api.storage.uploadNames,
    trackUploads.length > 0 ? { organizationId: team.id, ids: trackUploads } : "skip",
  );
  /** A track whose upload was removed: kept and marked, so the rest still saves. */
  const isGone = (file: string) => {
    const uploadId = readUploadRef(file);
    const named = uploadId ? trackNames?.find((name) => name.id === uploadId) : undefined;
    return named !== undefined && named.fileName === null;
  };
  const fileNameOf = (file: string) => {
    const uploadId = readUploadRef(file);
    if (!uploadId) return file;
    return (
      trackNames?.find((name) => name.id === uploadId)?.fileName ??
      uploads?.find((upload) => upload._id === uploadId)?.fileName ??
      "Your upload"
    );
  };
  const addTracks = (current: Typed, files: { file: string; fileName: string }[]) => {
    const tracks = [...current.music];
    for (const { file, fileName } of files) {
      if (tracks.some((track) => track.file === file)) continue;
      tracks.push({
        name: trackName(
          fileName,
          tracks.map((track) => track.name),
        ),
        file,
      });
    }
    return { ...current, music: tracks };
  };

  async function onPickFiles(files: File[]) {
    const added: { file: string; fileName: string }[] = [];
    for (const file of files) {
      const sent = await send(file);
      if (sent) added.push({ file: sent, fileName: file.name });
    }
    if (added.length > 0) setTyped((current) => addTracks(current ?? { brand, music }, added));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!typed) return onSaved?.();
    setPending(true);
    try {
      const cleaned = {
        brand: Object.fromEntries(
          SINGLE_KEYS.flatMap((key) =>
            typed.brand[key]?.trim() ? [[key, typed.brand[key]!.trim()]] : [],
          ),
        ),
        music: typed.music,
      };
      await (save ? save(cleaned) : setBrand({ organizationId: team.id, ...cleaned }));
      setTyped(null);
      toast.success("Saved");
      onSaved?.();
    } catch (caught) {
      toast.error(errorMessage(caught, "Your brand could not be saved. Try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <FieldGroup>
        <Field orientation={orientation} data-tour-step-id="tour-brand-look">
          <FieldContent>
            <FieldLabel htmlFor="brand-logo">Logo</FieldLabel>
            <FieldDescription>A PNG with a clear background works best.</FieldDescription>
          </FieldContent>
          <div className={rows ? "@md/field-group:w-72" : undefined}>
            <FileChoice
              id="brand-logo"
              label="Logo"
              value={shown.brand.logo ?? ""}
              onChange={(value) => set("logo", value)}
              disabled={!canEdit}
              upload="image"
              preview
            />
          </div>
        </Field>
        <Field orientation={orientation} data-tour-step-id="tour-brand-look">
          <FieldContent>
            <FieldLabel htmlFor="brand-color">Brand colour</FieldLabel>
            <FieldDescription>Used for text written on videos and pictures.</FieldDescription>
          </FieldContent>
          <div className={cn("flex items-center gap-2", rows && "@md/field-group:w-72")}>
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
              value={shown.brand.color ?? ""}
              onChange={(event) => set("color", event.target.value)}
              placeholder="#FFCC00"
              className={rows ? "flex-1" : "w-36"}
              autoComplete="off"
              disabled={!canEdit}
            />
          </div>
        </Field>
        {!essentials && (
          <>
            <Field orientation={orientation}>
              <FieldContent>
                <FieldLabel htmlFor="brand-font">Font</FieldLabel>
                <FieldDescription>
                  A font installed on your toolkit. Left empty, text uses The Bold Font.
                </FieldDescription>
              </FieldContent>
              <Input
                id="brand-font"
                value={shown.brand.font ?? ""}
                onChange={(event) => set("font", event.target.value)}
                placeholder="The Bold Font"
                autoComplete="off"
                disabled={!canEdit}
                className={rows ? "@md/field-group:w-72" : undefined}
              />
            </Field>
            <Field orientation={orientation}>
              <FieldContent>
                <FieldLabel htmlFor="brand-card">Card template</FieldLabel>
                <FieldDescription>
                  The picture quote cards and end cards are written on, such as your background with
                  your logo already on it. Make it the shape you post, for example 1080 by 1350.
                </FieldDescription>
              </FieldContent>
              <div className={rows ? "@md/field-group:w-72" : undefined}>
                <FileChoice
                  id="brand-card"
                  label="Card template"
                  value={shown.brand.card ?? ""}
                  onChange={(value) => set("card", value)}
                  disabled={!canEdit}
                  upload="image"
                  preview
                />
              </div>
            </Field>
            <Field orientation={orientation} data-tour-step-id="tour-brand-intro">
              <FieldContent>
                <FieldLabel htmlFor="brand-intro">Intro</FieldLabel>
                <FieldDescription>
                  A short video played before your videos by the intro and outro step.
                </FieldDescription>
              </FieldContent>
              <div className={rows ? "@md/field-group:w-72" : undefined}>
                <FileChoice
                  id="brand-intro"
                  label="Intro"
                  value={shown.brand.intro ?? ""}
                  onChange={(value) => set("intro", value)}
                  disabled={!canEdit}
                  upload="video"
                />
              </div>
            </Field>
            <Field orientation={orientation} data-tour-step-id="tour-brand-intro">
              <FieldContent>
                <FieldLabel htmlFor="brand-outro">Outro</FieldLabel>
                <FieldDescription>
                  A short video played after your videos by the intro and outro step.
                </FieldDescription>
              </FieldContent>
              <div className={rows ? "@md/field-group:w-72" : undefined}>
                <FileChoice
                  id="brand-outro"
                  label="Outro"
                  value={shown.brand.outro ?? ""}
                  onChange={(value) => set("outro", value)}
                  disabled={!canEdit}
                  upload="video"
                />
              </div>
            </Field>
            <Field data-tour-step-id="tour-brand-music">
              <FieldContent>
                <FieldLabel>Music library</FieldLabel>
                <FieldDescription>
                  Add as many tracks as you like. A step that adds music lets you pick one by name,
                  and uses the first one until you do.
                </FieldDescription>
              </FieldContent>
              {shown.music.length > 0 && (
                <ul className="flex flex-col gap-2" aria-label="Music tracks">
                  {shown.music.map((track, index) => (
                    <li key={track.file} className="flex items-center gap-2">
                      <Music className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                      <Input
                        aria-label={`Name of track ${index + 1}`}
                        value={track.name}
                        maxLength={60}
                        onChange={(event) =>
                          setTyped({
                            ...shown,
                            music: shown.music.map((other, at) =>
                              at === index ? { ...other, name: event.target.value } : other,
                            ),
                          })
                        }
                        autoComplete="off"
                        disabled={!canEdit}
                        className="w-44 shrink-0 sm:w-56"
                      />
                      {isGone(track.file) ? (
                        <span className="text-destructive flex min-w-0 flex-1 items-center gap-1.5 text-xs">
                          <FileX className="size-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">
                            Removed from your uploads.{" "}
                            {canEdit ? "Upload it again, or remove the track." : ""}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                          {fileNameOf(track.file)}
                        </span>
                      )}
                      {canEdit && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          onClick={() =>
                            setTyped({
                              ...shown,
                              music: shown.music.filter((_, at) => at !== index),
                            })
                          }
                        >
                          <X />
                          <span className="sr-only">Remove {track.name}</span>
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={picker}
                    type="file"
                    accept="audio/*"
                    multiple
                    className="sr-only"
                    aria-label="Upload music"
                    tabIndex={-1}
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.target.value = "";
                      void onPickFiles(files);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => picker.current?.click()}
                  >
                    <Upload />
                    {busy ? "Uploading" : "Upload music"}
                  </Button>
                  <UploadPicker
                    lasting
                    label="From uploads"
                    onPick={(file) =>
                      setTyped(addTracks(shown, [{ file, fileName: fileNameOf(file) }]))
                    }
                  />
                </div>
              )}
            </Field>
          </>
        )}
        {canEdit ? (
          <Field orientation="horizontal">
            <Button type="submit" className="w-fit" disabled={pending || (!typed && !onSaved)}>
              {pending ? "Saving" : submitLabel}
            </Button>
          </Field>
        ) : (
          <FieldDescription>Only a team owner or admin can change these.</FieldDescription>
        )}
      </FieldGroup>
    </form>
  );
}
