"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { SettingsSection } from "./settings-shell";

type Creator = {
  id: Id<"creatorRights">;
  creator: string;
  endsOn: string;
  note: string;
  alerted: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today on the viewer's own calendar, as "YYYY-MM-DD". */
export function localToday(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** How a creator's end date reads next to their name, and whether it is close. */
export function rightsStatus(
  endsOn: string,
  today: string,
): { label: string; tone: "ended" | "soon" | "later" } {
  const left = Math.round(
    (Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS,
  );
  const day = new Date(`${endsOn}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  if (left < 0) return { label: `Ended ${day}`, tone: "ended" };
  if (left === 0) return { label: `Last day today, ${day}`, tone: "soon" };
  if (left === 1) return { label: `Last day tomorrow, ${day}`, tone: "soon" };
  return { label: `Last day ${day}, in ${left} days`, tone: left <= 7 ? "soon" : "later" };
}

/** The boxes to add a creator, or to change one. */
function CreatorForm({
  start,
  seen,
  onDone,
}: {
  start?: Creator;
  seen: string[];
  onDone?: () => void;
}) {
  const team = useActiveTeam();
  const save = useMutation(api.creatorRights.save);
  const [creator, setCreator] = useState(start?.creator ?? "");
  const [endsOn, setEndsOn] = useState(start?.endsOn ?? "");
  const [note, setNote] = useState(start?.note ?? "");
  const [busy, setBusy] = useState(false);
  const key = start?.id ?? "new";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!creator.trim() || !endsOn) return;
    setBusy(true);
    try {
      await save({
        organizationId: team.id,
        id: start?.id,
        creator,
        endsOn,
        note: note.trim() || undefined,
      });
      toast.success(start ? `${creator.trim()} saved` : `${creator.trim()} added`);
      if (!start) {
        setCreator("");
        setEndsOn("");
        setNote("");
      }
      onDone?.();
    } catch (caught) {
      toast.error(errorMessage(caught, "That could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3"
      aria-label={start ? `Change ${start.creator}` : "Add a creator"}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`creator-name-${key}`} className="text-sm font-medium">
            Creator
          </label>
          <Input
            id={`creator-name-${key}`}
            value={creator}
            onChange={(event) => setCreator(event.target.value)}
            placeholder="As their folder is named"
            list={seen.length ? `creator-seen-${key}` : undefined}
            autoComplete="off"
          />
          {seen.length > 0 && (
            <datalist id={`creator-seen-${key}`}>
              {seen.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`creator-ends-${key}`} className="text-sm font-medium">
            Last day of use
          </label>
          <Input
            id={`creator-ends-${key}`}
            type="date"
            value={endsOn}
            onChange={(event) => setEndsOn(event.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`creator-note-${key}`} className="text-sm font-medium">
          Note <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Input
          id={`creator-note-${key}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Brand, platforms, paid or organic"
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={busy || !creator.trim() || !endsOn}>
          {busy ? "Saving" : start ? "Save" : "Add creator"}
        </Button>
        {onDone && start && (
          <Button size="sm" type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/** One creator: their name, when their rights end, and what was noted. */
function CreatorRow({ row, today, seen }: { row: Creator; today: string; seen: string[] }) {
  const team = useActiveTeam();
  const remove = useMutation(api.creatorRights.remove);
  const [editing, setEditing] = useState(false);
  const status = rightsStatus(row.endsOn, today);

  if (editing) {
    return (
      <li className="bg-muted/40 rounded-lg p-4">
        <CreatorForm start={row} seen={seen} onDone={() => setEditing(false)} />
      </li>
    );
  }

  async function drop() {
    try {
      await remove({ organizationId: team.id, id: row.id });
      toast.success(`${row.creator} removed`);
    } catch (caught) {
      toast.error(errorMessage(caught, "That could not be removed."));
    }
  }

  return (
    <li data-creator={row.creator} className="flex items-start justify-between gap-4 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{row.creator}</span>
        <span
          data-tone={status.tone}
          className={cn(
            "text-sm",
            status.tone === "soon" && "text-amber-700",
            status.tone !== "soon" && "text-muted-foreground",
          )}
        >
          {status.label}
        </span>
        {row.note && <span className="text-muted-foreground text-sm">{row.note}</span>}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Change
        </Button>
        <Button size="sm" variant="ghost" onClick={drop} aria-label={`Remove ${row.creator}`}>
          Remove
        </Button>
      </div>
    </li>
  );
}

/**
 * Settings, Creators: how long the team may use each creator's footage. A week before the
 * last day everyone hears about it, in Inbox, by email and in the chat apps they linked.
 */
export function CreatorsCard({ today = localToday() }: { today?: string }) {
  const team = useActiveTeam();
  const data = useQuery(api.creatorRights.list, { organizationId: team.id });
  if (data === undefined) return <Skeleton className="h-40 rounded-xl" />;

  return (
    <div className="flex flex-col gap-10" data-creators-settings>
      <SettingsSection
        title="Usage rights"
        description="A week before a creator's last day, everyone on the team hears about it in Inbox, by email and in Slack, Discord, Telegram or Teams, as each person set in Notifications."
      >
        {data.creators.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No end dates yet. Add the creators whose footage you use in ads.
          </p>
        ) : (
          <ul className="flex flex-col" aria-label="Creators">
            {data.creators.map((row) => (
              <CreatorRow key={row.id} row={row} today={today} seen={data.seen} />
            ))}
          </ul>
        )}
      </SettingsSection>
      <SettingsSection title="Add a creator">
        <CreatorForm seen={data.seen} />
      </SettingsSection>
    </div>
  );
}
