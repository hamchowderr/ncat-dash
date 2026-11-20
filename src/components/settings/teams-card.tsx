"use client";

import { api } from "@convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { SettingsSection } from "./settings-shell";

/** What Settings says when Microsoft sends someone back, by the result in the address. */
export const TEAMS_RESULTS: Record<string, { ok: boolean; text: string }> = {
  added: { ok: true, text: "Your Microsoft organization is linked" },
  linked: { ok: true, text: "Your Microsoft account is linked" },
  cancelled: { ok: false, text: "Nothing changed: Microsoft was closed before it finished." },
  expired: { ok: false, text: "That took too long. Press the button again." },
  taken: { ok: false, text: "That Microsoft organization is already linked to another team." },
  not_manager: {
    ok: false,
    text: "Only a team owner or admin can link the Microsoft organization.",
  },
  not_member: { ok: false, text: "You are no longer on this team." },
  personal_account: {
    ok: false,
    text: "Sign in with your work or school Microsoft account. Teams bots don't work with personal accounts.",
  },
  not_ready: { ok: false, text: "Microsoft Teams is not set up on this dashboard yet." },
  refused: { ok: false, text: "Microsoft did not finish signing you in. Try again." },
  unreachable: { ok: false, text: "Microsoft could not be reached. Try again in a minute." },
};

const NONE = "none";

