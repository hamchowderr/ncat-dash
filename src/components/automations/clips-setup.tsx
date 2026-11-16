"use client";

import { type ClipsSetup, formatLimit, getPlatform } from "@ncat-dash/automation-core";
import {
  ArrowRight,
  Captions,
  FolderInput,
  Hand,
  LoaderCircle,
  Play,
  Power,
  SlidersHorizontal,
  UploadCloud,
  UserCheck,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { Trigger } from "@/lib/automations";
import { triggerSummary } from "@/lib/automations";
import { cn } from "@/lib/utils";

import { CaptionSample } from "./caption-sample";
import { PlatformPicker } from "./platform-picker";

function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section className={cn("bg-card grid gap-4 rounded-2xl border p-5", className)} {...props} />
  );
}

function PanelLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="text-muted-foreground flex items-center justify-between gap-2 font-mono text-[11.5px]">
      <h2 className="tracking-[0.08em] uppercase">{children}</h2>
      {aside && <span>{aside}</span>}
    </div>
  );
}

const SOURCES = [
  {
    kind: "upload",
    title: "Uploads",
    hint: "Every video added on the Uploads page",
    icon: UploadCloud,
  },
  {
    kind: "folder",
    title: "A folder in your bucket",
    hint: "Checked every minute for new videos",
    icon: FolderInput,
  },
  { kind: "manual", title: "Only when I run it", hint: "Nothing starts by itself", icon: Hand },
] as const;

/**
 * Setting up a clips automation: where videos arrive, the platform, captions, and the
 * switch. These are chosen once; after that it runs with nobody there.
 */
export function ClipsSetupPanel({
  setup,
  onSetup,
  trigger,
  onTrigger,
  enabled,
  dirty,
  busy,
  onToggle,
  onSave,
  onTry,
}: {
  setup: ClipsSetup;
  onSetup: (setup: ClipsSetup) => void;
  trigger: Trigger;
  onTrigger: (trigger: Trigger) => void;
  enabled: boolean;
  dirty: boolean;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onSave: () => void;
  onTry: () => void;
}) {
  const platform = getPlatform(setup.platform);
  const custom = !SOURCES.some((source) => source.kind === trigger.kind);
  const byItself = trigger.kind !== "manual";

  function pickSource(kind: (typeof SOURCES)[number]["kind"]) {
    if (kind === trigger.kind) return;
    if (kind === "upload") onTrigger({ kind, fileType: "video" });
    else if (kind === "folder") onTrigger({ kind, prefix: "incoming/", fileType: "video" });
    else onTrigger({ kind });
  }

  return (
    <div className="mx-auto grid w-full max-w-180 gap-4 pb-8">
      <Panel>
        <PanelLabel>Where videos arrive</PanelLabel>
        <div
          role="radiogroup"
          aria-label="Where videos arrive"
          className="grid gap-2 sm:grid-cols-3"
        >
          {SOURCES.map((source) => {
            const on = source.kind === trigger.kind;
            return (
              <button
                key={source.kind}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={busy}
                onClick={() => pickSource(source.kind)}
                className={cn(
                  "bg-background hover:border-muted-foreground/60 focus-visible:ring-ring/50 grid gap-1 rounded-lg border p-3 text-left outline-none transition-[border-color,background-color] duration-150 focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-60",
                  on && "border-primary bg-primary/5 hover:border-primary",
                )}
              >
                <source.icon className="size-4" aria-hidden="true" />
                <span className="text-sm leading-tight font-medium">{source.title}</span>
                <span className="text-muted-foreground text-xs">{source.hint}</span>
              </button>
            );
          })}
        </div>
        {trigger.kind === "folder" && (
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Folder</span>
            <Input
              value={trigger.prefix}
              placeholder="incoming/"
              maxLength={500}
              disabled={busy}
              onChange={(event) =>
                onTrigger({ ...trigger, prefix: event.target.value.replace(/^\/+/, "") })
              }
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
            <span className="text-muted-foreground">
              Videos already in the folder when you switch on are left alone.
            </span>
          </label>
        )}
        {custom && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            Set on the Steps tab: {triggerSummary(trigger).toLowerCase()}. Pick one above to change
            it.
          </p>
        )}
      </Panel>

      <Panel>
        <PanelLabel aside={platform && `up to ${formatLimit(platform.maxSeconds)} per clip`}>
          Platform
        </PanelLabel>
        <PlatformPicker
          value={setup.platform}
          disabled={busy}
          onChange={(name) => onSetup({ ...setup, platform: name })}
        />
      </Panel>

      <label
        htmlFor="setup-captions"
        className="bg-card grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border p-5"
      >
        <span>
          <span className="flex items-center gap-2 font-medium">
            <Captions className="size-4" aria-hidden="true" />
            Add captions
          </span>
          <span className="text-muted-foreground mt-0.5 block text-sm">
            Transcribes each clip and burns the words in, with the word being spoken highlighted.
          </span>
        </span>
        <Switch
          id="setup-captions"
          checked={setup.captions}
          disabled={busy}
          onCheckedChange={(captions) => onSetup({ ...setup, captions })}
        />
        <span className="col-span-2">
          <CaptionSample active={setup.captions} />
        </span>
      </label>

      <label
        htmlFor="setup-approve"
        className="bg-card grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border p-5"
      >
        <span>
          <span className="flex items-center gap-2 font-medium">
            <UserCheck className="size-4" aria-hidden="true" />
            Let me look first
          </span>
          <span className="text-muted-foreground mt-0.5 block text-sm">
            Each batch of clips waits for someone on the team to approve it.
          </span>
        </span>
        <Switch
          id="setup-approve"
          checked={setup.approve}
          disabled={busy}
          onCheckedChange={(approve) => onSetup({ ...setup, approve })}
        />
      </label>

      {enabled && !dirty ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-emerald-600/30 bg-emerald-600/5 p-5">
          <span className="relative flex size-2.5" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
          </span>
          <span>
            <span className="block font-medium">It is on</span>
            <span className="text-muted-foreground block text-sm">
              {byItself
                ? `${triggerSummary(trigger)}. Nobody needs to be here.`
                : "It runs when you hand it a video."}
            </span>
          </span>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onToggle(false)}>
            <Power />
            Switch off
          </Button>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => (enabled ? onSave() : onToggle(true))}
          className="group bg-primary text-primary-foreground focus-visible:ring-ring/50 flex h-13 items-center justify-center gap-2.5 rounded-xl text-base font-semibold outline-none transition-[transform,filter,opacity] duration-150 hover:-translate-y-px hover:brightness-110 focus-visible:ring-3 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        >
          {busy ? <LoaderCircle className="size-4.5 animate-spin" aria-hidden="true" /> : null}
          {enabled ? "Save changes" : "Switch on"}
          {!busy && (
            <ArrowRight
              className="size-4.5 transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
              aria-hidden="true"
            />
          )}
        </button>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-muted-foreground text-sm">Want to see what it makes first?</p>
        <Button variant="outline" size="sm" disabled={busy} onClick={onTry}>
          <Play />
          Try it on one video
        </Button>
      </div>
    </div>
  );
}
