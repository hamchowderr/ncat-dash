"use client";

import { api } from "@convex/_generated/api";
import {
  BUSY_LABELS,
  ENDING_LABELS,
  ENDINGS,
  getPreset,
  LOOK_LABELS,
  MOTION_BUSY,
  MOTION_LOOKS,
  MOTION_PIECES,
  type MotionPreset,
  type MotionSetup,
  type MotionStyle,
  OPENING_LABELS,
  OPENINGS,
  PRESET_GROUPS,
  SOUND_LEVEL_LABELS,
  SOUND_LEVELS,
} from "@ncat-dash/automation-core";
import { useMutation } from "convex/react";
import { Check } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { SettingsSection, SettingsTabs } from "./settings-shell";

const same = (a: MotionSetup, b: MotionSetup) => JSON.stringify(a) === JSON.stringify(b);

/** Whether the style is still exactly the preset's. */
const untouched = (setup: MotionSetup) =>
  JSON.stringify(getPreset(setup.preset)?.style) === JSON.stringify(setup.style);

function Choice<T extends string>({
  id,
  label,
  description,
  value,
  options,
  labels,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <Field orientation="responsive">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <Select value={value} onValueChange={(next) => onChange(next as T)} disabled={disabled}>
        <SelectTrigger id={id} className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {labels[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
        on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/60",
      )}
    >
      {on && <Check className="size-3" />}
    </span>
  );
}

/**
 * Settings > Motion: the preset a team's motion graphics start from, what it changed in
 * that style, and the names and handle the pieces show. Every Add Motion Graphics step
 * uses these unless it picks another preset.
 */
