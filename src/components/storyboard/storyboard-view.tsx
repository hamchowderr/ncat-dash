"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  aboutLength,
  type Aspect,
  ASPECTS,
  count,
  type Part,
  PARTS,
  readScript,
  secondsFor,
  takeCount,
} from "@convex/lib/storyboard";
import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowDown, ArrowUp, Bot, FileVideo, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PickList } from "@/components/ui/pick-list";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/catalog";
import { cn } from "@/lib/utils";

import { ChapterPlayer } from "./chapter-player";
import { MakeVideo } from "./make-video";
import { useMatchTakes } from "./match-takes";
import { PartChip, TakeRow } from "./take-row";
import type { Board, Chapter } from "./types";

const EXAMPLE = [
  "## Cold open",
  "[Full Screen · You] The first thing you say.",
  "[Panel · Graphic] A line with points shown beside you.",
  "",
  "## The next chapter",
  "[Full Graphic · Graphic] A line said over a graphic.",
].join("\n");

const TALLY_LABEL: Record<Part, string> = {
  you: "Takes from you",
  graphic: "Graphics",
  recording: "Page recordings",
  screen: "Your screen",
};

/** A sum of what the script holds, shown while it is typed. */
function ScriptSum({ text }: { text: string }) {
  const script = readScript(text);
  const takes = takeCount(script);
  if (takes === 0) return <span>No takes yet</span>;
  return (
    <span>
      {count(script.chapters.length, "chapter")} · {count(takes, "take")} ·{" "}
      {aboutLength(
        secondsFor(script.chapters.flatMap((chapter) => chapter.takes.map((take) => take.line))),
      )}
    </span>
  );
}

function ScriptHelp() {
  return (
    <p className="text-muted-foreground text-sm">
      A line starting with <code>##</code> starts a chapter. Every other line is a take you say. Put
      the scene and anything shown with it in brackets first, such as <code>[Panel · Graphic]</code>
      . Scenes: Full Screen, Panel, Centre, Full Graphic, Circle. Shown with you: Graphic, Page
      recording, Your screen.
    </p>
  );
}

/** What a project shows before it has a storyboard: a place to paste or write one. */
/**
 * Adds the lines drafted from one of the team's uploads to the project's storyboard, so a
 * project can gather several recordings. Shows nothing while no upload has a draft.
 */
