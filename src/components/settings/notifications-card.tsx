"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { Inbox, Mail } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

type Kind =
  "run_failed" | "approval_waiting" | "approval_timed_out" | "mention" | "client_feedback";
type Channel = "bell" | "email";

/** "8 AM", "12 PM", in the reader's own way of writing times. */
export function hourLabel(hour: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(2000, 0, 1, hour));
}

/** The browser's time zone, such as "America/Los_Angeles". */
function browserZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Each member's own notification settings on this team: for every kind of news, whether
 * it shows in the Inbox and whether it is emailed, and whether emails come as they
 * happen or as one summary a day.
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
        timeZone: browserZone(),
      });
    } catch (caught) {
      toast.error(errorMessage(caught, "The setting could not be saved. Try again."));
    }
  }

  const daily = settings.emailTiming === "daily";
  const anyEmail = settings.kinds.some((entry) => entry.email);

  return (
    <Card className="scroll-mt-20" id="notifications">
      <CardHeader>
        <CardTitle>
          <h2>Notifications</h2>
        </CardTitle>
        <CardDescription>
          What you hear about on {team.name}, and how. Only for you: everyone on the team picks
          their own.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div role="table" aria-label="What you hear about" className="flex flex-col">
          <div
            role="row"
            className="text-muted-foreground grid grid-cols-[1fr_3.5rem_3.5rem] items-end gap-2 pb-2 text-xs font-medium"
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
          </div>
          {settings.kinds.map((entry) => (
            <div
              role="row"
              key={entry.kind}
              data-notification={entry.kind}
              className="grid grid-cols-[1fr_3.5rem_3.5rem] items-center gap-2 py-2.5"
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
          {!settings.emailReady && (
            <p className="text-muted-foreground text-sm">
              Email is not set up for this dashboard yet, so nothing is emailed until it is. Your
              choices are kept for then.
            </p>
          )}
        </fieldset>
      </CardContent>
    </Card>
  );
}