export function MotionCard({
  motion,
  presets,
  canEdit,
}: {
  motion: MotionSetup;
  presets: MotionPreset[];
  canEdit: boolean;
}) {
  const team = useActiveTeam();
  const setMotion = useMutation(api.teamSettings.setMotion);
  const [draft, setDraft] = useState<MotionSetup | null>(null);
  const [saving, setSaving] = useState(false);
  const shown = draft ?? motion;
  const changed = draft !== null && !same(draft, motion);
  const picked = presets.find((preset) => preset.id === shown.preset);

  const change = (next: Partial<MotionSetup>) => setDraft({ ...shown, ...next });
  const changeStyle = (next: Partial<MotionStyle>) =>
    change({ style: { ...shown.style, ...next } });
  const pick = (preset: MotionPreset) => change({ preset: preset.id, style: preset.style });

  function togglePiece(type: MotionStyle["pieces"][number]) {
    const on = shown.style.pieces.includes(type);
    changeStyle({
      pieces: MOTION_PIECES.map((piece) => piece.type).filter((other) =>
        other === type ? !on : shown.style.pieces.includes(other),
      ),
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      await setMotion({ organizationId: team.id, motion: draft });
      setDraft(null);
      toast.success("Motion settings saved.");
    } catch (caught) {
      toast.error(errorMessage(caught, "The settings could not be saved. Try again."));
    } finally {
      setSaving(false);
    }
  }

  const text = (name: keyof MotionSetup, label: string, description: string) => (
    <Field orientation="responsive">
      <FieldContent>
        <FieldLabel htmlFor={`motion-${name}`}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <Input
        id={`motion-${name}`}
        className="w-56"
        maxLength={60}
        value={shown[name] as string}
        onChange={(event) => change({ [name]: event.target.value })}
        disabled={!canEdit}
      />
    </Field>
  );

  return (
    <SettingsSection id="motion">
      <form onSubmit={onSubmit}>
        <FieldGroup>
          <SettingsTabs
            label="Motion"
            tabs={[
              { id: "style", label: "Style" },
              { id: "pieces", label: "Pieces" },
              { id: "names", label: "Names" },
            ]}
          >
            <TabsContent value="style">
              <FieldGroup>
                <FieldSet>
                  <FieldLegend variant="label" className="sr-only">
                    Style
                  </FieldLegend>
                  <FieldDescription>
                    Where your motion graphics start. Pick the one closest to your videos, then
                    change anything below. A step can still use another one.
                  </FieldDescription>
                  <div className="flex flex-col gap-5" role="radiogroup" aria-label="Style">
                    {PRESET_GROUPS.map((group) => {
                      const inGroup = presets.filter((preset) => preset.group === group);
                      if (inGroup.length === 0) return null;
                      return (
                        <div key={group} className="flex flex-col gap-1.5">
                          <p className="text-muted-foreground text-xs font-medium">{group}</p>
                          <div className="grid gap-1.5 sm:grid-cols-2">
                            {inGroup.map((preset) => {
                              const on = preset.id === shown.preset;
                              return (
                                <button
                                  key={preset.id}
                                  type="button"
                                  role="radio"
                                  aria-checked={on}
                                  disabled={!canEdit}
                                  onClick={() => pick(preset)}
                                  className={cn(
                                    "choice-tile focus-visible:ring-ring/50 flex flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-60",
                                  )}
                                >
                                  <span className="text-sm font-medium">{preset.name}</span>
                                  <span className="text-muted-foreground text-xs leading-snug">
                                    {preset.bestFor}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </FieldSet>

                <FieldSet>
                  <FieldLegend variant="label">
                    {picked ? `${picked.name}${untouched(shown) ? "" : ", changed"}` : "The style"}
                  </FieldLegend>
                  <FieldGroup>
                    <Choice
                      id="motion-look"
                      label="Look"
                      description="How the pieces are drawn. Your brand colour and font are used in all of them."
                      value={shown.style.look}
                      options={MOTION_LOOKS}
                      labels={LOOK_LABELS}
                      disabled={!canEdit}
                      onChange={(look) => changeStyle({ look })}
                    />
                    <Choice
                      id="motion-busy"
                      label="How busy"
                      description="How often pieces come in. Light leaves long stretches clear."
                      value={shown.style.busy}
                      options={MOTION_BUSY}
                      labels={BUSY_LABELS}
                      disabled={!canEdit}
                      onChange={(busy) => changeStyle({ busy })}
                    />
                    <Choice
                      id="motion-opening"
                      label="Opening"
                      description="What shows over the first seconds."
                      value={shown.style.opening}
                      options={OPENINGS}
                      labels={OPENING_LABELS}
                      disabled={!canEdit}
                      onChange={(opening) => changeStyle({ opening })}
                    />
                    <Choice
                      id="motion-ending"
                      label="Ending"
                      description="What shows over the last seconds."
                      value={shown.style.ending}
                      options={ENDINGS}
                      labels={ENDING_LABELS}
                      disabled={!canEdit}
                      onChange={(ending) => changeStyle({ ending })}
                    />
                    <Choice
                      id="motion-sound"
                      label="Sound effects"
                      description="How loud each piece's sound is, and how many an Add Sound Effects step adds."
                      value={shown.style.sound}
                      options={SOUND_LEVELS}
                      labels={SOUND_LEVEL_LABELS}
                      disabled={!canEdit}
                      onChange={(sound) => changeStyle({ sound })}
                    />
                  </FieldGroup>
                </FieldSet>
              </FieldGroup>
            </TabsContent>
            <TabsContent value="pieces">
              <FieldGroup>
                <FieldSet>
                  <FieldLegend variant="label" className="sr-only">
                    Pieces
                  </FieldLegend>
                  <FieldDescription>
                    The pieces this style uses. Each one comes in with its own sound.
                  </FieldDescription>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {MOTION_PIECES.map((piece) => {
                      const on = shown.style.pieces.includes(piece.type);
                      return (
                        <button
                          key={piece.type}
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          disabled={!canEdit}
                          onClick={() => togglePiece(piece.type)}
                          className={cn(
                            "bg-surface hover:bg-muted focus-visible:ring-ring/50 flex items-start gap-2.5 rounded-lg px-3 py-2 text-left outline-none transition-colors focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-60",
                            on && "bg-primary/10 hover:bg-primary/15",
                          )}
                        >
                          <span className="pt-0.5">
                            <Tick on={on} />
                          </span>
                          <span className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium">{piece.title}</span>
                            <span className="text-muted-foreground text-xs leading-snug">
                              {piece.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </FieldSet>
              </FieldGroup>
            </TabsContent>
            <TabsContent value="names">
              <FieldGroup>
                <FieldSet>
                  <FieldLegend variant="label" className="sr-only">
                    Names
                  </FieldLegend>
                  <FieldGroup>
                    {text(
                      "hostName",
                      "Usual speaker",
                      "Shown in the name lower third. Empty leaves it out.",
                    )}
                    {text("hostRole", "Their role", "The small line under the name.")}
                    {text(
                      "handle",
                      "Handle",
                      "Shown on the follow card at the end. Empty leaves it out.",
                    )}
                    {text("callToAction", "Under the handle", "The small line on the follow card.")}
                  </FieldGroup>
                </FieldSet>
              </FieldGroup>
            </TabsContent>
          </SettingsTabs>

          {canEdit ? (
            <Field orientation="horizontal">
              <Button type="submit" disabled={saving || !changed}>
                {saving ? "Saving" : "Save"}
              </Button>
              {changed && (
                <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                  Undo changes
                </Button>
              )}
            </Field>
          ) : (
            <FieldDescription>Only a team owner or admin can change this.</FieldDescription>
          )}
        </FieldGroup>
      </form>
    </SettingsSection>
  );
}