function day(at: number) {
  return new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type Channel = { id: string; name: string; teamName: string };

/** Where alerts go in Teams. Owners and admins pick; everyone else sees the choice. */
function AlertChannel({
  canEdit,
  channel,
  teamsSeen,
}: {
  canEdit: boolean;
  channel: { id: string; name: string } | null;
  teamsSeen: string[];
}) {
  const team = useActiveTeam();
  const listChannels = useAction(api.microsoftTeams.channels);
  const setAlertChannel = useAction(api.microsoftTeams.setAlertChannel);
  const [channels, setChannels] = useState<Channel[] | null | "failed">(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const seenKey = teamsSeen.join("|");

  useEffect(() => {
    if (!canEdit) return;
    let live = true;
    listChannels({ organizationId: team.id })
      .then((found) => live && setChannels(found ?? "failed"))
      .catch(() => live && setChannels("failed"));
    return () => {
      live = false;
    };
  }, [canEdit, listChannels, team.id, seenKey]);

  async function onPick(value: string) {
    setProblem(null);
    setSaving(true);
    try {
      const result = await setAlertChannel({
        organizationId: team.id,
        channelId: value === NONE ? null : value,
      });
      if (result.ok) {
        toast.success(value === NONE ? "Alerts stay in the dashboard" : "Alerts go to Teams");
      } else setProblem(result.detail);
    } catch (caught) {
      setProblem(errorMessage(caught, "That could not be saved. Try again."));
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) {
    return (
      <p className="text-muted-foreground text-sm">
        {channel
          ? `Failed runs, approvals, review mentions and client feedback are posted to ${channel.name}.`
          : "Alerts are not posted to Teams."}
      </p>
    );
  }

  const listed = Array.isArray(channels) ? channels : [];
  const options =
    channel && !listed.some((one) => one.id === channel.id)
      ? [{ id: channel.id, name: channel.name, teamName: "" }, ...listed]
      : listed;

  return (
    <Field>
      <FieldLabel htmlFor="teams-alert-channel">Alerts</FieldLabel>
      <Select
        value={channel?.id ?? NONE}
        onValueChange={onPick}
        disabled={saving || channels === null}
      >
        <SelectTrigger id="teams-alert-channel" className="w-72">
          <SelectValue placeholder={channels === null ? "Loading channels" : undefined} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Not posted</SelectItem>
          {options.map((one) => (
            <SelectItem key={one.id} value={one.id}>
              {one.teamName ? `${one.teamName} › ${one.name}` : one.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        {channels === "failed"
          ? "Teams did not list the channels. Try again in a minute."
          : teamsSeen.length === 0
            ? "Once the app is in a team, mention the agent once in any of its channels. That team's channels then show here."
            : "Failed runs, approvals, review mentions and client feedback are posted here."}
      </FieldDescription>
      {problem && (
        <Alert variant="destructive">
          <AlertTitle>That channel was not picked</AlertTitle>
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      )}
    </Field>
  );
}

/**
 * The agent in Microsoft Teams. The dashboard has one Teams bot; a team links its
 * Microsoft organization here and uploads the dashboard's Teams app, and each person is
 * known by their Microsoft account, so the agent does only what they could do here.
 */
export function TeamsCard() {
  const team = useActiveTeam();
  const teams = useQuery(api.microsoftTeams.forTeam, { organizationId: team.id });
  const startLink = useMutation(api.microsoftTeams.startLink);
  const removeOrganization = useMutation(api.microsoftTeams.removeOrganization);
  const unlinkMe = useMutation(api.microsoftTeams.unlinkMe);
  const [busy, setBusy] = useState<string | null>(null);

  // Coming back from Microsoft: say how it went once, then tidy the address.
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("teams");
    if (!result) return;
    const said = TEAMS_RESULTS[result] ?? TEAMS_RESULTS.refused;
    if (said.ok) toast.success(said.text);
    else toast.error(said.text);
    url.searchParams.delete("teams");
    window.history.replaceState(null, "", url.toString());
  }, []);

  if (teams === undefined) return <Skeleton className="h-40 rounded-xl" />;
  if (teams === null) return null;

  async function go(kind: "organization" | "person") {
    setBusy(kind);
    try {
      window.location.assign(await startLink({ organizationId: team.id, kind }));
    } catch (caught) {
      toast.error(errorMessage(caught, "Microsoft could not be opened. Try again."));
      setBusy(null);
    }
  }

  async function run(key: string, work: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await work();
      toast.success(done);
    } catch (caught) {
      toast.error(errorMessage(caught, "That did not work. Try again."));
    } finally {
      setBusy(null);
    }
  }

  if (!teams.ready) {
    return (
      <SettingsSection data-teams-card>
        <p className="text-muted-foreground text-sm">
          Microsoft Teams is not set up on this dashboard yet. Whoever runs the dashboard sets up
          its Teams bot once, then every team can add it here.
        </p>
      </SettingsSection>
    );
  }

  const organization = teams.organization;

  return (
    <SettingsSection data-teams-card className="gap-8">
      <section className="flex flex-col gap-3" aria-label="Your Microsoft organization">
        <p className="text-sm font-medium">Your Microsoft organization</p>
        {organization ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="font-medium">{organization.name}</span>
              <span className="text-muted-foreground">
                {" "}
                · linked {day(organization.addedAt)}
                {organization.addedBy ? ` by ${organization.addedBy}` : ""}
              </span>
            </span>
            {teams.canEdit && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() =>
                  run(
                    "remove",
                    () => removeOrganization({ organizationId: team.id }),
                    "The agent no longer answers in your Teams",
                  )
                }
              >
                Remove
              </Button>
            )}
          </div>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              {teams.canEdit
                ? "Sign in with your work Microsoft account. That links your organization's Teams to this team."
                : "The agent is not in your Teams yet. A team owner or admin can link your Microsoft organization here."}
            </p>
            {teams.canEdit && (
              <div>
                <Button size="sm" disabled={busy !== null} onClick={() => go("organization")}>
                  {busy === "organization" ? "Opening Microsoft" : "Link Microsoft organization"}
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      {organization && (
        <section className="flex flex-col gap-3" aria-label="Add the app to Teams">
          <p className="text-sm font-medium">Add the app to Teams</p>
          <ol className="text-muted-foreground flex list-decimal flex-col gap-1 pl-5 text-sm">
            <li>Download the app below.</li>
            <li>
              In Teams, open Apps, then Manage your apps, then Upload an app, and pick the file.
              Your Teams admin may need to allow it first.
            </li>
            <li>Add it to the teams and chats where you want the agent, or message it directly.</li>
          </ol>
          <div>
            <Button size="sm" variant="outline" asChild>
              <a href={teams.appPackageUrl} download>
                <Download aria-hidden="true" />
                Download the Teams app
              </a>
            </Button>
          </div>
        </section>
      )}

      {organization && (
        <section className="flex flex-col gap-3" aria-label="Alerts in Teams">
          <AlertChannel
            canEdit={teams.canEdit}
            channel={organization.alertChannel}
            teamsSeen={teams.teamsSeen}
          />
        </section>
      )}

      <section className="flex flex-col gap-2" aria-label="Your Microsoft account">
        <p className="text-sm font-medium">Your Microsoft account</p>
        {teams.me ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>
              {teams.me.via === "microsoft" ? "Known from Microsoft 365 as " : "Linked as "}
              <span className="font-medium">{teams.me.name}</span>
              <span className="text-muted-foreground"> · {day(teams.me.linkedAt)}</span>
            </span>
            {teams.me.via === "teams" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() =>
                  run(
                    "unlink",
                    () => unlinkMe({ organizationId: team.id }),
                    "Your Microsoft account is unlinked",
                  )
                }
              >
                Unlink
              </Button>
            )}
          </div>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              Link your Microsoft account once. The agent then knows it&apos;s you in Teams and does
              only what you could do here.
            </p>
            <div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => go("person")}
              >
                {busy === "person" ? "Opening Microsoft" : "Link my Microsoft account"}
              </Button>
            </div>
          </>
        )}
        <p className="text-muted-foreground text-sm">
          {teams.linkedCount === 1
            ? "1 person on the team is known in Teams."
            : `${teams.linkedCount} people on the team are known in Teams.`}
        </p>
      </section>
    </SettingsSection>
  );
}
