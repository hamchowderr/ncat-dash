"use client";

import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { AgentCard } from "./agent-card";
import { BrandCard } from "./brand-card";
import { EditorsCard } from "./editors-card";
import { EmailCard } from "./email-card";
import { NotificationsCard } from "./notifications-card";
import { SettingsLoading, useTeamSettings } from "./settings-shell";
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
    <AgentCard
      agent={settings.agent}
      models={settings.agentModels}
      mostHouseRules={settings.mostHouseRules}
      canEdit={settings.canEdit}
    />
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

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Jobs at once</h2>
          </CardTitle>
          <CardDescription>
            How many jobs this team sends to its toolkit at the same time. The rest wait their turn,
            so one big automation cannot swamp a small server.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="max-parallel">Most jobs at once</FieldLabel>
                <Input
                  id="max-parallel"
                  type="number"
                  min={1}
                  max={settings.mostAllowed}
                  step={1}
                  className="w-28"
                  value={typed ?? String(settings.maxParallelJobs)}
                  onChange={(event) => setTyped(event.target.value)}
                  disabled={!settings.canEdit}
                  required
                />
                <FieldDescription>
                  {settings.canEdit
                    ? `From 1 to ${settings.mostAllowed}. Raise it if your toolkit server has room to spare.`
                    : "Only a team owner or admin can change this."}
                </FieldDescription>
              </Field>
              {settings.canEdit && (
                <Field>
                  <Button type="submit" className="self-start" disabled={pending || typed === null}>
                    {pending ? "Saving" : "Save"}
                  </Button>
                </Field>
              )}
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>When a step fails</h2>
          </CardTitle>
          <CardDescription>
            A step that fails in an automation waits a little and tries again, a bit longer each
            time. If it still fails, the run stops and everyone on the team is told, in their Inbox
            or by email, as each person chose under Notifications.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmitRetries}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="step-retries">Times to try again</FieldLabel>
                <Input
                  id="step-retries"
                  type="number"
                  min={0}
                  max={settings.mostRetries}
                  step={1}
                  className="w-28"
                  value={typedRetries ?? String(settings.stepRetries)}
                  onChange={(event) => setTypedRetries(event.target.value)}
                  disabled={!settings.canEdit}
                  required
                />
                <FieldDescription>
                  {settings.canEdit
                    ? `From 0 to ${settings.mostRetries}. With 0 a step that fails stops the run straight away.`
                    : "Only a team owner or admin can change this."}
                </FieldDescription>
              </Field>
              {settings.canEdit && (
                <Field>
                  <Button
                    type="submit"
                    className="self-start"
                    disabled={savingRetries || typedRetries === null}
                  >
                    {savingRetries ? "Saving" : "Save"}
                  </Button>
                </Field>
              )}
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </>
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

/** Slack and Discord, where the team talks to the agent. */
export function ChatSettings() {
  return (
    <>
      <SlackCard />
      <DiscordCard />
    </>
  );
}

/** Who is on the team and what they may do. */
export function TeamSettings() {
  const settings = useTeamSettings();
  if (!settings) return <SettingsLoading />;
  return <TeamCard canEdit={settings.canEdit} />;
}
