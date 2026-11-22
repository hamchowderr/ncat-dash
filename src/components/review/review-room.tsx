"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import usePresence from "@convex-dev/presence/react";
import { statusLabel, threadComments } from "@ncat-dash/review-core";
import { useMutation, useQuery } from "convex/react";
import {
  Check,
  ChevronRight,
  EllipsisVertical,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { fileNameOf, isVideoUrl } from "@/components/jobs/media-preview";
import { Badge } from "@/components/ui/badge";
import { PageTourButton, StartPageTour } from "@/components/tours/page-tour";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage, stepTitle } from "@/lib/catalog";
import { useNarrow } from "@/hooks/use-narrow";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { ClipStage, isStill, type Mark } from "./clip-stage";
import { CompareButton, CompareStage } from "./compare-stage";
import type { RoomData, Typing } from "@convex/lib/typing";

import { CommentPanel } from "./comment-panel";
import { useFrameDrawing } from "./frame-drawing";
import { type Typist, useTypingSignal } from "./typing";
import { AGENT_PERSON, Face, type Person } from "./person";
import { ShareDialog } from "./share-dialog";

type Review = NonNullable<ReturnType<typeof useQuery<typeof api.reviews.get>>>;
type Clip = Review["clips"][number];

const finishedAt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

type Present = NonNullable<ReturnType<typeof usePresence>>[number];
export type Here = Person & { client: boolean; typing: Typing };

/** Who has the room open: teammates from the team list, clients by the name they gave. */
function whoIsHere(present: Present[] | undefined, people: Person[]): Here[] {
  const here: Here[] = [];
  for (const state of present ?? []) {
    if (!state.online || here.some((entry) => entry.id === state.userId)) continue;
    const data = (state.data ?? {}) as RoomData;
    if (state.userId.startsWith("guest:")) {
      if (data.name)
        here.push({
          id: state.userId,
          name: data.name,
          image: null,
          client: true,
          typing: data.typing ?? null,
        });
      continue;
    }
    const person = people.find((entry) => entry.id === state.userId);
    if (person) here.push({ ...person, client: false, typing: data.typing ?? null });
  }
  return here;
}

