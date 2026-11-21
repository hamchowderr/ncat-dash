"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { threadComments } from "@ncat-dash/review-core";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Check, Undo2 } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { useNarrow } from "@/hooks/use-narrow";
import { cn } from "@/lib/utils";

import { ClipStage, isStill, type Mark } from "./clip-stage";
import { CompareButton, CompareStage } from "./compare-stage";
import { CommentPanel } from "./comment-panel";
import { useFrameDrawing } from "./frame-drawing";
import { ClipList, type Here, HereNow } from "./review-room";
import { type Typist, useTypingSignal } from "./typing";

type Room = NonNullable<ReturnType<typeof useQuery<typeof api.sharedReview.room>>>;
type Clip = Room["clips"][number];

// Who the client is, kept in their browser: a random id, so they can delete what they
// wrote, and the name they gave. Nothing here signs them in to anything.
const KEY = "ncat-dash:share-guest";
type Guest = { id: string; name: string };

const listeners = new Set<() => void>();
let cached: { raw: string | null; guest: Guest | null } = { raw: null, guest: null };

function readGuest(): Guest | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw === cached.raw) return cached.guest;
  let guest: Guest | null = null;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<Guest>) : null;
    if (parsed && typeof parsed.id === "string" && typeof parsed.name === "string") {
      guest = { id: parsed.id, name: parsed.name };
    }
  } catch {
    guest = null;
  }
  cached = { raw, guest };
  return guest;
}

// When storage is blocked, the name lives for this visit only.
let fallback: Guest | null = null;

function saveGuest(name: string) {
  const guest = { id: readGuest()?.id ?? fallback?.id ?? crypto.randomUUID(), name };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(guest));
  } catch {
    fallback = guest;
  }
  for (const listener of listeners) listener();
}

function useGuest(): Guest | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => readGuest() ?? fallback,
    () => null,
  );
}

/** Keeps the client in the review's room while the page is open, and lists who else is. */
function useGuestPresence(token: string, guest: Guest | null): Here[] {
  const heartbeat = useMutation(api.sharedPresence.heartbeat);
  const disconnect = useMutation(api.sharedPresence.disconnect);
  const [roomToken, setRoomToken] = useState<string | null>(null);
  const guestId = guest?.id;
  const name = guest?.name;

  useEffect(() => {
    if (!guestId || !name) return;
    const sessionId = crypto.randomUUID();
    let session: string | null = null;
    let stopped = false;
    const beat = () =>
      heartbeat({ token, guestId, name, sessionId, interval: 10_000 })
        .then((tokens) => {
          if (stopped) return;
          session = tokens.sessionToken;
          setRoomToken(tokens.roomToken);
        })
        .catch(() => {});
    void beat();
    const timer = setInterval(() => void beat(), 10_000);
    return () => {
      stopped = true;
      clearInterval(timer);
      if (session) void disconnect({ sessionToken: session }).catch(() => {});
    };
  }, [token, guestId, name, heartbeat, disconnect]);

  const here = useQuery(
    api.sharedPresence.here,
    guestId && roomToken ? { token, guestId, roomToken } : "skip",
  );
  return here ?? [];
}

function NameForm({ teamName }: { teamName: string | null }) {
  const [name, setName] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = name.replace(/\s+/g, " ").trim();
    if (clean) saveGuest(clean.slice(0, 60));
  }
  return (
    <form
      onSubmit={submit}
      className="bg-card mx-auto mt-[12svh] flex w-full max-w-sm flex-col gap-4 rounded-xl border p-6"
    >
      <div className="grid gap-1">
        <h1 className="text-lg font-semibold">Before you start</h1>
        <p className="text-muted-foreground text-sm">
          {teamName ? `${teamName} will` : "The team will"} see this name beside your comments.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="guest-name">Your name</Label>
        <Input
          id="guest-name"
          autoFocus
          autoComplete="name"
          maxLength={60}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={!name.trim()}>
        Continue
      </Button>
    </form>
  );
}