function GatherFromUpload({
  projectId,
  organizationId,
  label = "Add an upload's lines",
  variant = "outline",
}: {
  projectId: Id<"projects">;
  organizationId: string;
  label?: string;
  variant?: "outline" | "default";
}) {
  const drafts = useQuery(api.storyboards.uploadDrafts, { organizationId });
  const gather = useMutation(api.storyboards.gatherUploadDraft);
  const [pending, setPending] = useState(false);
  if (!drafts || drafts.length === 0) return null;

  async function add(libraryItemId: Id<"libraryItems">, title: string) {
    setPending(true);
    try {
      const added = await gather({ projectId, libraryItemId });
      toast.success(
        `Added ${count(added.takes, "line")} in ${count(added.chapters, "chapter")} from ${title}.`,
      );
    } catch (caught) {
      toast.error(errorMessage(caught, "Those lines could not be added."));
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant={variant} disabled={pending}>
          <FileVideo />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
        <DropdownMenuLabel>Uploads with a drafted storyboard</DropdownMenuLabel>
        {drafts.map((draft) => (
          <DropdownMenuItem
            key={draft.libraryItemId}
            onSelect={() => void add(draft.libraryItemId, draft.title)}
          >
            <span className="text-muted-foreground font-mono text-xs">{draft.shortId}</span>
            <span className="min-w-0 flex-1 truncate">{draft.title}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StartStoryboard({
  projectId,
  organizationId,
}: {
  projectId: Id<"projects">;
  organizationId: string;
}) {
  const create = useMutation(api.storyboards.create);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);

  async function start(script?: string) {
    setPending(true);
    try {
      await create({ projectId, ...(script ? { script } : {}) });
    } catch (caught) {
      toast.error(errorMessage(caught, "The storyboard could not be started."));
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="Start a storyboard" className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Plan the video line by line</h2>
        <p className="text-muted-foreground text-sm">
          A storyboard lays out every line of the video in chapters, with the scene it is shown in
          and what goes into it, so you can see what is still to record before anything is edited.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <GatherFromUpload
          projectId={projectId}
          organizationId={organizationId}
          label="Start from an upload"
          variant="default"
        />
        <span className="text-muted-foreground text-sm">
          Every upload gets a storyboard drafted from what was said in it. Start from one, then add
          more uploads to gather them here.
        </span>
      </div>
      <Textarea
        aria-label="Script"
        value={text}
        placeholder={EXAMPLE}
        onChange={(event) => setText(event.target.value)}
        className="min-h-56 font-mono text-sm"
      />
      <ScriptHelp />
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending || !text.trim()} onClick={() => void start(text)}>
          Make the storyboard
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => void start()}>
          Start empty
        </Button>
        {text.trim() && (
          <span className="text-muted-foreground text-sm">
            <ScriptSum text={text} />
          </span>
        )}
      </div>
    </section>
  );
}

/** The whole storyboard as text, to change many takes at once. */
function ScriptEditor({ board }: { board: Board }) {
  const script = useQuery(api.storyboards.script, { storyboardId: board._id });
  const write = useMutation(api.storyboards.writeFromScript);
  const [text, setText] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const shown = text ?? script ?? "";

  async function save() {
    setPending(true);
    try {
      const done = await write({ storyboardId: board._id, script: shown });
      setText(null);
      toast.success(`Saved: ${count(done.chapters, "chapter")}, ${count(done.takes, "take")}.`);
    } catch (caught) {
      toast.error(errorMessage(caught, "The script could not be saved."));
    } finally {
      setPending(false);
    }
  }

  if (script === undefined) return <Skeleton className="h-96 rounded-xl" />;
  return (
    <section aria-label="Whole script" className="flex max-w-4xl flex-col gap-3">
      <Textarea
        aria-label="Script"
        value={shown}
        onChange={(event) => setText(event.target.value)}
        className="min-h-[32rem] font-mono text-sm leading-relaxed"
      />
      <ScriptHelp />
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending || text === null || !shown.trim()} onClick={() => void save()}>
          Save script
        </Button>
        {text !== null && (
          <Button variant="ghost" onClick={() => setText(null)}>
            Undo changes
          </Button>
        )}
        <span className="text-muted-foreground text-sm">
          <ScriptSum text={shown} /> · Takes whose line stays the same keep their files.
        </span>
      </div>
    </section>
  );
}

/** How far along each kind of part is, across the whole video. */
function Tallies({ board }: { board: Board }) {
  const shown = PARTS.filter(({ part }) => board.totals[part].all > 0);
  return (
    <ul className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4" aria-label="Progress">
      {shown.map(({ part }) => {
        const { done, all } = board.totals[part];
        return (
          <li key={part} className="flex flex-col gap-1.5">
            <span className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-muted-foreground">{TALLY_LABEL[part]}</span>
              <span className="font-medium tabular-nums">
                {done} of {all}
              </span>
            </span>
            <Progress value={all === 0 ? 0 : (done / all) * 100} aria-label={TALLY_LABEL[part]} />
          </li>
        );
      })}
    </ul>
  );
}

function ChapterList({
  board,
  selected,
  onSelect,
}: {
  board: Board;
  selected: Id<"storyboardChapters">;
  onSelect: (id: Id<"storyboardChapters">) => void;
}) {
  const add = useMutation(api.storyboards.addChapter);

  async function onAdd() {
    try {
      onSelect(await add({ storyboardId: board._id }));
    } catch (caught) {
      toast.error(errorMessage(caught, "The chapter could not be added."));
    }
  }

  return (
    <nav aria-label="Chapters" className="flex flex-col gap-1">
      <h2 className="px-2 pb-1 text-sm font-semibold">Chapters</h2>
      <ol className="flex flex-col gap-0.5">
        {board.chapters.map((chapter, index) => (
          <li key={chapter._id}>
            <button
              type="button"
              aria-current={chapter._id === selected ? "true" : undefined}
              onClick={() => onSelect(chapter._id)}
              className={cn(
                "focus-visible:ring-ring/50 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-3",
                chapter._id === selected ? "row-selected font-medium" : "hover:bg-muted",
              )}
            >
              <span className="text-muted-foreground w-5 shrink-0 text-right font-mono text-xs tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{chapter.title}</span>
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  chapter.ready ? "bg-emerald-500" : "bg-zinc-300",
                )}
                role="img"
                aria-label={chapter.ready ? "Everything in" : "Still missing files"}
              />
            </button>
          </li>
        ))}
      </ol>
      <Button size="sm" variant="ghost" className="justify-start" onClick={() => void onAdd()}>
        <Plus />
        Add chapter
      </Button>
    </nav>
  );
}

function ChapterHeader({
  chapter,
  index,
  total,
  canRemove,
}: {
  chapter: Chapter;
  index: number;
  total: number;
  canRemove: boolean;
}) {
  const rename = useMutation(api.storyboards.renameChapter);
  const move = useMutation(api.storyboards.moveChapter);
  const remove = useMutation(api.storyboards.removeChapter);
  const [title, setTitle] = useState(chapter.title);
  const [confirming, setConfirming] = useState(false);

  async function save() {
    const next = title.trim();
    if (!next || next === chapter.title) return setTitle(chapter.title);
    try {
      await rename({ chapterId: chapter._id, title: next });
    } catch (caught) {
      setTitle(chapter.title);
      toast.error(errorMessage(caught, "The chapter could not be renamed."));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground font-mono text-sm tabular-nums">{index + 1}.</span>
      <Input
        aria-label="Chapter name"
        value={title}
        maxLength={120}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setTitle(chapter.title);
        }}
        className="h-8 min-w-0 flex-1 border-transparent px-1.5 text-base font-semibold shadow-none hover:border-input md:text-base"
      />
      <span className="text-muted-foreground text-sm">
        {count(chapter.takes.length, "take")} · {aboutLength(chapter.seconds)}
      </span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Move chapter up"
        disabled={index === 0}
        onClick={() => void move({ chapterId: chapter._id, direction: "up" })}
      >
        <ArrowUp />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Move chapter down"
        disabled={index === total - 1}
        onClick={() => void move({ chapterId: chapter._id, direction: "down" })}
      >
        <ArrowDown />
      </Button>
      {canRemove &&
        (confirming ? (
          <span className="flex items-center gap-1 text-sm">
            Delete it and its takes?
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void remove({ chapterId: chapter._id })}
            >
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </span>
        ) : (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Delete chapter"
            onClick={() => setConfirming(true)}
          >
            <Trash2 />
          </Button>
        ))}
    </div>
  );
}

