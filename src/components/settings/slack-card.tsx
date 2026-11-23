"use client";

import { api } from "@convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { Check, Copy, ExternalLink, Lock } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { createSlackAppUrl, slackManifest } from "@/lib/slack-manifest";
import { useActiveTeam } from "@/lib/team-context";

import { SettingsSection } from "./settings-shell";

function origin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

/** Slack has to reach the dashboard, which it cannot do on this computer's own address. */
function isPrivate(address: string): boolean {
  try {
    const host = new URL(address).hostname;
    return (
      host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")
    );
  } catch {
    return false;
  }
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1.75rem_1fr] gap-x-3 gap-y-1">
      <span
        aria-hidden="true"
        className="bg-muted text-muted-foreground flex size-7 items-center justify-center rounded-full text-xs font-medium"
      >
        {n}
      </span>
      <p className="self-center text-sm font-medium">{title}</p>
      <div className="col-start-2 flex flex-col gap-2 text-sm">{children}</div>
    </li>
  );
}

const NONE = "none";

type Channel = { id: string; name: string; private: boolean };

/**
 * Where review activity goes in Slack: new reviews, client feedback and mentions, each
 * comment thread as a Slack thread whose replies come back to the review.
 */
function ReviewAlerts({
  channel,
  canEdit,
}: {
  channel: { id: string; name: string } | null;
  canEdit: boolean;
}) {
  const team = useActiveTeam();
  const listChannels = useAction(api.slackReview.channels);
  const setAlertChannel = useAction(api.slackReview.setAlertChannel);
  const [channels, setChannels] = useState<Channel[] | null | "failed">(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!canEdit) return;
    let live = true;
    listChannels({ organizationId: team.id })
      .then((found) => live && setChannels(found ?? "failed"))
      .catch(() => live && setChannels("failed"));
    return () => {
      live = false;
    };
  }, [canEdit, listChannels, team.id]);

  async function onPick(value: string) {
    setProblem(null);
    setSaving(true);
    try {
      const result = await setAlertChannel({
        organizationId: team.id,
        channelId: value === NONE ? null : value,
      });
      if (result.ok) {
        toast.success(
          value === NONE
            ? "Review activity stays in the dashboard"
            : "Review activity goes to Slack",
        );
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
          ? `New reviews, client feedback and mentions are posted to #${channel.name}. Replies in a review's Slack thread come back to the review.`
          : "Review activity is not posted to Slack."}
      </p>
    );
  }

  const listed = Array.isArray(channels) ? channels : [];
  // The saved channel stays pickable even before Slack's list arrives.
  const options =
    channel && !listed.some((one) => one.id === channel.id)
      ? [{ id: channel.id, name: channel.name, private: false }, ...listed]
      : listed;

  return (
    <Field>
      <FieldLabel htmlFor="slack-review-channel">Review activity</FieldLabel>
      <Select
        value={channel?.id ?? NONE}
        onValueChange={onPick}
        disabled={saving || channels === null}
      >
        <SelectTrigger id="slack-review-channel" className="w-64">
          <SelectValue placeholder={channels === null ? "Loading channels" : undefined} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Not posted</SelectItem>
          {options.map((one) => (
            <SelectItem key={one.id} value={one.id}>
              {one.private ? (
                <>
                  <Lock aria-hidden="true" />
                  <span className="sr-only">Private </span>
                </>
              ) : (
                "#"
              )}
              {one.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        {channels === "failed"
          ? "Slack did not list the channels. Try again in a minute."
          : "New reviews, client feedback and mentions are posted here. Replies in a review's Slack thread come back to the review. For a private channel, invite the app to it first."}
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
 * The team's own Slack app, so people can tag the agent in Slack. It is a regular app
 * the team owns, made in one click from a filled-in manifest: no outside service, and
 * nothing to pay for.
 */
export function SlackCard() {
  const team = useActiveTeam();
  const slack = useQuery(api.slack.forTeam, { organizationId: team.id });
  const connect = useAction(api.slack.connect);
  const disconnect = useMutation(api.slack.disconnect);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (slack === undefined) return <Skeleton className="h-48 rounded-xl" />;
  if (slack === null) return null;

  const here = origin();
  const showForm = slack.canEdit && (editing || !slack.connected);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setProblem(null);
    setBusy("save");
    try {
      const result = await connect({
        organizationId: team.id,
        botToken: String(form.get("botToken") ?? ""),
        signingSecret: String(form.get("signingSecret") ?? ""),
      });
      if (result.ok) {
        setEditing(false);
        toast.success("Slack is connected");
      } else setProblem(result.detail);
    } catch (caught) {
      setProblem(errorMessage(caught, "That could not be checked. Try again in a moment."));
    } finally {
      setBusy(null);
    }
  }

  async function onRemove() {
    setBusy("remove");
    try {
      await disconnect({ organizationId: team.id });
      setEditing(false);
      toast.success("Slack is disconnected");
    } catch (caught) {
      toast.error(errorMessage(caught, "That could not be disconnected. Try again."));
    } finally {
      setBusy(null);
    }
  }

  async function copyManifest() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(slackManifest(here), null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("The browser did not allow copying.");
    }
  }

  return (
    <SettingsSection data-slack-card className="gap-6">
      {slack.connected && !showForm && (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Workspace</dt>
            <dd>{slack.slackTeamName}</dd>
            <dt className="text-muted-foreground">Connected</dt>
            <dd>
              {new Date(slack.connectedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
              {slack.connectedBy ? ` by ${slack.connectedBy}` : ""}
            </dd>
          </dl>
          <p className="text-muted-foreground text-sm">
            The agent knows people by the email address on their Slack profile, and does only what
            they could do here. Someone not on the team gets a note saying so.
          </p>
          <ReviewAlerts channel={slack.alertChannel} canEdit={slack.canEdit} />
          {slack.canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setEditing(true)} disabled={busy !== null}>
                Change
              </Button>
              <Button variant="ghost" onClick={onRemove} disabled={busy !== null}>
                {busy === "remove" ? "Disconnecting" : "Disconnect"}
              </Button>
            </div>
          )}
        </div>
      )}

      {!slack.connected && !slack.canEdit && (
        <p className="text-muted-foreground text-sm">
          Slack is not connected yet. A team owner or admin can connect it here.
        </p>
      )}

      {showForm && (
        <div className="flex flex-col gap-5">
          {isPrivate(here) && (
            <Alert>
              <AlertTitle>Slack can&apos;t reach this address</AlertTitle>
              <AlertDescription>
                You opened the dashboard at {here}, which only works on this computer. Open it at
                its public address before you make the app, so Slack knows where to send messages.
              </AlertDescription>
            </Alert>
          )}
          <ol className="flex flex-col gap-4">
            <Step n={1} title="Make the app">
              <p className="text-muted-foreground">
                Slack opens with everything filled in. Pick your workspace and press Create.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a href={createSlackAppUrl(here)} target="_blank" rel="noreferrer">
                    <ExternalLink />
                    Create the Slack app
                  </a>
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={copyManifest}>
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Copied" : "Copy the manifest"}
                </Button>
              </div>
            </Step>
            <Step n={2} title="Install it to your workspace">
              <p className="text-muted-foreground">
                In the app, open Install App and press Install to Workspace.
              </p>
            </Step>
            <Step n={3} title="Paste two values here">
              <form onSubmit={onSubmit} aria-label="Connect Slack">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="slack-bot-token">Bot User OAuth Token</FieldLabel>
                    <Input
                      id="slack-bot-token"
                      name="botToken"
                      type="password"
                      autoComplete="off"
                      placeholder="xoxb-"
                      required
                    />
                    <FieldDescription>
                      Under OAuth & Permissions. It starts with xoxb-.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="slack-signing-secret">Signing Secret</FieldLabel>
                    <Input
                      id="slack-signing-secret"
                      name="signingSecret"
                      type="password"
                      autoComplete="off"
                      required
                    />
                    <FieldDescription>
                      Under Basic Information, in App Credentials.
                    </FieldDescription>
                  </Field>
                  {problem && (
                    <Alert variant="destructive">
                      <AlertTitle>Slack is not connected</AlertTitle>
                      <AlertDescription>{problem}</AlertDescription>
                    </Alert>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={busy !== null}>
                      {busy === "save" ? "Checking" : "Connect Slack"}
                    </Button>
                    {slack.connected && (
                      <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </FieldGroup>
              </form>
            </Step>
          </ol>
        </div>
      )}
    </SettingsSection>
  );
}