function Workspace({
  token,
  guest,
  clip,
  index,
  count,
  version,
  onVersion,
  typing,
}: {
  token: string;
  guest: Guest;
  clip: Clip;
  index: number;
  count: number;
  version: number;
  onVersion: (version: number) => void;
  typing: Typist[];
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const all = useQuery(api.sharedReview.comments, {
    token,
    clipId: clip._id,
    guestId: guest.id,
  });
  const comment = useMutation(api.sharedReview.comment);
  const removeComment = useMutation(api.sharedReview.removeComment);
  const sayTyping = useMutation(api.sharedPresence.typing);
  const signal = useTypingSignal(
    (place) =>
      void sayTyping({ token, guestId: guest.id, name: guest.name, typing: place }).catch(() => {}),
  );

  const [comparing, setComparing] = useState(false);
  const url = clip.versions[version - 1].url;
  const timed = !isStill(url);
  const threads = threadComments((all ?? []).filter((entry) => entry.version === version));
  const marks: Mark[] = threads.map(({ root }) => ({
    id: root.id,
    time: root.time,
    authorId: root.authorId,
    authorName: root.authorName,
    resolved: root.resolved,
  }));

  const sketch = useFrameDrawing({ video, threads, active: active, time, playing });

  function seek(seconds: number) {
    const player = video.current;
    if (!player) return;
    player.currentTime = seconds;
    setTime(seconds);
  }

  /** Picks a thread; one with a drawing also stops the clip at its moment to show it. */
  function pick(id: string | null) {
    setActive(id);
    const root = threads.find((thread) => thread.root.id === id)?.root;
    if (root?.drawing && !sketch.composer.drawing) {
      video.current?.pause();
      seek(root.time);
    }
  }

  if (comparing) {
    return (
      <CompareStage
        title={clip.title}
        versions={clip.versions}
        initial={version}
        onClose={(next) => {
          setComparing(false);
          onVersion(next);
        }}
      />
    );
  }

  return (
    <div className="stage-row flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:flex-row">
      <ClipStage
        url={url}
        video={video}
        time={time}
        duration={duration}
        playing={playing}
        marks={marks}
        activeMark={active}
        onTime={setTime}
        onDuration={(seconds) => setDuration(Number.isFinite(seconds) ? seconds : 0)}
        onPlaying={setPlaying}
        onSeek={seek}
        drawing={sketch.stage}
        onMark={(mark) => {
          video.current?.pause();
          seek(mark.time);
          setActive(mark.id);
          document
            .getElementById(`thread-${mark.id}`)
            ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }}
        header={
          <>
            <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
              {count > 1 && (
                <span className="text-zinc-400">
                  Clip {index + 1} of {count} ·{" "}
                </span>
              )}
              {clip.title}
            </h2>
            {clip.versions.length > 1 && (
              <div
                role="group"
                aria-label="Version"
                className="flex rounded-lg bg-white/10 p-0.5 text-xs"
              >
                {clip.versions.map((_, at) => (
                  <button
                    key={at}
                    type="button"
                    aria-pressed={version === at + 1}
                    onClick={() => onVersion(at + 1)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-zinc-300 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/60",
                      version === at + 1 && "bg-white/20 font-medium text-white",
                    )}
                  >
                    Version {at + 1}
                  </button>
                ))}
              </div>
            )}
            {clip.versions.length > 1 && <CompareButton onClick={() => setComparing(true)} />}
          </>
        }
      />
      <CommentPanel
        guest
        threads={threads}
        loading={all === undefined}
        people={[]}
        timed={timed}
        moment={time}
        active={active}
        onActive={pick}
        drawing={sketch.composer}
        typing={typing}
        onTyping={(threadId, active) => signal({ clipId: clip._id, version, threadId }, active)}
        onSeek={(seconds) => {
          video.current?.pause();
          seek(seconds);
        }}
        onComposerFocus={() => video.current?.pause()}
        onSend={async (body, parentId) => {
          try {
            const id = await comment({
              token,
              guestId: guest.id,
              name: guest.name,
              clipId: clip._id,
              body,
              time: timed ? (video.current?.currentTime ?? time) : 0,
              version,
              parentId: parentId as Id<"reviewComments"> | undefined,
              drawing: parentId ? undefined : sketch.pending,
            });
            if (!parentId) {
              sketch.sent();
              setActive(id);
            }
            return true;
          } catch (error) {
            toast.error(errorMessage(error, "The comment could not be saved."));
            return false;
          }
        }}
        onDelete={(id) =>
          void removeComment({
            token,
            guestId: guest.id,
            commentId: id as Id<"reviewComments">,
          }).catch((error) => toast.error(errorMessage(error, "The comment could not be deleted.")))
        }
      />
    </div>
  );
}