/** The people who have this room open right now, clients included. */
export function HereNow({ here, me }: { here: Here[]; me: string }) {
  if (here.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <ul aria-label="Here now" className="flex -space-x-1.5">
        {here.slice(0, 5).map((person) => (
          <li key={person.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="ring-background relative block rounded-full ring-2">
                  <Face {...person} />
                  <span className="ring-background absolute right-0 bottom-0 size-2 rounded-full bg-emerald-500 ring-2" />
                  <span className="sr-only">{person.name}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {person.id === me
                  ? `${person.name} (you)`
                  : person.client
                    ? `${person.name} (client)`
                    : person.name}
              </TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
      <span className="text-muted-foreground text-xs whitespace-nowrap">
        {here.length === 1 ? "Only you here" : `${here.length} here now`}
      </span>
    </div>
  );
}

/** What the client answered through their share link. It never decides the review. */
function ClientVerdict({ verdict }: { verdict: { name: string; approved: boolean } }) {
  return (
    <Badge
      variant="outline"
      data-client-verdict={verdict.approved ? "approved" : "changes"}
      className={
        verdict.approved
          ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-400"
          : "border-amber-600/40 text-amber-700 dark:text-amber-400"
      }
    >
      {verdict.approved ? <Check /> : <Undo2 />}
      {verdict.name} {verdict.approved ? "approved" : "wants changes"}
    </Badge>
  );
}

/**
 * A step run by hand, outside an automation, named for people: the toolkit's own request
 * names (such as its free-form edit) are not shown.
 */
function plainStepTitle(stepId: string): string {
  return stepId === "ffmpeg-compose" ? "Custom edit" : stepTitle(stepId);
}

/** Picks one of the team's recent result files as the clip's next version. */
function AddVersion({ clip, organizationId }: { clip: Clip; organizationId: string }) {
  const [open, setOpen] = useState(false);
  const groups = useQuery(api.jobs.outputs, open ? { organizationId } : "skip");
  const addVersion = useMutation(api.reviews.addVersion);
  // Each file once, newest first, leaving out the ones this clip already has.
  const seen = new Set(clip.versions.map((version) => version.url));
  const files: { url: string; name: string; step: string; finishedAt: number | null }[] = [];
  for (const group of groups ?? []) {
    for (const url of group.urls) {
      // A clip's new version is a video: caption files, pictures and sound are left out.
      if (seen.has(url) || !isVideoUrl(url)) continue;
      seen.add(url);
      files.push({
        url,
        name: group.names?.[url] ?? fileNameOf(url),
        step: group.stepName ?? plainStepTitle(group.stepId),
        finishedAt: group.finishedAt,
      });
    }
  }

  async function pick(url: string) {
    try {
      await addVersion({ clipId: clip._id, url });
      setOpen(false);
    } catch (error) {
      toast.error(errorMessage(error, "The new version could not be added."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-zinc-300 hover:text-white"
          data-tour-step-id="tour-review-version"
        >
          <Plus />
          New version
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a new version</DialogTitle>
          <DialogDescription>
            Pick the changed file from your recent outputs. The earlier version and its comments
            stay, so the team can compare.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-2 max-h-80 overflow-y-auto">
          {groups === undefined ? (
            <Skeleton className="mx-2 h-24" />
          ) : files.length === 0 ? (
            <p className="text-muted-foreground px-2 text-sm">
              No other files yet. A new version shows up here as soon as a step makes one.
            </p>
          ) : (
            <ul className="flex flex-col">
              {files.map((file) => (
                <li key={file.url}>
                  <button
                    type="button"
                    onClick={() => void pick(file.url)}
                    className="hover:bg-accent focus-visible:bg-accent flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left outline-none"
                  >
                    <span className="max-w-full truncate text-sm font-medium">{file.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {file.step}
                      {file.finishedAt ? ` · ${finishedAt.format(file.finishedAt)}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One clip at one version: the player beside its conversation. */
function ClipWorkspace({
  review,
  clip,
  index,
  version,
  people,
  onVersion,
  focus = null,
  highlight = null,
  onFocused,
  typing = [],
}: {
  review: Review;
  clip: Clip;
  index: number;
  version: number;
  people: Person[];
  onVersion: (version: number) => void;
  /** A comment to open at, such as one a notification links to. */
  focus?: string | null;
  /** The thread marked when the room was opened at a comment. */
  highlight?: string | null;
  onFocused?: (threadId: string | null) => void;
  /** Others writing on this clip and version right now. */
  typing?: Typist[];
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  const all = useQuery(api.reviews.comments, { clipId: clip._id });
  const comment = useMutation(api.reviews.comment);
  const resolve = useMutation(api.reviews.resolve);
  const removeComment = useMutation(api.reviews.removeComment);
  const askAgentAgain = useMutation(api.reviews.askAgentAgain);
  const sayTyping = useMutation(api.presence.typing);
  const signal = useTypingSignal(
    (place) => void sayTyping({ roomId: review._id, typing: place }).catch(() => {}),
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

  const sketch = useFrameDrawing({ video, threads, active: active ?? highlight, time, playing });

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

  // Opening at a comment: its version, its moment, and its thread in view.
  useEffect(() => {
    if (!focus || all === undefined) return;
    const found = all.find((entry) => entry.id === focus);
    const root = found?.parentId ? all.find((entry) => entry.id === found.parentId) : found;
    if (root && root.version !== version) {
      onVersion(root.version);
      return;
    }
    if (root) {
      seek(root.time);
      document
        .getElementById(`thread-${root.id}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    onFocused?.(root?.id ?? null);
    // Runs once the comments arrive; the handlers change on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, all, version]);

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
              <span className="text-zinc-400">
                Clip {index + 1} of {review.clips.length} ·{" "}
              </span>
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
            <AddVersion clip={clip} organizationId={review.organizationId} />
          </>
        }
      />
      <CommentPanel
        threads={threads}
        loading={all === undefined}
        people={people}
        timed={timed}
        moment={time}
        active={active ?? highlight}
        onActive={pick}
        drawing={sketch.composer}
        typing={typing}
        onTyping={(threadId, active) => signal({ clipId: clip._id, version, threadId }, active)}
        onSeek={(seconds) => {
          video.current?.pause();
          seek(seconds);
        }}
        // A note is about what is on screen, so the clip holds still while it is written.
        onComposerFocus={() => video.current?.pause()}
        onSend={async (body, parentId) => {
          try {
            const id = await comment({
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
        onResolve={(id, resolved) =>
          void resolve({ commentId: id as Id<"reviewComments">, resolved }).catch((error) =>
            toast.error(errorMessage(error, "That could not be saved.")),
          )
        }
        onDelete={(id) =>
          void removeComment({ commentId: id as Id<"reviewComments"> }).catch((error) =>
            toast.error(errorMessage(error, "The comment could not be deleted.")),
          )
        }
        onAskAgain={(id) =>
          void askAgentAgain({ commentId: id as Id<"reviewComments"> }).catch((error) =>
            toast.error(errorMessage(error, "The agent could not be asked again.")),
          )
        }
      />
    </div>
  );
}

/** A clip as the list shows it; the team's view also counts its comments. */
type Listed = {
  _id: Id<"reviewClips">;
  title: string;
  versions: { url: string }[];
  comments?: number;
  open?: number;
};

export function ClipList({
  clips,
  selected,
  onSelect,
}: {
  clips: Listed[];
  selected: string;
  onSelect: (id: Id<"reviewClips">) => void;
}) {
  return (
    <nav
      aria-label="Clips in this review"
      data-tour-step-id="tour-review-clips"
      className="min-w-0 lg:w-44 lg:shrink-0 xl:w-56"
    >
      <ul className="flex gap-1 overflow-x-auto lg:max-h-full lg:flex-col lg:gap-2 lg:overflow-x-visible lg:overflow-y-auto">
        {clips.map((clip, at) => {
          const url = clip.versions[clip.versions.length - 1].url;
          const current = clip._id === selected;
          return (
            <li key={clip._id} className="w-44 shrink-0 lg:w-auto">
              <button
                type="button"
                aria-current={current}
                data-clip-id={clip._id}
                onClick={() => onSelect(clip._id)}
                className={cn(
                  "hover:bg-muted/70 focus-visible:ring-ring/50 flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left outline-none focus-visible:ring-3 lg:flex-col lg:items-stretch lg:gap-2 lg:p-2",
                  current && "bg-muted",
                )}
              >
                {/* A big picture of each clip on a wide screen, in its own shape. */}
                <span
                  data-clip-preview=""
                  className="relative flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black lg:h-auto lg:max-h-72 lg:w-full"
                >
                  {isStill(url) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover lg:h-auto lg:max-h-72"
                    />
                  ) : (
                    <video
                      src={`${url}#t=0.1`}
                      muted
                      playsInline
                      preload="metadata"
                      tabIndex={-1}
                      aria-hidden="true"
                      className="size-full object-cover lg:h-auto lg:max-h-72"
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className="absolute top-1.5 left-1.5 hidden rounded-md bg-black/60 px-1.5 py-0.5 text-[0.7rem] font-medium text-white tabular-nums lg:block"
                  >
                    {at + 1}
                  </span>
                </span>
                <span className="flex min-w-0 flex-col gap-0.5 lg:px-0.5">
                  <span className="line-clamp-2 text-sm leading-snug font-medium">
                    {clip.title}
                  </span>
                  {clip.comments !== undefined && (
                    <span className="text-muted-foreground text-xs">
                      {clip.comments === 0
                        ? "No comments"
                        : clip.open === 0
                          ? "All resolved"
                          : `${clip.open} to resolve`}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * One review. `focus` opens it at a clip and a comment, as a link from a notification does
 * (/review/<id>?clip=<clipId>&comment=<commentId>).
 */
export function ReviewRoom(props: {
  reviewId: Id<"reviews">;
  focus?: { clip?: string; comment?: string };
}) {
  const review = useQuery(api.reviews.get, { reviewId: props.reviewId });
  // Someone who cannot open the review never joins its room, so nobody sees them there.
  if (review === undefined) return <Skeleton className="h-[70svh] rounded-xl" />;
  if (review === null || review.clips.length === 0) return <GoneRoom />;
  return <OpenRoom {...props} />;
}

function GoneRoom() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl bg-surface p-6">
      <p className="text-muted-foreground text-sm">
        This review is gone, or it belongs to another team.
      </p>
      <Button asChild size="sm" variant="outline">
        <Link href="/review" transitionTypes={["nav-back"]}>
          Back to Review
        </Link>
      </Button>
    </div>
  );
}

function OpenRoom({
  reviewId,
  focus,
}: {
  reviewId: Id<"reviews">;
  focus?: { clip?: string; comment?: string };
}) {
  const team = useActiveTeam();
  const router = useRouter();
  const review = useQuery(api.reviews.get, { reviewId });
  const roster = useQuery(api.reviews.people, { organizationId: team.id });
  // The heartbeat names the signed-in person itself; this id only keys the session.
  const present = usePresence(api.presence, reviewId, roster?.me ?? "loading");
  const decide = useMutation(api.reviews.decide);
  const reopen = useMutation(api.reviews.reopen);
  const remove = useMutation(api.reviews.remove);
  const [clipId, setClipId] = useState<Id<"reviewClips"> | null>(
    (focus?.clip as Id<"reviewClips"> | undefined) ?? null,
  );
  const [focusComment, setFocusComment] = useState<string | null>(focus?.comment ?? null);
  const [highlight, setHighlight] = useState<string | null>(null);
  // The version on screen for each clip; the newest until someone picks another.
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const narrow = useNarrow();

  if (review === undefined) return <Skeleton className="h-[70svh] rounded-xl" />;
  if (review === null || review.clips.length === 0) return <GoneRoom />;

  const index = Math.max(
    0,
    review.clips.findIndex((clip) => clip._id === clipId),
  );
  const clip = review.clips[index];
  const version = Math.min(versions[clip._id] ?? clip.versions.length, clip.versions.length);
  const people = roster?.people ?? [];
  const decider = people.find((person) => person.id === review.decidedBy);
  const here = roster ? whoIsHere(present, people) : [];
  const typists: Typist[] = here
    .filter(
      (person) =>
        person.id !== roster?.me &&
        person.typing?.clipId === clip._id &&
        person.typing.version === version,
    )
    .map((person) => ({ id: person.id, name: person.name, threadId: person.typing!.threadId }));

  async function act(run: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    try {
      await run();
    } catch (error) {
      toast.error(errorMessage(error, fallback));
    } finally {
      setBusy(false);
    }
  }

  const decision =
    review.status === "open" ? (
      <div
        className={cn("flex items-center gap-2", narrow && "grid grid-cols-2")}
        data-tour-step-id="tour-review-decide"
      >
        <Button
          variant="outline"
          size={narrow ? "lg" : "sm"}
          className={cn(narrow && "h-11")}
          disabled={busy}
          onClick={() =>
            act(() => decide({ reviewId, approved: false }), "The decision could not be saved.")
          }
        >
          <Undo2 />
          Ask for changes
        </Button>
        <Button
          size={narrow ? "lg" : "sm"}
          className={cn(narrow && "h-11")}
          disabled={busy}
          onClick={() =>
            act(() => decide({ reviewId, approved: true }), "The approval could not be saved.")
          }
        >
          <Check />
          Approve
        </Button>
      </div>
    ) : null;

  const runNote = review.holdsRun && (
    <p
      className={cn(
        "text-muted-foreground",
        narrow ? "text-xs" : "bg-muted/60 rounded-lg px-3 py-2 text-sm",
      )}
    >
      An automation is paused on this review. Approving sends these files on to its next step;
      asking for changes stops the run.
    </p>
  );

  return (
    // Exactly the height that is left under the top bar (4rem, plus the page's 1rem bottom
    // padding; 2rem with the frame on a wide screen), so the page itself never scrolls. On a
    // wide screen the clip gets every bit of that height. On a narrow one, a phone, the room
    // scrolls inside and the decision stays at the bottom, under the thumb, taking its own
    // room rather than covering the clips.
    <div className="flex h-[calc(100dvh-5rem)] flex-col gap-3 lg:h-[calc(100svh-6rem)] lg:min-h-[36rem]">
      <div
        data-room-scroll
        className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 max-lg:space-y-3 lg:contents"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-sm max-lg:basis-0 lg:basis-auto"
          >
            <Link
              href="/review"
              transitionTypes={["nav-back"]}
              className="text-muted-foreground hover:text-foreground"
            >
              Review
            </Link>
            <ChevronRight className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
            <h1 className="truncate font-medium">{review.title}</h1>
          </nav>

          {roster && !narrow && <HereNow here={here} me={roster.me} />}

          <div className={cn("flex items-center gap-2", narrow ? "-mr-2 gap-0" : "flex-wrap")}>
            <StartPageTour tourId="review-room" />
            <PageTourButton tourId="review-room" compact={narrow} />
            {review.clientVerdict && !narrow && <ClientVerdict verdict={review.clientVerdict} />}
            <ShareDialog reviewId={reviewId} compact={narrow} />
            {review.status === "open" ? (
              !narrow && decision
            ) : (
              <Badge variant={review.status === "approved" ? "default" : "destructive"}>
                {review.status === "approved" && <Check />}
                {statusLabel(review.status)}
                {decider ? ` by ${decider.name}` : ""}
              </Badge>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size={narrow ? "icon" : "icon-sm"} aria-label="More">
                  <EllipsisVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {review.status !== "open" && (
                  <DropdownMenuItem
                    onSelect={() => act(() => reopen({ reviewId }), "That could not be saved.")}
                  >
                    <RotateCcw />
                    Put back in review
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() =>
                    act(async () => {
                      await remove({ reviewId });
                      router.push("/review", { transitionTypes: ["nav-back"] });
                    }, "The review could not be deleted.")
                  }
                >
                  <Trash2 />
                  Delete review
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Second line on a narrow screen: who is here, and what the client said. */}
          {narrow && (roster || review.clientVerdict) && (
            <div className="flex basis-full flex-wrap items-center gap-2">
              {roster && <HereNow here={here} me={roster.me} />}
              {review.clientVerdict && <ClientVerdict verdict={review.clientVerdict} />}
            </div>
          )}
        </div>

        {!narrow && runNote}

        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
          {review.clips.length > 1 && (
            <ClipList
              clips={review.clips}
              selected={clip._id}
              onSelect={(id) => {
                setFocusComment(null);
                setHighlight(null);
                setClipId(id);
              }}
            />
          )}
          <ClipWorkspace
            key={`${clip._id}:${version}`}
            review={review}
            clip={clip}
            index={index}
            version={version}
            people={[AGENT_PERSON, ...people]}
            onVersion={(next) => setVersions((current) => ({ ...current, [clip._id]: next }))}
            focus={focusComment}
            highlight={highlight}
            typing={typists}
            onFocused={(threadId) => {
              setFocusComment(null);
              setHighlight(threadId);
            }}
          />
        </div>
      </div>

      {narrow && decision && (
        <div data-decision-bar className="flex flex-col gap-2 pb-[env(safe-area-inset-bottom)]">
          {runNote}
          {decision}
        </div>
      )}
    </div>
  );
}
