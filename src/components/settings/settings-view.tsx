"use client";

import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
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
import {
  SettingRow,
  SettingsLoading,
  SettingsSection,
  SettingsTabs,
  useTeamSettings,
} from "./settings-shell";
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
    <SettingsTabs
      label="Agent"
      tabs={[
        { id: "rules", label: "Model And Rules" },
        { id: "key", label: "Your Anthropic Key" },
      ]}
    >
      <TabsContent value="rules">
        <AgentCard
          agent={settings.agent}
          models={settings.agentModels}
          mostHouseRules={settings.mostHouseRules}
          canEdit={settings.canEdit}
        />
      </TabsContent>
      <TabsContent value="key">
        <AnthropicKeyCard anthropicKey={settings.anthropicKey} canEdit={settings.canEdit} />
      </TabsContent>
    </SettingsTabs>
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
  const setAiLimit = useMutation(api.teamSettings.setAiLimit);
  const [typedLimit, setTypedLimit] = useState<string | null>(null);
  const [savingLimit, setSavingLimit] = useState(false);
  const savedLimit = settings.aiLimit === null ? "" : settings.aiLimit.toFixed(2);

  async function onSubmitLimit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (typedLimit === null) return;
    const trimmed = typedLimit.trim().replace(/^\$/, "");
    setSavingLimit(true);
    try {
      await setAiLimit({
        organizationId: team.id,
        dollars: trimmed === "" ? null : Number(trimmed),
      });
      setTypedLimit(null);
      toast.success(trimmed === "" ? "No limit for AI" : "Saved");
    } catch (caught) {
      toast.error(errorMessage(caught, "The limit could not be saved. Try again."));
    } finally {
      setSavingLimit(false);
    }
  }

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
      <form onSubmit={onSubmitLimit}>
        <SettingRow
          label="Limit for AI per run"
          htmlFor="ai-limit"
          description={`Best moments, Chapters, B-Roll plans and AI motion plans ask the AI once for each video. A step that could take a run past this stops before asking. Blank for no limit, or $${settings.aiLimitRange.min.toFixed(2)} to $${settings.aiLimitRange.max}.`}
        >
          <div className="relative">
            <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm">
              $
            </span>
            <Input
              id="ai-limit"
              inputMode="decimal"
              className="w-28 pl-6 tabular-nums"
              placeholder="No limit"
              value={typedLimit ?? savedLimit}
              onChange={(event) => setTypedLimit(event.target.value)}
              disabled={!settings.canEdit}
            />
          </div>
          {settings.canEdit && typedLimit !== null && typedLimit.trim() !== savedLimit && (
            <Button type="submit" disabled={savingLimit}>
              {savingLimit ? "Saving" : "Save"}
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