function Verdict({
  token,
  guest,
  room,
  narrow = false,
}: {
  token: string;
  guest: Guest;
  room: Room;
  /** On a phone: two big buttons side by side along the bottom. */
  narrow?: boolean;
}) {
  const give = useMutation(api.sharedReview.verdict);
  const [busy, setBusy] = useState(false);
  if (room.status !== "open") {
    return (
      <Badge variant={room.status === "approved" ? "default" : "destructive"}>
        {room.status === "approved" ? <Check /> : <Undo2 />}
        {room.status === "approved" ? "Approved by the team" : "The team is making changes"}
      </Badge>
    );
  }
  if (!room.allowVerdict) return null;

  async function say(approved: boolean) {
    setBusy(true);
    try {
      await give({ token, guestId: guest.id, name: guest.name, approved });
    } catch (error) {
      toast.error(errorMessage(error, "That could not be sent."));
    } finally {
      setBusy(false);
    }
  }

  const verdict = room.verdict;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", narrow && "grid grid-cols-2")}>
      {verdict && (
        <span
          role="status"
          className={cn("text-muted-foreground text-sm", narrow && "col-span-2 text-xs")}
        >
          {verdict.name} {verdict.approved ? "approved" : "asked for changes"}
        </span>
      )}
      <Button
        variant={verdict && !verdict.approved ? "secondary" : "outline"}
        size={narrow ? "lg" : "sm"}
        className={cn(narrow && "h-11")}
        disabled={busy}
        aria-pressed={verdict ? !verdict.approved : false}
        onClick={() => void say(false)}
      >
        <Undo2 />
        Ask for changes
      </Button>
      <Button
        size={narrow ? "lg" : "sm"}
        className={cn(narrow && "h-11")}
        variant={verdict?.approved ? "secondary" : "default"}
        disabled={busy}
        aria-pressed={verdict ? verdict.approved : false}
        onClick={() => void say(true)}
      >
        <Check />
        Approve
      </Button>
    </div>
  );
}

/** A review as a client sees it through its share link, with no account. */
export function SharedReview({ token, backHref }: { token: string; backHref?: string }) {
  const room = useQuery(api.sharedReview.room, { token });
  const guest = useGuest();
  const here = useGuestPresence(token, guest);
  const [clipId, setClipId] = useState<Id<"reviewClips"> | null>(null);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const narrow = useNarrow();

  if (room === undefined) return <Skeleton className="m-4 h-[70svh] rounded-xl" />;
  if (room === null || room.clips.length === 0) {
    return (
      <div className="mx-auto mt-[12svh] flex max-w-sm flex-col gap-2 rounded-xl border p-6">
        <h1 className="text-lg font-semibold">This review is no longer shared</h1>
        <p className="text-muted-foreground text-sm">
          The link was switched off or the review was removed. Ask the person who sent it for a new
          one.
        </p>
      </div>
    );
  }
  if (!guest) return <NameForm teamName={room.teamName} />;

  const index = Math.max(
    0,
    room.clips.findIndex((clip) => clip._id === clipId),
  );
  const clip = room.clips[index];
  const version = Math.min(versions[clip._id] ?? clip.versions.length, clip.versions.length);

  // A deciding client on a phone gets the buttons along the bottom, in their own room.
  const bottomVerdict = narrow && room.status === "open" && room.allowVerdict;

  return (
    // The whole window, so on a phone the room scrolls inside it and the decision stays put
    // under the thumb, without covering anything.
    <div className="flex h-dvh flex-col gap-3 p-3 sm:p-4 lg:h-svh lg:min-h-[36rem]">
      <div
        data-room-scroll
        className="-mx-3 min-h-0 flex-1 overflow-y-auto px-3 max-lg:space-y-3 sm:-mx-4 sm:px-4 lg:contents"
      >
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {backHref && (
            <Button asChild variant="ghost" size="icon" className="-mr-2">
              <Link href={backHref}>
                <ArrowLeft />
                <span className="sr-only">Back to the project</span>
              </Link>
            </Button>
          )}
          <div className="min-w-0 flex-1">
            {room.teamName && (
              <p className="text-muted-foreground truncate text-xs">From {room.teamName}</p>
            )}
            <h1 className="truncate font-medium">{room.title}</h1>
          </div>
          <div className={cn("flex items-center gap-x-4 gap-y-2", narrow && "basis-full")}>
            <HereNow here={here} me={`guest:${guest.id}`} />
            <span className="text-muted-foreground text-sm">Reviewing as {guest.name}</span>
          </div>
          {!bottomVerdict && <Verdict token={token} guest={guest} room={room} />}
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
          {room.clips.length > 1 && (
            <ClipList clips={room.clips} selected={clip._id} onSelect={setClipId} />
          )}
          <Workspace
            key={`${clip._id}:${version}`}
            token={token}
            guest={guest}
            clip={clip}
            index={index}
            count={room.clips.length}
            version={version}
            onVersion={(next) => setVersions((current) => ({ ...current, [clip._id]: next }))}
            typing={here
              .filter(
                (person) =>
                  person.id !== `guest:${guest.id}` &&
                  person.typing?.clipId === clip._id &&
                  person.typing.version === version,
              )
              .map((person) => ({
                id: person.id,
                name: person.name,
                threadId: person.typing!.threadId,
              }))}
          />
        </div>
      </div>
      {bottomVerdict && (
        <div data-decision-bar className="pb-[env(safe-area-inset-bottom)]">
          <Verdict token={token} guest={guest} room={room} narrow />
        </div>
      )}
    </div>
  );
}
