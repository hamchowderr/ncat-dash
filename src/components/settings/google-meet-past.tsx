"use client";

import { api } from "@convex/_generated/api";
import { useAction, useMutation } from "convex/react";
import { ChevronRight, ExternalLink, Search, Video } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

type Whose = "all" | "mine" | "shared";

const STANDING_TEXT = { brought: "Brought in", duplicate: "Already in Uploads" } as const;

/** Recordings shorter than this start unticked: they are nearly always false starts. */
export const SHORT_MINUTES = 5;

/** A recording's file in Google Drive; add "/view" to open it, "/preview" to play it here. */
function driveFile(id: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(id)}`;
}

/** How many pictures are asked for at once. */
const PICTURES_AT_ONCE = 24;

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

/** A recording Meet saved under its meeting code, because the call had no title. */
function isCode(topic: string) {
  return /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(topic);
}

function isShort(one: Past) {
  return one.minutes !== null && one.minutes < SHORT_MINUTES;
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
 * Each row has Drive's picture of the video, which opens it to watch; meetings with no
 * title are named from the person's calendar; recordings someone shared say who.
 */
export function MeetPastRecordings({ organizationId }: { organizationId: string }) {
  const scan = useAction(api.googleMeet.pastRecordings);
  const bringIn = useAction(api.googleMeet.bringIn);
  const fetchPictures = useAction(api.googleMeet.thumbnails);
  const startLink = useMutation(api.googleMeet.startLink);
  const [busy, setBusy] = useState<"scan" | "bring" | "connect" | null>(null);
  const [past, setPast] = useState<Past[] | null>(null);
  const [complete, setComplete] = useState(true);
  const [names, setNames] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [whose, setWhose] = useState<Whose>("all");
  const [openYears, setOpenYears] = useState<Set<number>>(new Set());
  const [pictures, setPictures] = useState<Map<string, string | null>>(new Map());
  const [watching, setWatching] = useState<Past | null>(null);
  const asked = useRef<Set<string>>(new Set());

  const all = useMemo(() => past ?? [], [past]);
  const sharedCount = all.filter((one) => one.sharedBy).length;
  const fresh = all.filter((one) => one.standing === "new");
  const pickedCount = fresh.filter((one) => picked.has(one.driveFileId)).length;
  const words = search.trim().toLowerCase();
  const filtering = words !== "" || whose !== "all";
  const shown = useMemo(
    () =>
      all.filter((one) => {
        if (whose === "mine" && one.sharedBy) return false;
        if (whose === "shared" && !one.sharedBy) return false;
        if (!words) return true;
        return `${one.topic} ${one.sharedBy ?? ""}`.toLowerCase().includes(words);
      }),
    [all, whose, words],
  );
  const shownFresh = shown.filter((one) => one.standing === "new");
  const shownPicked = shownFresh.filter((one) => picked.has(one.driveFileId)).length;
  const groups = byYear(shown);
  const isOpen = (year: number) => filtering || openYears.has(year);
  const unnamed = all.some((one) => isCode(one.topic));
  const shortLeft = fresh.some(isShort);

  // Drive's pictures, for the rows that are showing, a few at a time.
  const showingKey = groups
    .filter(([year]) => isOpen(year))
    .flatMap(([, list]) => list.map((one) => one.driveFileId))
    .join(",");
  useEffect(() => {
    const ids = showingKey.split(",").filter((id) => id && !asked.current.has(id));
    if (ids.length === 0) return;
    for (const id of ids) asked.current.add(id);
    void (async () => {
      for (let at = 0; at < ids.length; at += PICTURES_AT_ONCE) {
        const part = ids.slice(at, at + PICTURES_AT_ONCE);
        try {
          const found = await fetchPictures({ organizationId, driveFileIds: part });
          const got = new Map(found.map((one) => [one.driveFileId, one.picture] as const));
          setPictures((before) => new Map([...before, ...got]));
        } catch {
          // Pictures are a nicety: the list works without them. Ask again next time.
          for (const id of part) asked.current.delete(id);
        }
      }
    })();
  }, [showingKey, fetchPictures, organizationId]);

  async function find() {
    setBusy("scan");
    try {
      const found = await scan({ organizationId });
      setPast(found.recordings);
      setComplete(found.complete);
      setNames(found.names);
      // Everything not in yet is ticked, so one press brings it all over; very short
      // recordings are left out, as they are nearly always false starts.
      setPicked(
        new Set(
          found.recordings
            .filter((one) => one.standing === "new" && !isShort(one))
            .map((one) => one.driveFileId),
        ),
      );
      const newest = found.recordings[0];
      setOpenYears((before) =>
        before.size > 0 || !newest ? before : new Set([new Date(newest.startTime).getFullYear()]),
      );
    } catch (caught) {
      toast.error(errorMessage(caught, "Google could not be asked. Try again."));
    } finally {
      setBusy(null);
    }
  }

  async function connectAgain() {
    setBusy("connect");
    try {
      window.location.assign(await startLink({ organizationId }));
    } catch (caught) {
      toast.error(errorMessage(caught, "Google could not be opened. Try again."));
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

  function toggleYear(year: number) {
    setOpenYears((before) => {
      const next = new Set(before);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }

  async function bring() {
    const ids = fresh.filter((one) => picked.has(one.driveFileId)).map((one) => one.driveFileId);
    setBusy("bring");
    try {
      const result = await bringIn({ organizationId, driveFileIds: ids });
      // Ones the team was already bringing in (the watcher can take them first) are on their way too.
      const said = [
        `${plural(result.started + result.already, "recording")} on the way to Uploads`,
      ];
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
                : `${plural(past.length, "recording")} in your Drive${
                    sharedCount ? `, ${sharedCount.toLocaleString()} shared with you` : ""
                  }. ${
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

      {past !== null && !names && unnamed && (
        <div className="bg-muted/50 flex items-center justify-between gap-3 rounded-lg px-3 py-2">
          <p className="text-muted-foreground text-sm">
            Meetings with no title show Google&apos;s meeting code. Connect Google again to name
            them from your calendar.
          </p>
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={connectAgain}>
            Use calendar names
          </Button>
        </div>
      )}

      {past !== null && past.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-48 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search recordings"
              aria-label="Search recordings"
              className="pl-8"
            />
          </div>
          {sharedCount > 0 && (
            <Tabs value={whose} onValueChange={(value) => setWhose(value as Whose)}>
              <TabsList aria-label="Whose recordings">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="mine">Yours</TabsTrigger>
                <TabsTrigger value="shared">Shared with you</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>
      )}

      {past !== null && fresh.length > 0 && (
        <div className="bg-muted/50 flex items-center justify-between gap-3 rounded-lg px-3 py-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={
                shownFresh.length === 0
                  ? false
                  : shownPicked === shownFresh.length
                    ? true
                    : shownPicked === 0
                      ? false
                      : "indeterminate"
              }
              disabled={shownFresh.length === 0}
              onCheckedChange={(on) =>
                setMany(
                  shownFresh.map((one) => one.driveFileId),
                  on === true,
                )
              }
              aria-label={
                filtering
                  ? "Pick every recording shown that is not in Uploads"
                  : "Pick every recording not in Uploads"
              }
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

      {past !== null && shortLeft && (
        <p className="text-muted-foreground -mt-2 text-xs">
          Recordings under {SHORT_MINUTES} minutes start unticked, as they are usually false starts.
        </p>
      )}

      {past !== null && past.length > 0 && shown.length === 0 && (
        <p className="text-muted-foreground text-sm">No recordings match.</p>
      )}

      {groups.map(([year, list]) => {
        const yearFresh = list.filter((one) => one.standing === "new");
        const yearPicked = yearFresh.filter((one) => picked.has(one.driveFileId)).length;
        const open = isOpen(year);
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
              ) : (
                <span className="size-4 shrink-0" />
              )}
              <button
                type="button"
                className="hover:text-foreground flex items-center gap-1 outline-none focus-visible:underline"
                aria-expanded={open}
                onClick={() => toggleYear(year)}
                disabled={filtering}
              >
                <span>
                  {year} · {plural(list.length, "recording")}
                  {!open && yearFresh.length > 0 ? ` · ${yearPicked.toLocaleString()} picked` : ""}
                </span>
                {!filtering && (
                  <ChevronRight
                    className={`size-3.5 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
                  />
                )}
              </button>
            </div>
            {open && (
              <ul className="flex flex-col gap-1.5 text-sm">
                {list.map((meeting) => {
                  const picture = pictures.get(meeting.driveFileId);
                  return (
                    <li key={meeting.driveFileId} className="flex items-center gap-3">
                      {meeting.standing === "new" ? (
                        <Checkbox
                          checked={picked.has(meeting.driveFileId)}
                          onCheckedChange={(on) => setMany([meeting.driveFileId], on === true)}
                          aria-label={`Pick ${meeting.topic}, ${when(meeting.startTime)}`}
                        />
                      ) : (
                        <span className="size-4 shrink-0" />
                      )}
                      <button
                        type="button"
                        className="bg-muted focus-visible:ring-ring/50 relative flex aspect-video w-16 shrink-0 items-center justify-center overflow-hidden rounded-md outline-none focus-visible:ring-3"
                        aria-label={`Watch ${meeting.topic}, ${when(meeting.startTime)}`}
                        onClick={() => setWatching(meeting)}
                      >
                        {picture ? (
                          // eslint-disable-next-line @next/next/no-img-element -- a data address from Drive
                          <img src={picture} alt="" className="size-full object-cover" />
                        ) : (
                          <Video className="text-muted-foreground size-4" />
                        )}
                      </button>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex min-w-0 items-center gap-2">
                          {meeting.sharedBy && (
                            <Badge variant="secondary" className="shrink-0">
                              Shared with you
                            </Badge>
                          )}
                          <span className="truncate font-medium">{meeting.topic}</span>
                        </span>
                        <span className="text-muted-foreground truncate text-xs">
                          {when(meeting.startTime)}
                          {meeting.minutes ? ` · ${meeting.minutes} min` : ""}
                          {meeting.size ? ` · ${formatBytes(meeting.size)}` : ""}
                          {meeting.sharedBy ? ` · from ${meeting.sharedBy}` : ""}
                        </span>
                      </span>
                      {meeting.standing !== "new" && (
                        <span className="text-muted-foreground shrink-0">
                          {STANDING_TEXT[meeting.standing]}
                        </span>
                      )}
                      <a
                        href={`${driveFile(meeting.driveFileId)}/view`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 shrink-0 rounded-md p-1 outline-none focus-visible:ring-3"
                        aria-label={`Open ${meeting.topic}, ${when(meeting.startTime)}, in Google Drive`}
                        title="Open in Google Drive"
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}

      <Dialog open={watching !== null} onOpenChange={(open) => !open && setWatching(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{watching?.topic}</DialogTitle>
            <DialogDescription>
              {watching ? when(watching.startTime) : ""}
              {watching?.sharedBy ? ` · shared by ${watching.sharedBy}` : ""}. Plays from your
              Google Drive.{" "}
              {watching && (
                <a
                  href={`${driveFile(watching.driveFileId)}/view`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline underline-offset-4"
                >
                  Open in Google Drive
                </a>
              )}
            </DialogDescription>
          </DialogHeader>
          {watching && (
            <iframe
              src={`${driveFile(watching.driveFileId)}/preview`}
              title={`${watching.topic} recording`}
              allow="autoplay; fullscreen"
              className="bg-muted aspect-video w-full rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
