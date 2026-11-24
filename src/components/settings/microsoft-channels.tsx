"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

type Watched = {
  _id: Id<"microsoftChannels">;
  teamName: string;
  channelName: string;
  since: number;
};

type Listed = { teamId: string; teamName: string; channels: { id: string; name: string }[] };

function day(at: number) {
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Channel meetings: Teams saves the recording of a meeting held in a channel to that
 * channel's files, not anyone's OneDrive. The member picks the channels to bring in.
 */
export function ChannelMeetings({
  granted,
  watched,
  onAllow,
  opening,
}: {
  granted: boolean;
  watched: Watched[];
  onAllow: () => void;
  opening: boolean;
}) {
  const team = useActiveTeam();
  const listChannels = useAction(api.microsoft.teamChannels);
  const watchChannel = useAction(api.microsoft.watchChannel);
  const unwatchChannel = useMutation(api.microsoft.unwatchChannel);
  const [listed, setListed] = useState<Listed[] | null | "failed">(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!granted) return;
    let live = true;
    listChannels({ organizationId: team.id })
      .then((found) => live && setListed(found))
      .catch(() => live && setListed("failed"));
    return () => {
      live = false;
    };
  }, [granted, listChannels, team.id]);

  if (!granted) {
    return (
      <>
        <p className="text-muted-foreground text-sm">
          Meetings held in a Teams channel are saved to the channel&apos;s files, not your OneDrive.
          Pick the channels whose recordings should come into the Library. The first time, Microsoft
          asks you to allow reading your teams and their files.
        </p>
        <div>
          <Button size="sm" variant="outline" disabled={opening} onClick={onAllow}>
            {opening ? "Opening Microsoft" : "Choose channels"}
          </Button>
        </div>
      </>
    );
  }

  const all = Array.isArray(listed)
    ? listed.flatMap((one) =>
        one.channels.map((channel) => ({ ...channel, teamId: one.teamId, teamName: one.teamName })),
      )
    : [];
  const picked = new Set(watched.map((one) => `${one.teamName} › ${one.channelName}`));
  const choices = all.filter((one) => !picked.has(`${one.teamName} › ${one.name}`));

  async function onPick(value: string) {
    const choice = all.find((one) => `${one.teamId}|${one.id}` === value);
    if (!choice) return;
    setBusy("add");
    try {
      const result = await watchChannel({
        organizationId: team.id,
        teamId: choice.teamId,
        teamName: choice.teamName,
        channelId: choice.id,
        channelName: choice.name,
      });
      if (result.ok) toast.success(`Recordings from ${choice.name} now come in`);
      else toast.error(result.detail);
    } catch (caught) {
      toast.error(errorMessage(caught, "That channel was not added. Try again."));
    } finally {
      setBusy(null);
    }
  }

  async function onStop(one: Watched) {
    setBusy(one._id);
    try {
      await unwatchChannel({ organizationId: team.id, channelRowId: one._id });
      toast.success(`Recordings from ${one.channelName} no longer come in`);
    } catch (caught) {
      toast.error(errorMessage(caught, "That did not work. Try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {watched.length > 0 && (
        <ul className="flex flex-col gap-2 text-sm">
          {watched.map((one) => (
            <li key={one._id} className="flex items-center justify-between gap-3">
              <span>
                <span className="font-medium">
                  {one.teamName} › {one.channelName}
                </span>
                <span className="text-muted-foreground"> · since {day(one.since)}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => onStop(one)}
              >
                Stop
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Field>
        <FieldLabel htmlFor="microsoft-channel-add">Add a channel</FieldLabel>
        <Select value="" onValueChange={onPick} disabled={busy !== null || listed === null}>
          <SelectTrigger id="microsoft-channel-add" className="w-72">
            <SelectValue placeholder={listed === null ? "Loading channels" : "Pick a channel"} />
          </SelectTrigger>
          <SelectContent>
            {choices.map((one) => (
              <SelectItem key={`${one.teamId}|${one.id}`} value={`${one.teamId}|${one.id}`}>
                {one.teamName} › {one.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          {listed === "failed"
            ? "Microsoft did not list your teams. Try again in a minute."
            : Array.isArray(listed) && all.length === 0
              ? "You are not in any Teams team yet."
              : "Recordings of meetings held there from now on come into the Library within 15 minutes of the meeting ending."}
        </FieldDescription>
      </Field>
    </>
  );
}
