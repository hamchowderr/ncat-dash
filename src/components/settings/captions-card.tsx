"use client";

import { api } from "@convex/_generated/api";
import {
  CAPTION_LOOKS,
  CAPTION_POSITIONS,
  CAPTION_SHAPES,
  type CaptionLook,
  type CaptionSetup,
  type CaptionShape,
  type CaptionStyle,
  LOOK_WORDS,
  POSITION_WORDS,
} from "@takewon/automation-core";
import { useMutation } from "convex/react";
import { ArrowRight, ChevronRight, Copy, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { CAPTION_EXAMPLE_WORDS } from "./caption-example-words";
import { CaptionLivePreview, CaptionPreview } from "./caption-preview";
import { EXAMPLES, ExamplePane, useExample, WithExample } from "./example-pane";
import { SettingRow, SettingsSection, SettingsTabs } from "./settings-shell";

function same(a: CaptionSetup, b: CaptionSetup) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A name for a new style that no other style has. */
function freeName(base: string, taken: string[]): string {
  let name = base;
  for (let n = 2; taken.some((other) => other.toLowerCase() === name.toLowerCase()); n += 1) {
    name = `${base} ${n}`;
  }
  return name;
}

/** The example clip a built-in style was rendered to (public/examples/captions). */
const builtInClip = (name: string) =>
  `${EXAMPLES}/captions/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mp4`;

/**
 * The example beside the styles: a built-in style plays the clip the toolkit rendered with
 * it; a style of your own, or one being changed, is drawn live over the same clip.
 */
function CaptionExample({
  style,
  look,
  builtIn,
  font,
}: {
  style: CaptionStyle | null;
  /** The look to show, with anything being tried in the editor. */
  look: CaptionLook | null;
  builtIn: CaptionStyle[];
  font?: string;
}) {
  if (!style || !look) return <ExamplePane src={null} label="Point at a style to see it." />;
  const asBuilt = builtIn.find((each) => each.name === style.name);
  // The rendered clip is only true to the style when nothing changes how it looks: a brand
  // font is used by built-in looks, which name none, so that is drawn live too.
  const real = asBuilt && !font && JSON.stringify(asBuilt.look) === JSON.stringify(look);
  const label = `Example: ${style.name}`;
  if (real) return <ExamplePane src={builtInClip(style.name)} label={label} />;
  return (
    <ExamplePane label={label}>
      <CaptionLivePreview
        look={look}
        font={font}
        video={`${EXAMPLES}/captions/plain.mp4`}
        segments={CAPTION_EXAMPLE_WORDS}
      />
    </ExamplePane>
  );
}

/**
 * Captions in Settings: words the transcript gets wrong, saved caption looks, and the
 * look each video shape gets. Every caption step uses them without being told.
 */
export function CaptionsCard({
  captions,
  builtIn,
  builtInByShape,
  font,
  canEdit,
}: {
  captions: CaptionSetup;
  builtIn: CaptionStyle[];
  builtInByShape: Record<CaptionShape, string>;
  /** The team's font from Brand, used by a look that names none. */
  font?: string;
  canEdit: boolean;
}) {
  const team = useActiveTeam();
  const setCaptions = useMutation(api.teamSettings.setCaptions);
  // What this person has changed and not saved yet; null shows what is saved.
  const [draft, setDraft] = useState<CaptionSetup | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<string | null>(captions.styles[0]?.name ?? null);
  const shown = draft ?? captions;
  const changed = draft !== null && !same(draft, captions);
  const change = (next: Partial<CaptionSetup>) => setDraft({ ...shown, ...next });
  const all = [...shown.styles, ...builtIn];
  const opened = all.find((style) => style.name === open) ?? null;
  // The style under the pointer plays its example; otherwise the open one does, with
  // whatever the pointer is on in its editor (a word effect, a position) tried on it.
  const { example, hover } = useExample<string>();
  const [trying, setTrying] = useState<Partial<CaptionLook> | null>(null);
  const pointed = example ? (all.find((style) => style.name === example) ?? null) : null;
  const exampleStyle = pointed ?? opened;
  const exampleLook = pointed ? pointed.look : opened ? { ...opened.look, ...trying } : null;
  const ownIndex = shown.styles.findIndex((style) => style.name === open);
  const shapeStyle = (shape: CaptionShape) => {
    const picked = shown.byShape[shape];
    return picked && all.some((style) => style.name === picked) ? picked : builtInByShape[shape];
  };

  function setFix(index: number, part: "find" | "replace", value: string) {
    change({
      fixes: shown.fixes.map((fix, at) => (at === index ? { ...fix, [part]: value } : fix)),
    });
  }

  function addStyle(from: CaptionStyle) {
    const name = freeName(
      from.name === "Bold highlight" ? "Our captions" : `${from.name} copy`,
      all.map((style) => style.name),
    );
    change({ styles: [...shown.styles, { name, look: { ...from.look } }] });
    setOpen(name);
  }

  function updateStyle(next: CaptionStyle) {
    const before = shown.styles[ownIndex];
    const renamed = before.name !== next.name;
    change({
      styles: shown.styles.map((style, at) => (at === ownIndex ? next : style)),
      // A renamed style keeps its place on every shape it was picked for.
      byShape: renamed
        ? Object.fromEntries(
            Object.entries(shown.byShape).map(([shape, name]) => [
              shape,
              name === before.name ? next.name : name,
            ]),
          )
        : shown.byShape,
    });
    if (renamed) setOpen(next.name);
  }

  function removeStyle() {
    const name = shown.styles[ownIndex].name;
    change({
      styles: shown.styles.filter((_, at) => at !== ownIndex),
      byShape: Object.fromEntries(
        Object.entries(shown.byShape).filter(([, picked]) => picked !== name),
      ),
    });
    setOpen(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      await setCaptions({ organizationId: team.id, captions: draft });
      setDraft(null);
      toast.success("Captions saved.");
    } catch (caught) {
      toast.error(errorMessage(caught, "Captions could not be saved. Try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-10">
      <SettingsTabs
        label="Captions"
        tabs={[
          { id: "styles", label: "Styles" },
          { id: "shapes", label: "Style For Each Shape" },
          { id: "words", label: "Word Fixes" },
        ]}
      >
        <TabsContent value="styles">
          <WithExample
            example={
              <CaptionExample
                style={exampleStyle}
                look={exampleLook}
                builtIn={builtIn}
                font={font}
              />
            }
          >
            <SettingsSection
              description="Point at one to see it play, pick one to change it. Copy a built-in one to make your own."
              aria-label="Styles"
            >
              <div className="flex flex-wrap gap-1">
                {all.map((style) => {
                  const own = shown.styles.includes(style);
                  const active = style.name === open;
                  return (
                    <button
                      key={`${own ? "own" : "built"}:${style.name}`}
                      type="button"
                      aria-pressed={active}
                      aria-label={`${style.name}${own ? "" : ", built in"}`}
                      onClick={() => setOpen(active ? null : style.name)}
                      {...hover(style.name)}
                      className={cn(
                        "choice-tile focus-visible:ring-ring/50 flex w-[5.25rem] flex-col gap-1.5 rounded-xl p-1.5 text-left focus-visible:ring-3",
                      )}
                    >
                      <CaptionPreview look={style.look} font={font} zoom={0.65} />
                      <span className="truncate px-0.5 text-xs font-medium">{style.name}</span>
                    </button>
                  );
                })}
              </div>

              {opened &&
                (ownIndex >= 0 ? (
                  <StyleEditor
                    key={ownIndex}
                    style={opened}
                    font={font}
                    taken={all.map((style) => style.name).filter((name) => name !== opened.name)}
                    canEdit={canEdit}
                    onChange={updateStyle}
                    onRemove={removeStyle}
                    onTry={setTrying}
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <p className="text-muted-foreground text-sm text-pretty">
                      {opened.name}: {LOOK_WORDS[opened.look.style ?? "classic"].text.toLowerCase()}
                      . Built in, so it stays as it is.
                    </p>
                    {canEdit && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addStyle(opened)}
                      >
                        <Copy />
                        Make a copy to change
                      </Button>
                    )}
                  </div>
                ))}
            </SettingsSection>
          </WithExample>
        </TabsContent>
        <TabsContent value="shapes">
          <SettingsSection
            description="Used by a caption step that does not pick its own style."
            aria-label="Style for each shape"
          >
            <div className="flex flex-col gap-4">
              {CAPTION_SHAPES.map(({ shape, label, example }) => (
                <SettingRow
                  key={shape}
                  label={label}
                  htmlFor={`caption-shape-${shape}`}
                  description={example}
                >
                  <Select
                    value={shapeStyle(shape)}
                    disabled={!canEdit}
                    onValueChange={(name) =>
                      change({ byShape: { ...shown.byShape, [shape]: name } })
                    }
                  >
                    <SelectTrigger id={`caption-shape-${shape}`} className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {shown.styles.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>Yours</SelectLabel>
                          {shown.styles.map((style) => (
                            <SelectItem key={style.name} value={style.name}>
                              {style.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      <SelectGroup>
                        <SelectLabel>Built in</SelectLabel>
                        {builtIn.map((style) => (
                          <SelectItem key={style.name} value={style.name}>
                            {style.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </SettingRow>
              ))}
            </div>
          </SettingsSection>
        </TabsContent>
        <TabsContent value="words">
          <SettingsSection
            description="Words the transcript gets wrong, and how to write them. One word each."
            aria-label="Word fixes"
          >
            {shown.fixes.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {shown.fixes.map((fix, index) => (
                  <li
                    key={index}
                    className="grid grid-cols-[1fr_1rem_1fr_2.25rem] items-center gap-2"
                  >
                    <Input
                      aria-label={`Word ${index + 1} heard as`}
                      value={fix.find}
                      placeholder="Heard as"
                      maxLength={60}
                      disabled={!canEdit}
                      autoComplete="off"
                      onChange={(event) => setFix(index, "find", event.target.value)}
                    />
                    <ArrowRight className="text-muted-foreground size-4" aria-hidden="true" />
                    <Input
                      aria-label={`Word ${index + 1} written as`}
                      value={fix.replace}
                      placeholder="Written as"
                      maxLength={60}
                      disabled={!canEdit}
                      autoComplete="off"
                      onChange={(event) => setFix(index, "replace", event.target.value)}
                    />
                    {canEdit && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground"
                        title="Remove"
                        onClick={() =>
                          change({ fixes: shown.fixes.filter((_, at) => at !== index) })
                        }
                      >
                        <X />
                        <span className="sr-only">Remove word {index + 1}</span>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No word fixes yet.</p>
            )}
            {canEdit && (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground -ml-2"
                  onClick={() => change({ fixes: [...shown.fixes, { find: "", replace: "" }] })}
                >
                  <Plus />
                  Add a word
                </Button>
              </div>
            )}
          </SettingsSection>
        </TabsContent>
      </SettingsTabs>

      {canEdit ? (
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={saving || !changed}>
            {saving ? "Saving" : "Save"}
          </Button>
          {changed && (
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
              Undo changes
            </Button>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Only a team owner or admin can change these.
        </p>
      )}
    </form>
  );
}

/**
 * Changing one of the team's own styles: a still of it beside the few things people change
 * most, with the rest folded under More options.
 */
function StyleEditor({
  style,
  font,
  taken,
  canEdit,
  onChange,
  onRemove,
  onTry,
}: {
  style: CaptionStyle;
  font?: string;
  taken: string[];
  canEdit: boolean;
  onChange: (style: CaptionStyle) => void;
  onRemove: () => void;
  /** A change the pointer is on and not yet picked, played in the example beside. */
  onTry: (look: Partial<CaptionLook> | null) => void;
}) {
  const [name, setName] = useState(style.name);
  const look = style.look;
  const set = (next: Partial<CaptionLook>) => onChange({ ...style, look: { ...look, ...next } });
  const number = (key: keyof CaptionLook, value: string) =>
    set({ [key]: value === "" ? undefined : Number(value) } as Partial<CaptionLook>);
  const clash = taken.some((other) => other.toLowerCase() === name.trim().toLowerCase());
  const effect = look.style ?? "classic";
  const id = (part: string) => `caption-style-${part}`;

  return (
    <div
      aria-label={`Change ${style.name}`}
      role="group"
      className="bg-surface flex flex-col gap-6 rounded-xl p-5 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <LookField
          label="Name"
          htmlFor={id("name")}
          problem={clash ? "Another style has this name." : null}
        >
          <Input
            id={id("name")}
            value={name}
            maxLength={40}
            disabled={!canEdit}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              const trimmed = name.trim();
              if (trimmed && !clash && trimmed !== style.name)
                onChange({ ...style, name: trimmed });
              else setName(style.name);
            }}
          />
        </LookField>
        <div className="grid gap-4 sm:grid-cols-2">
          <LookField label="Word effect" htmlFor={id("effect")}>
            <Select
              value={effect}
              disabled={!canEdit}
              onValueChange={(value) => set({ style: value as CaptionLook["style"] })}
              onOpenChange={(isOpen) => {
                if (!isOpen) onTry(null);
              }}
            >
              <SelectTrigger id={id("effect")} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAPTION_LOOKS.map((kind) => (
                  <SelectItem key={kind} value={kind} onFocus={() => onTry({ style: kind })}>
                    {LOOK_WORDS[kind].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </LookField>
          <ColourField
            label="Highlight colour"
            id={id("word")}
            value={look.word_color}
            fallback="#FFFF00"
            disabled={
              !canEdit ||
              effect === "classic" ||
              effect === "word_by_word" ||
              effect === "underline"
            }
            onChange={(word_color) => set({ word_color })}
          />
        </div>
        <LookField label="Position">
          <div
            role="radiogroup"
            aria-label="Position"
            className="flex h-9 items-stretch gap-0.5 rounded-[11px] bg-foreground/[0.055] p-[3px]"
          >
            {CAPTION_POSITIONS.map((position) => {
              const on = (look.position ?? "bottom_center") === position;
              return (
                <button
                  key={position}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!canEdit}
                  onClick={() => set({ position })}
                  onPointerEnter={() => onTry({ position })}
                  onPointerLeave={() => onTry(null)}
                  onFocus={() => onTry({ position })}
                  onBlur={() => onTry(null)}
                  className={cn(
                    "text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex-1 rounded-lg px-3 text-sm font-medium outline-none transition-[color,background-color,box-shadow] focus-visible:ring-3",
                    on &&
                      "bg-background text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06),0_1px_1px_rgb(0_0_0/0.04)]",
                  )}
                >
                  {POSITION_WORDS[position]}
                </button>
              );
            })}
          </div>
        </LookField>
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch
            checked={Boolean(look.all_caps)}
            disabled={!canEdit}
            onCheckedChange={(all_caps) => set({ all_caps })}
          />
          All capitals
        </label>

        <Collapsible>
          <CollapsibleTrigger className="group text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-md py-1 text-sm font-medium outline-none focus-visible:underline">
            <ChevronRight
              className="size-4 transition-transform group-data-[state=open]:rotate-90"
              aria-hidden="true"
            />
            More options
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid gap-4 pt-3 sm:grid-cols-2">
              <LookField
                label="Font"
                htmlFor={id("font")}
                hint={font ? `Blank uses your brand font, ${font}.` : undefined}
              >
                <Input
                  id={id("font")}
                  value={look.font_family ?? ""}
                  placeholder={font ?? "Arial"}
                  maxLength={80}
                  disabled={!canEdit}
                  autoComplete="off"
                  onChange={(event) => set({ font_family: event.target.value || undefined })}
                />
              </LookField>
              <LookField label="Text size" htmlFor={id("size")} hint="Pixels on a 1080p video.">
                <Input
                  id={id("size")}
                  type="number"
                  min={8}
                  max={400}
                  value={look.font_size ?? ""}
                  disabled={!canEdit}
                  onChange={(event) => number("font_size", event.target.value)}
                />
              </LookField>
              <LookField label="Words per line" htmlFor={id("words")}>
                <Input
                  id={id("words")}
                  type="number"
                  min={1}
                  max={20}
                  value={look.max_words_per_line ?? ""}
                  disabled={!canEdit || effect === "word_by_word"}
                  onChange={(event) => number("max_words_per_line", event.target.value)}
                />
              </LookField>
              <ColourField
                label="Text colour"
                id={id("line")}
                value={look.line_color}
                fallback="#FFFFFF"
                disabled={!canEdit}
                onChange={(line_color) => set({ line_color })}
              />
              <ColourField
                label="Outline colour"
                id={id("outline-colour")}
                value={look.outline_color}
                fallback="#000000"
                disabled={!canEdit}
                onChange={(outline_color) => set({ outline_color })}
              />
              <div className="grid grid-cols-2 gap-3">
                <LookField label="Outline" htmlFor={id("outline")}>
                  <Input
                    id={id("outline")}
                    type="number"
                    min={0}
                    max={20}
                    value={look.outline_width ?? ""}
                    disabled={!canEdit}
                    onChange={(event) => number("outline_width", event.target.value)}
                  />
                </LookField>
                <LookField label="Shadow" htmlFor={id("shadow")}>
                  <Input
                    id={id("shadow")}
                    type="number"
                    min={0}
                    max={20}
                    value={look.shadow_offset ?? ""}
                    disabled={!canEdit}
                    onChange={(event) => number("shadow_offset", event.target.value)}
                  />
                </LookField>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <Switch
                  checked={Boolean(look.bold)}
                  disabled={!canEdit}
                  onCheckedChange={(bold) => set({ bold })}
                />
                Bold
              </label>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {canEdit && (
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground -ml-2"
              onClick={onRemove}
            >
              <Trash2 />
              Remove style
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function LookField({
  label,
  htmlFor,
  hint,
  problem,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  problem?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
      ) : (
        <span className="text-sm font-medium">{label}</span>
      )}
      {children}
      {(problem || hint) && (
        <span className={cn("text-xs", problem ? "text-destructive" : "text-muted-foreground")}>
          {problem ?? hint}
        </span>
      )}
    </div>
  );
}

function ColourField({
  label,
  id,
  value,
  fallback,
  disabled,
  onChange,
}: {
  label: string;
  id: string;
  value: string | undefined;
  fallback: string;
  disabled: boolean;
  onChange: (value: string | undefined) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const hex = /^#[0-9A-Fa-f]{6}$/;
  return (
    <LookField label={label} htmlFor={id}>
      <div className={cn("flex items-center gap-2", disabled && "opacity-60")}>
        <input
          type="color"
          aria-label={`${label}, picker`}
          value={value ?? fallback}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="size-9 shrink-0 cursor-pointer rounded-md bg-transparent p-0.5 disabled:cursor-default"
        />
        <Input
          id={id}
          value={typed ?? value ?? ""}
          placeholder={fallback}
          maxLength={7}
          disabled={disabled}
          autoComplete="off"
          className="font-mono uppercase"
          onChange={(event) => {
            const next = event.target.value.trim();
            setTyped(next);
            if (next === "") onChange(undefined);
            else if (hex.test(next)) onChange(next.toUpperCase());
          }}
          onBlur={() => setTyped(null)}
        />
      </div>
    </LookField>
  );
}
