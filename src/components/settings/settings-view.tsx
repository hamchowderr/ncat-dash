"use client";

import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { AgentCard } from "./agent-card";
import { AnthropicKeyCard } from "./anthropic-key-card";
import { BrandCard } from "./brand-card";
import { CaptionsCard } from "./captions-card";
import { EditorsCard } from "./editors-card";
import { EmailCard } from "./email-card";
import { MotionCard } from "./motion-card";
import { NotificationsCard } from "./notifications-card";
import { SettingRow, SettingsLoading, SettingsSection, useTeamSettings } from "./settings-shell";
import { DiscordCard } from "./discord-card";
import { SlackCard } from "./slack-card";
import { TeamCard } from "./team-card";

type Loaded = NonNullable<ReturnType<typeof useTeamSettings>>;

/** Brand: logo, colour, font and music, set once for every automation. */
export function BrandSettings() {
  const settings = useTeamSettings();
  if (!settings) return <SettingsLoading />;
  return <BrandCard brand={settings.brand} music={settings.music} canEdit={settings.canEdit} />;
}

/** Captions: word fixes, saved styles, and the style for each video shape. */
export function CaptionsSettings() {
  const settings = useTeamSettings();
  if (!settings) return <SettingsLoading />;
  return (
    <CaptionsCard
      captions={settings.captions}
      builtIn={settings.builtInCaptionStyles}
      builtInByShape={settings.builtInByShape}
      font={settings.brand.font}
      canEdit={settings.canEdit}
    />
  );
}

/** Motion: the style motion graphics start from, and the names they show. */
export function MotionSettings() {
  const settings = useTeamSettings();
  if (!settings) return <SettingsLoading />;
  return (
    <MotionCard
      motion={settings.motion}
      presets={settings.motionPresets}
      canEdit={settings.canEdit}
    />
  );
}

/** The editors the team finishes videos in. */
export function EditorsSettings() {
  const settings = useTeamSettings();
  if (!settings) return <SettingsLoading />;
  return <EditorsCard editors={settings.editors} canEdit={settings.canEdit} />;
}

/** The agent's model, house rules and default platforms. */
export function AgentSettings() {
  const settings = useTeamSettings();
  if (!settings) return <SettingsLoading />;
  return (
    <div className="flex flex-col gap-12">
      <AgentCard
        agent={settings.agent}
        models={settings.agentModels}
        mostHouseRules={settings.mostHouseRules}
        canEdit={settings.canEdit}
      />
      <AnthropicKeyCard anthropicKey={settings.anthropicKey} canEdit={settings.canEdit} />
    </div>
  );
}

/** How runs use the toolkit: jobs at once, and what happens when a step fails. */
export function RunsSettings() {
  const settings = useTeamSettings();
  if (!settings) return <SettingsLoading />;
  return <RunsForms settings={settings} />;
}

function RunsForms({ settings }: { settings: Loaded }) {
  const team = useActiveTeam();
  const setLimit = useMutation(api.teamSettings.setMaxParallelJobs);
  const [typed, setTyped] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const setRetries = useMutation(api.teamSettings.setStepRetries);
  const [typedRetries, setTypedRetries] = useState<string | null>(null);
  const [savingRetries, setSavingRetries] = useState(false);

  async function onSubmitRetries(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (typedRetries === null) return;
    setSavingRetries(true);
    try {
      await setRetries({ organizationId: team.id, stepRetries: Number(typedRetries) });
      setTypedRetries(null);
      toast.success("Saved");
    } catch (caught) {
      toast.error(errorMessage(caught, "The setting could not be saved. Try again."));
    } finally {
      setSavingRetries(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (typed === null) return;
    setPending(true);
    try {
      await setLimit({ organizationId: team.id, maxParallelJobs: Number(typed) });
      setTyped(null);
      toast.success("Saved");
    } catch (caught) {
      toast.error(errorMessage(caught, "The setting could not be saved. Try again."));
    } finally {
      setPending(false);
    }
  }

  const onlyManagers = "Only a team owner or admin can change these.";

  return (
    <SettingsSection>
      <form onSubmit={onSubmit}>
        <SettingRow
          label="Jobs at once"
          htmlFor="max-parallel"
          description={`How many jobs your toolkit works on at the same time. The rest wait their turn. 1 to ${settings.mostAllowed}.`}
        >
          <Input
            id="max-parallel"
            type="number"
            min={1}
            max={settings.mostAllowed}
            step={1}
            className="w-20 tabular-nums"
            value={typed ?? String(settings.maxParallelJobs)}
            onChange={(event) => setTyped(event.target.value)}
            disabled={!settings.canEdit}
            required
          />
          {settings.canEdit && typed !== null && (
            <Button type="submit" disabled={pending}>
              {pending ? "Saving" : "Save"}
            </Button>
          )}
        </SettingRow>
      </form>
      <form onSubmit={onSubmitRetries}>
        <SettingRow
          label="Tries after a failure"
          htmlFor="step-retries"
          description={`How many more times a failed step tries before the run stops and the team is told. 0 to ${settings.mostRetries}.`}
        >
          <Input
            id="step-retries"
            type="number"
            min={0}
            max={settings.mostRetries}
            step={1}
            className="w-20 tabular-nums"
            value={typedRetries ?? String(settings.stepRetries)}
            onChange={(event) => setTypedRetries(event.target.value)}
            disabled={!settings.canEdit}
            required
          />
          {settings.canEdit && typedRetries !== null && (
            <Button type="submit" disabled={savingRetries}>
              {savingRetries ? "Saving" : "Save"}
            </Button>
          )}
        </SettingRow>
      </form>
      {!settings.canEdit && <p className="text-muted-foreground text-sm">{onlyManagers}</p>}
    </SettingsSection>
  );
}

/** What each person hears about, in the Inbox and by email. */
export function NotificationsSettings() {
  return <NotificationsCard />;
}

/** The email service the dashboard sends through. */
export function EmailSettings() {
  return <EmailCard />;
}

/** Slack, where the team can talk to the agent. */
export function SlackSettings() {
  return <SlackCard />;
}

/** Discord, where the team can talk to the agent. */
export function DiscordSettings() {
  return <DiscordCard />;
}

/** Who is on the team and what they may do. */
export function TeamSettings() {
  const settings = useTeamSettings();
  if (!settings) return <SettingsLoading />;
  return <TeamCard canEdit={settings.canEdit} />;
}