function AddTake({ chapterId }: { chapterId: Id<"storyboardChapters"> }) {
  const add = useMutation(api.storyboards.addTake);
  const [line, setLine] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!line.trim() || pending) return;
    setPending(true);
    try {
      await add({ chapterId, line });
      setLine("");
    } catch (caught) {
      toast.error(errorMessage(caught, "The take could not be added."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex gap-2">
      <Input
        aria-label="New take's line"
        placeholder="Add a take: type its line"
        value={line}
        onChange={(event) => setLine(event.target.value)}
      />
      <Button type="submit" variant="outline" disabled={pending || !line.trim()}>
        <Plus />
        Add take
      </Button>
    </form>
  );
}

/** The videos cut from this storyboard and where each goes. */
function Cuts({ board }: { board: Board }) {
  const addCut = useMutation(api.storyboards.addCut);
  const removeCut = useMutation(api.storyboards.removeCut);
  const [what, setWhat] = useState("");
  const [where, setWhere] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!what.trim()) return;
    // Cleared straight away, so a next cut typed while this one saves is not wiped.
    setWhat("");
    setWhere("");
    try {
      await addCut({ storyboardId: board._id, what, where });
    } catch (caught) {
      setWhat(what);
      setWhere(where);
      toast.error(errorMessage(caught, "The cut could not be added."));
    }
  }

  async function onRemove(index: number) {
    try {
      await removeCut({ storyboardId: board._id, index });
    } catch (caught) {
      toast.error(errorMessage(caught, "The cut could not be taken off."));
    }
  }

  return (
    <section aria-label="Cuts from this storyboard" className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Cuts from this storyboard</h3>
      {board.cuts.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          List the videos you will cut from it, such as a full video and short ones.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {board.cuts.map((cut, index) => (
            <li key={`${cut.what}-${index}`} className="flex items-start gap-2 text-sm">
              <span className="flex min-w-0 flex-1 flex-col">
                <span>{cut.what}</span>
                {cut.where && <span className="text-muted-foreground text-xs">{cut.where}</span>}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Take ${cut.what} off the list`}
                onClick={() => void onRemove(index)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-1.5">
        <Input
          aria-label="Cut"
          placeholder="A cut, such as Short lessons"
          value={what}
          onChange={(event) => setWhat(event.target.value)}
        />
        <div className="flex gap-2">
          <Input
            aria-label="Where it goes"
            placeholder="Where, such as YouTube · 16:9"
            value={where}
            onChange={(event) => setWhere(event.target.value)}
          />
          <Button type="submit" size="sm" variant="outline" disabled={!what.trim()}>
            Add
          </Button>
        </div>
      </form>
    </section>
  );
}

/** The selected chapter's preview, what goes into it, and the cuts made from the storyboard. */
function SidePanel({ board, chapter }: { board: Board; chapter: Chapter }) {
  const needs = PARTS.filter(({ part }) => chapter.needs[part] > 0);
  return (
    <aside aria-label="Preview" className="flex flex-col gap-6 lg:sticky lg:top-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Preview</h3>
        <ChapterPlayer key={chapter._id} chapter={chapter} />
      </section>
      <MakeVideo board={board} chapter={chapter} />
      <section aria-label="What goes in" className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">What goes in</h3>
        {needs.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {needs.map(({ part }) => (
              <li key={part} className="flex items-center gap-1.5 text-sm">
                <PartChip part={part} />
                <span className="tabular-nums">{chapter.needs[part]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Cuts board={board} />
    </aside>
  );
}

/**
 * Asks the agent, once, how each line is best shown and what each chapter is called. Off
 * until pressed, so nothing is spent on AI unless someone asks.
 */
function SuggestScenes({ board }: { board: Board }) {
  const suggest = useAction(api.storyboards.suggestScenes);
  const [pending, setPending] = useState(false);
  async function go() {
    setPending(true);
    try {
      const changed = await suggest({ storyboardId: board._id });
      toast.success(
        changed.scenes + changed.titles === 0
          ? "The agent would keep every scene as it is."
          : `New scenes for ${count(changed.scenes, "line")}, ${count(changed.titles, "chapter")} renamed.`,
      );
    } catch (caught) {
      toast.error(errorMessage(caught, "Scenes could not be suggested."));
    } finally {
      setPending(false);
    }
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending || board.takeCount === 0}
      onClick={() => void go()}
      title="The agent reads the lines once and picks a scene for each, and names the chapters."
    >
      <Bot />
      {pending ? "Suggesting…" : "Suggest scenes"}
    </Button>
  );
}

function StoryboardBoard({ board, actions }: { board: Board; actions?: ReactNode }) {
  const setDetails = useMutation(api.storyboards.setDetails);
  const [view, setView] = useState<"board" | "script">("board");
  const [picked, setPicked] = useState<Id<"storyboardChapters"> | null>(null);
  const [openTake, setOpenTake] = useState<string | null>(null);
  const chapterIndex = Math.max(
    0,
    board.chapters.findIndex((chapter) => chapter._id === picked),
  );
  const chapter = board.chapters[chapterIndex];
  const allTakes = board.chapters.flatMap((entry) => entry.takes);
  const matcher = useMatchTakes(board);

  async function onAspect(aspect: Aspect) {
    try {
      await setDetails({ storyboardId: board._id, aspect });
    } catch (caught) {
      toast.error(errorMessage(caught, "That could not be changed."));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-sm">
          {board.source && <span>{board.source} ·</span>}
          <span>
            {count(board.chapters.length, "chapter")} · {count(board.takeCount, "take")} ·{" "}
            {board.length} ·
          </span>
          <PickList
            aria-label="Shape"
            size="sm"
            className="text-foreground"
            value={board.aspect}
            onChange={(next) => void onAspect(next as Aspect)}
            options={ASPECTS.map((aspect) => ({ value: aspect, label: aspect }))}
          />
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <SuggestScenes board={board} />
          {matcher.button}
          {actions}
          <Segmented
            aria-label="Show"
            className="w-auto"
            value={view}
            onValueChange={setView}
            options={[
              { value: "board", label: "Storyboard" },
              { value: "script", label: "Script" },
            ]}
          />
        </div>
      </div>

      {matcher.panel}

      {view === "script" ? (
        <ScriptEditor board={board} />
      ) : (
        <>
          <Tallies board={board} />
          <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_20rem]">
            <ChapterList
              board={board}
              selected={chapter._id}
              onSelect={(id) => {
                setPicked(id);
                setOpenTake(null);
              }}
            />
            <section aria-label={chapter.title} className="flex min-w-0 flex-col gap-3">
              <ChapterHeader
                key={chapter._id + chapter.title}
                chapter={chapter}
                index={chapterIndex}
                total={board.chapters.length}
                canRemove={board.chapters.length > 1}
              />
              {chapter.takes.length === 0 ? (
                <p className="text-muted-foreground rounded-xl bg-surface px-4 py-3 text-sm">
                  No takes in this chapter yet. Add the first one below.
                </p>
              ) : (
                <ol className="flex flex-col gap-2" aria-label="Takes">
                  {chapter.takes.map((take) => (
                    <TakeRow
                      key={take._id}
                      take={take}
                      boardId={board._id}
                      organizationId={board.organizationId}
                      open={openTake === take._id}
                      onToggle={() =>
                        setOpenTake((current) => (current === take._id ? null : take._id))
                      }
                      first={take._id === allTakes[0]?._id}
                      last={take._id === allTakes.at(-1)?._id}
                    />
                  ))}
                </ol>
              )}
              <AddTake chapterId={chapter._id} />
            </section>
            <div className="lg:col-span-2 xl:col-span-1">
              <SidePanel board={board} chapter={chapter} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** A project's storyboard, or a place to start one. */
export function StoryboardView({
  projectId,
  organizationId,
}: {
  projectId: Id<"projects">;
  organizationId: string;
}) {
  const board = useQuery(api.storyboards.get, { projectId });
  if (board === undefined) return <Skeleton className="h-96 rounded-xl" />;
  if (board === null) {
    return <StartStoryboard projectId={projectId} organizationId={organizationId} />;
  }
  return (
    <StoryboardBoard
      board={board}
      actions={<GatherFromUpload projectId={projectId} organizationId={organizationId} />}
    />
  );
}

/** Drafts the upload's storyboard again from its transcript, after asking. */
function DraftAgain({ libraryItemId }: { libraryItemId: Id<"libraryItems"> }) {
  const again = useMutation(api.storyboards.draftAgain);
  const [asking, setAsking] = useState(false);
  async function go() {
    try {
      await again({ libraryItemId });
      toast.success("Drafted again from the transcript.");
    } catch (caught) {
      toast.error(errorMessage(caught, "It could not be drafted again."));
    } finally {
      setAsking(false);
    }
  }
  if (asking) {
    return (
      <span className="flex items-center gap-1 text-sm">
        <span className="text-muted-foreground">Your changes to it go.</span>
        <Button size="sm" variant="outline" onClick={() => void go()}>
          Draft again
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
          Keep it
        </Button>
      </span>
    );
  }
  return (
    <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>
      <RotateCcw />
      Draft again
    </Button>
  );
}

/**
 * The storyboard drafted from an upload: a line for every sentence said in it, each with
 * its own clip, ready to change. While the transcript is on its way, says so.
 */
export function UploadStoryboard({
  libraryItemId,
  transcribed,
}: {
  libraryItemId: Id<"libraryItems">;
  transcribed: boolean;
}) {
  const board = useQuery(api.storyboards.forUpload, { libraryItemId });
  if (board === undefined) return <Skeleton className="h-96 rounded-xl" />;
  if (board === null) {
    return (
      <p className="text-muted-foreground rounded-xl bg-surface px-4 py-3 text-sm">
        {transcribed
          ? "The storyboard is being drafted from what was said."
          : "The storyboard is drafted from what was said once the transcript is in."}
      </p>
    );
  }
  return <StoryboardBoard board={board} actions={<DraftAgain libraryItemId={libraryItemId} />} />;
}
