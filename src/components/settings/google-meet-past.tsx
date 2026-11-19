"use client";

import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { errorMessage, formatBytes } from "@/lib/catalog";

type Standing = "new" | "brought" | "duplicate";

type Past = {
  driveFileId: string;
  topic: string;
  startTime: number;
  minutes: number | null;
  size: number;
  standing: Standing;
  sharedBy: string | null;
};

const STANDING_TEXT = { brought: "Brought in", duplicate: "Already in Uploads" } as const;

/** When a meeting took place; the year only when it is not this year. */
export function when(at: number) {
  const thisYear = new Date(at).getFullYear() === new Date().getFullYear();
  return new Date(at).toLocaleString(undefined, {
    ...(thisYear ? {} : { year: "numeric" as const }),
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function plural(count: number, one: string) {
  return `${count.toLocaleString()} ${one}${count === 1 ? "" : "s"}`;
}

/** The recordings grouped by the year they took place, newest year first. */
function byYear(list: Past[]): [number, Past[]][] {
  const groups = new Map<number, Past[]>();
  for (const one of list) {
    const year = new Date(one.startTime).getFullYear();
    groups.set(year, [...(groups.get(year) ?? []), one]);
  }
  return [...groups.entries()];
}

/**
 * Every Meet recording in the person's Drive, found in one go: how many there are, which
 * are already in Uploads, and the rest ticked, ready to bring over with one press. Like a
 * migration screen: look through it all, untick what you do not want, bring the rest.
 */
export function MeetPastRecordings({ organizationId }: { organizationId: string }) {
  const scan = useAction(api.googleMeet.pastRecordings);
  const bringIn = useAction(api.googleMeet.bringIn);
  const [busy, setBusy] = useState<"scan" | "bring" | null>(null);
  const [past, setPast] = useState<Past[] | null>(null);
  const [complete, setComplete] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const fresh = (past ?? []).filter((one) => one.standing === "new");
  const pickedCount = fresh.filter((one) => picked.has(one.driveFileId)).length;

  async function find() {
    setBusy("scan");
    try {
      const found = await scan({ organizationId });
      setPast(found.recordings);
      setComplete(found.complete);
      // Everything not in yet is ticked: one press brings it all over.
      setPicked(
        new Set(
          found.recordings.filter((one) => one.standing === "new").map((one) => one.driveFileId),
        ),
      );
    } catch (caught) {
      toast.error(errorMessage(caught, "Google could not be asked. Try again."));
    } finally {
      setBusy(null);
    }
  }

  function setMany(ids: string[], on: boolean) {
    setPicked((before) => {
      const next = new Set(before);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function bring() {
    const ids = fresh.filter((one) => picked.has(one.driveFileId)).map((one) => one.driveFileId);
    setBusy("bring");
    try {
      const result = await bringIn({ organizationId, driveFileIds: ids });
      const said = [`${plural(result.started, "recording")} on the way to Uploads`];
      if (result.duplicate) said.push(`${result.duplicate.toLocaleString()} already there`);
      if (result.missing) said.push(`${result.missing.toLocaleString()} no longer in Drive`);
      toast.success(said.join(", "));
      // Fresh from Google and the dashboard: what came in, and what was there already.
      await find();
    } catch (caught) {
      toast.error(errorMessage(caught, "That did not work. Try again."));
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Past recordings">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium">Past recordings</p>
          <p className="text-muted-foreground text-sm">
            {past === null
              ? "Finds every Meet recording in your Drive, however old, so you can bring them over at once. Ones already in Uploads are skipped."
              : past.length === 0
                ? "No Meet recordings in your Drive."
                : `${plural(past.length, "recording")} in your Drive. ${
                    fresh.length === 0
                      ? "All of them are in Uploads."
                      : `${fresh.length.toLocaleString()} not in Uploads yet.`
                  }${complete ? "" : " Showing the newest 2,000."}`}
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={find}>
          {busy === "scan" ? "Looking through Drive" : past ? "Look again" : "Find recordings"}
        </Button>
      </div>

      {past !== null && fresh.length > 0 && (
        <div className="bg-muted/50 flex items-center justify-between gap-3 rounded-lg px-3 py-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={
                pickedCount === fresh.length ? true : pickedCount === 0 ? false : "indeterminate"
              }
              onCheckedChange={(on) =>
                setMany(
                  fresh.map((one) => one.driveFileId),
                  on === true,
                )
              }
              aria-label="Pick every recording not in Uploads"
            />
            {pickedCount === fresh.length
              ? `All ${fresh.length.toLocaleString()} picked`
              : `${pickedCount.toLocaleString()} of ${fresh.length.toLocaleString()} picked`}
          </label>
          <Button size="sm" disabled={busy !== null || pickedCount === 0} onClick={bring}>
            {busy === "bring" ? "Bringing over" : `Bring over ${plural(pickedCount, "recording")}`}
          </Button>
        </div>
      )}

      {past !== null &&
        byYear(past).map(([year, list]) => {
          const yearFresh = list.filter((one) => one.standing === "new");
          const yearPicked = yearFresh.filter((one) => picked.has(one.driveFileId)).length;
          return (
            <div key={year} className="flex flex-col gap-2" role="group" aria-label={String(year)}>
              <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
                {yearFresh.length > 0 ? (
                  <Checkbox
                    checked={
                      yearPicked === yearFresh.length
                        ? true
                        : yearPicked === 0
                          ? false
                          : "indeterminate"
                    }
                    onCheckedChange={(on) =>
                      setMany(
                        yearFresh.map((one) => one.driveFileId),
                        on === true,
                      )
                    }
                    aria-label={`Pick every ${year} recording not in Uploads`}
                  />
                ) : null}
                <span>
                  {year} · {plural(list.length, "recording")}
                </span>
              </div>
              <ul className="flex flex-col gap-1.5 text-sm">
                {list.map((meeting) => (
                  <li key={meeting.driveFileId} className="flex items-center gap-2">
                    {meeting.standing === "new" ? (
                      <Checkbox
                        checked={picked.has(meeting.driveFileId)}
                        onCheckedChange={(on) => setMany([meeting.driveFileId], on === true)}
                        aria-label={`Pick ${meeting.topic}, ${when(meeting.startTime)}`}
                      />
                    ) : (
                      <span className="size-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{meeting.topic}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {when(meeting.startTime)}
                        {meeting.minutes ? ` · ${meeting.minutes} min` : ""}
                        {meeting.size ? ` · ${formatBytes(meeting.size)}` : ""}
                        {meeting.sharedBy ? ` · shared by ${meeting.sharedBy}` : ""}
                      </span>
                    </span>
                    {meeting.standing !== "new" && (
                      <span className="text-muted-foreground shrink-0">
                        {STANDING_TEXT[meeting.standing]}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
    </section>
  );
}
