"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { Inbox, Mail } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { toast } from "sonner";

import { DiscordLogo, MicrosoftTeamsLogo, SlackLogo, TelegramLogo } from "@/components/brand-logos";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { SettingsSection } from "./settings-shell";
import { myTimeZone } from "@/lib/time-zone";

type Kind =
  | "run_failed"
  | "approval_waiting"
  | "approval_timed_out"
  | "mention"
  | "agent_answer"
  | "client_feedback"
  | "ready_for_review"
  | "clip_finished"
  | "footage_problem"
  | "rights_ending";
type ChatApp = "telegram" | "slack" | "discord" | "teams";
type Channel = "bell" | "email" | ChatApp;

/** Each chat app's column: its name and mark. A column shows once the person linked it. */
const CHAT_APPS: Record<ChatApp, { name: string; Logo: ComponentType<SVGProps<SVGSVGElement>> }> = {
  telegram: { name: "Telegram", Logo: TelegramLogo },
  slack: { name: "Slack", Logo: SlackLogo },
  discord: { name: "Discord", Logo: DiscordLogo },
  teams: { name: "Teams", Logo: MicrosoftTeamsLogo },
};

/** "8 AM", "12 PM", in the reader's own way of writing times. */
export function hourLabel(hour: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(2000, 0, 1, hour));
}

/**
 * Each member's own notification settings on this team: for every kind of news, whether
 * it shows in the Inbox, is emailed, and goes to each chat app they linked, and whether
 * emails come as they happen or as one summary a day.
 */
export function NotificationsCard() {
  const team = useActiveTeam();
  const settings = useQuery(api.notifications.get, { organizationId: team.id });
  const set = useMutation(api.notifications.set);
  const setTiming = useMutation(api.notifications.setEmailTiming);

  if (settings === undefined) return <Skeleton className="h-72 rounded-xl" />;

  async function onToggle(kind: Kind, channel: Channel, enabled: boolean) {
    try {
      await set({ organizationId: team.id, kind, channel, enabled });
    } catch (caught) {
      toast.error(errorMessage(caught, "The setting could not be saved. Try again."));
    }
  }

  async function onTiming(emailTiming: "now" | "daily", digestHour?: number) {
    try {
      await setTiming({
        organizationId: team.id,
        emailTiming,
        digestHour,
        timeZone: myTimeZone(),
      });
    } catch (caught) {
      toast.error(errorMessage(caught, "The setting could not be saved. Try again."));
    }
  }

  const daily = settings.emailTiming === "daily";
  const apps = (settings.chatApps ?? []) as ChatApp[];
  const columns = `1fr repeat(${2 + apps.length}, 3.5rem)`;
  const anyEmail = settings.kinds.some((entry) => entry.email);

  return (
    <SettingsSection id="notifications" className="gap-6">
      <div role="table" aria-label="What you hear about" className="flex flex-col">
        <div
          role="row"
          className="text-muted-foreground grid items-end gap-2 pb-2 text-xs font-medium"
          style={{ gridTemplateColumns: columns }}
        >
          <span role="columnheader">When</span>
          <span role="columnheader" className="flex flex-col items-center gap-1">
            <Inbox className="size-4" aria-hidden="true" />
            Inbox
          </span>
          <span role="columnheader" className="flex flex-col items-center gap-1">
            <Mail className="size-4" aria-hidden="true" />
            Email
          </span>
          {apps.map((app) => {
            const { name, Logo } = CHAT_APPS[app];
            return (
              <span
                key={app}
                role="columnheader"
                className="flex flex-col items-center gap-1"
                data-chat-app={app}
              >
                <Logo className="size-4" />
                {name}
              </span>
            );
          })}
        </div>
        {settings.kinds.map((entry) => (
          <div
            role="row"
            key={entry.kind}
            data-notification={entry.kind}
            className="grid items-center gap-2 py-2.5"
            style={{ gridTemplateColumns: columns }}
          >
            <span role="cell" className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">{entry.title}</span>
              <span className="text-muted-foreground text-xs">
                {entry.description}
                {daily && entry.email && entry.alwaysRightAway
                  ? " Emailed straight away even with a daily summary, because it has a deadline."
                  : ""}
              </span>
            </span>
            <span role="cell" className="flex justify-center">
              <Switch
                checked={entry.bell}
                onCheckedChange={(enabled) => onToggle(entry.kind, "bell", enabled)}
                aria-label={`${entry.title}: in the Inbox`}
              />
            </span>
            <span role="cell" className="flex justify-center">
              <Switch
                checked={entry.email}
                onCheckedChange={(enabled) => onToggle(entry.kind, "email", enabled)}
                aria-label={`${entry.title}: by email`}
              />
            </span>
            {apps.map((app) => (
              <span key={app} role="cell" className="flex justify-center">
                <Switch
                  checked={entry[app]}
                  onCheckedChange={(enabled) => onToggle(entry.kind, app, enabled)}
                  aria-label={`${entry.title}: in ${CHAT_APPS[app].name}`}
                />
              </span>
            ))}
          </div>
        ))}
      </div>

      <fieldset
        className={cn("flex flex-col gap-3 pt-4", !anyEmail && "opacity-60")}
        disabled={!anyEmail}
      >
        <legend className="sr-only">When emails come</legend>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="daily-summary" className="text-sm font-medium">
              One summary email a day
            </label>
            <p className="text-muted-foreground text-sm">
              {daily
                ? "Everything you get by email arrives together, once a day, instead of one email each time."
                : "Off: each email arrives as it happens. Turn on to get them together once a day."}
            </p>
          </div>
          <Switch
            id="daily-summary"
            checked={daily}
            onCheckedChange={(enabled) => onTiming(enabled ? "daily" : "now")}
            aria-label="One summary email a day"
          />
        </div>
        {daily && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="digest-hour">Send it at</label>
            <Select
              value={String(settings.digestHour)}
              onValueChange={(value) => onTiming("daily", Number(value))}
            >
              <SelectTrigger id="digest-hour" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, hour) => (
                  <SelectItem key={hour} value={String(hour)}>
                    {hourLabel(hour)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground">
              your time{settings.timeZone ? ` (${settings.timeZone.replace(/_/g, " ")})` : ""}.
            </span>
          </div>
        )}
        {settings.emailProblem && (
          <p className="text-sm" data-email-problem={settings.emailProblem.kind}>
            {settings.emailProblem.kind === "complaint"
              ? `An email to ${settings.emailProblem.email} was marked as spam, so that address gets no more emails from us for now. To get them somewhere else, change your address in Account settings.`
              : `Emails to ${settings.emailProblem.email} bounce: that mailbox doesn't seem to exist, so we stopped emailing it. Change your address in Account settings.`}
          </p>
        )}
        {!settings.emailReady && (
          <p className="text-muted-foreground text-sm">
            Email is not set up for this dashboard yet, so nothing is emailed until it is. Your
            choices are kept for then.
          </p>
        )}
      </fieldset>
    </SettingsSection>
  );
}
