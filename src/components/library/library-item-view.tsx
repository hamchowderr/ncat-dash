"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatMoment } from "@takewon/automation-core";
import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowLeft, AudioLines, Bot, Copy, Play, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { CopyLookFromUpload } from "@/components/looks/look-study";
import { UploadFrame } from "@/components/uploads/upload-media";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/catalog";
import { followedMessage } from "@/components/library/followed";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { FileRuns } from "./file-runs";
import { SubtitleText, TranscriptDownload } from "./transcript-files";
import { LanguagePicker, ORIGINAL, TranslatedWords } from "./translations";
import { UploadStoryboard } from "@/components/storyboard/storyboard-view";
import { KIND_LABELS, ShortId, sourceLabel, StarRating, useLibraryLinks } from "./library-media";
import { PickList } from "@/components/ui/pick-list";
import { Segmented } from "@/components/ui/segmented";
import { FileFacts } from "./file-facts";
import { transcriptState, WorkRow, type Work } from "./work-status";

type Tab = "words" | "storyboard" | "made" | "details";

/** Wraps each place the search words appear in a highlight. */
function marked(text: string, words: string[]): ReactNode {
  if (words.length === 0) return text;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "gi"));
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className="rounded-sm bg-amber-200/70 px-0.5 text-inherit">
        {part}
      </mark>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

function TagEditor({ itemId, tags }: { itemId: Id<"libraryItems">; tags: string[] }) {
  const setTags = useMutation(api.library.setTags);
  const [typed, setTyped] = useState("");
  async function save(next: string[]) {
    try {
      await setTags({ itemId, tags: next });
    } catch (caught) {
      toast.error(errorMessage(caught, "The tags could not be saved."));
    }
  }
  return (
    <div className="flex flex-col gap-2">
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
          {tags.map((tag) => (
            <li
              key={tag}
              className="bg-muted flex items-center gap-1 rounded-md py-0.5 pr-1 pl-2 text-xs"
            >
              {tag}
              <button
                type="button"
                className="hover:bg-background rounded p-0.5"
                aria-label={`Remove the tag ${tag}`}
                onClick={() => void save(tags.filter((one) => one !== tag))}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const added = typed
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean);
          if (added.length === 0) return;
          setTyped("");
          void save([...tags, ...added]);
        }}
      >
        <Input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Add a tag and press Enter"
          aria-label="Add a tag"
          className="h-8"
        />
      </form>
    </div>
  );
}

function Title({ itemId, title }: { itemId: Id<"libraryItems">; title: string }) {
  const rename = useMutation(api.library.rename);
  const [editing, setEditing] = useState<string | null>(null);
  async function save() {
    const next = editing?.trim();
    setEditing(null);
    if (!next || next === title) return;
    try {
      const result = await rename({ itemId, title: next });
      if (result?.followed) toast.success(followedMessage(result.followed));
    } catch (caught) {
      toast.error(errorMessage(caught, "The name could not be changed."));
    }
  }
  if (editing !== null) {
    return (
      <input
        autoFocus
        value={editing}
        aria-label="Name"
        onChange={(event) => setEditing(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setEditing(null);
        }}
        className="focus-visible:ring-ring/50 bg-surface w-full rounded-md px-2 py-1 text-xl font-semibold tracking-tight outline-none focus-visible:ring-2"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(title)}
      className="hover:bg-surface -mx-2 rounded-md px-2 py-1 text-left text-xl font-semibold tracking-tight"
      aria-label={`Rename ${title}`}
    >
      {title}
    </button>
  );
}

function RunMenu({ itemId, teamId }: { itemId: Id<"libraryItems">; teamId: string }) {
  const automations = useQuery(api.automations.list, { organizationId: teamId });
  const runAutomation = useAction(api.library.runAutomation);
  const router = useRouter();
  const [running, setRunning] = useState(false);
  async function run(automationId: Id<"automations">, name: string) {
    setRunning(true);
    try {
      const runId = await runAutomation({ itemId, automationId });
      toast.success(`${name} is running on this file.`, {
        action: {
          label: "Open the run",
          onClick: () => router.push(`/automations/${automationId}/runs/${runId}`),
        },
      });
    } catch (caught) {
      toast.error(errorMessage(caught, "The automation could not start."));
    } finally {
      setRunning(false);
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" disabled={running}>
          <Play />
          Pick an automation
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
        <DropdownMenuLabel>Runs the published version</DropdownMenuLabel>
        {automations === undefined ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : automations.length === 0 ? (
          <DropdownMenuItem asChild>
            <Link href="/automations">Make an automation first</Link>
          </DropdownMenuItem>
        ) : (
          automations.map((automation) => (
            <DropdownMenuItem
              key={automation._id}
              onSelect={() => void run(automation._id, automation.name)}
            >
              {automation.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Who a file is for: the team itself or one of its clients. Files an automation made for a
 * client come in set; this changes it, and files made from this one follow. Nothing shows
 * until the team has a client.
 */
function ClientFact({
  itemId,
  teamId,
  client,
}: {
  itemId: Id<"libraryItems">;
  teamId: string;
  client: { _id: Id<"clients">; name: string } | null;
}) {
  const clients = useQuery(api.clients.list, { organizationId: teamId });
  const setClient = useMutation(api.library.setClient);
  if (!clients || clients.length === 0) return null;

  async function onChange(value: string) {
    try {
      await setClient({ itemId, clientId: value ? (value as Id<"clients">) : null });
    } catch (caught) {
      toast.error(errorMessage(caught, "That could not be changed."));
    }
  }

  return (
    <Fact label="Client">
      <PickList
        aria-label="Client"
        size="sm"
        className="max-w-44"
        value={client?._id ?? ""}
        onChange={(next) => void onChange(next)}
        options={[
          { value: "", label: "Your team" },
          ...clients.map((one) => ({ value: one._id, label: one.name })),
        ]}
      />
    </Fact>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

export function LibraryItemView({
  itemId,
  at,
  search,
}: {
  itemId: Id<"libraryItems">;
  at?: number;
  search?: string;
}) {
  const team = useActiveTeam();
  const router = useRouter();
  const item = useQuery(api.library.get, { itemId });
  const setRating = useMutation(api.library.setRating);
  const remove = useMutation(api.library.remove);
  const deleteFiles = useAction(api.files.remove);
  const linkFor = useAction(api.storage.linkFor);
  const [deleting, setDeleting] = useState(false);
  const makeSearchable = useAction(api.library.makeSearchable);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [now, setNow] = useState(0);
  const [find, setFind] = useState(search ?? "");
  // Read the transcript line by line, or as the SRT or WebVTT file it makes.
  const [shown, setShown] = useState<"read" | "srt" | "vtt">("read");
  // The original words, or a translation of them by its language's code.
  const [language, setLanguage] = useState(ORIGINAL);
  // The tab beside the player; until one is picked, the words when there are any.
  const [tab, setTab] = useState<Tab | null>(null);
  const translations = useQuery(api.translations.list, { itemId }) ?? [];
  const translation =
    language === ORIGINAL ? null : (translations.find((one) => one.language === language) ?? null);

  const self = useMemo(() => (item ? [{ _id: item._id, kind: item.kind }] : undefined), [item]);
  const links = useLibraryLinks(team.id, self);
  const childLinks = useLibraryLinks(team.id, item?.children);
  const url = item ? links.get(item._id) : undefined;

  // Opened at a moment from search: start there once the file can play.
  const started = useRef(false);
  useEffect(() => {
    const element = media.current;
    if (!element || !url || at === undefined || started.current) return;
    const go = () => {
      started.current = true;
      element.currentTime = at;
    };
    if (element.readyState > 0) go();
    else element.addEventListener("loadedmetadata", go, { once: true });
  }, [url, at]);

  const words = find
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 1);
  const pieces = item?.pieces ?? [];
  const shownPieces =
    words.length > 0
      ? pieces.filter((piece) => words.some((word) => piece.text.toLowerCase().includes(word)))
      : pieces;
  const playing = pieces.findLast((piece) => piece.start <= now)?.start;

  async function copyLink(uploadId: Id<"uploads">) {
    try {
      await navigator.clipboard.writeText(await linkFor({ uploadId }));
      toast.success("Link copied. It works for seven days.");
    } catch {
      toast.error("The link could not be copied.");
    }
  }

  function seek(seconds: number) {
    const element = media.current;
    if (!element) return;
    element.currentTime = seconds;
    void element.play().catch(() => {});
  }

  if (item === undefined) {
    return <Skeleton className="h-96 rounded-xl" />;
  }
  if (item === null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm">This file is no longer in the library.</p>
        <Button asChild variant="secondary" size="sm">
          <Link href="/library">Back to the library</Link>
        </Button>
      </div>
    );
  }

  async function sendToSearch() {
    try {
      const sent = await makeSearchable({ organizationId: team.id, itemIds: [itemId] });
      if (sent === 0) toast.error("This file could not be sent to your toolkit.");
    } catch (caught) {
      toast.error(errorMessage(caught, "The file could not be sent."));
    }
  }

  const speaks = item.kind === "video" || item.kind === "audio";
  // A caption file (SRT, WebVTT, ASS) shows its lines the same way; a line opens the video
  // it captions at that moment.
  const captions = item.captionFormat !== null;
  const captionsFor = item.captionsFor;
  const hasWords = speaks || captions;
  const hasStoryboard = item.source === "upload" && speaks && !captions;
  const wordsReady = item.searchable === "ready" && pieces.length > 0;
  // Details come first: what the file is, then its words and what was made from it.
  // Opened from a search (at a moment, or for words) it goes straight to the words.
  const openTab =
    tab ?? (hasWords && (at !== undefined || search !== undefined) ? "words" : "details");

  // What is being done with the file in the background, each with its own colour.
  const said = transcriptState(item.searchable);
  const works: Work[] = [];
  if (hasWords) {
    works.push({
      label: captions ? "Caption lines" : "Transcript and SRT",
      state: said,
      note:
        said === "ready" && pieces.length === 0
          ? captions
            ? "No lines in it"
            : "Nothing was said"
          : said === "waiting"
            ? "Not asked for"
            : undefined,
      onOpen: () => setTab("words"),
    });
  }
  if (hasStoryboard) {
    works.push({
      label: "Storyboard",
      ...(said !== "ready"
        ? { state: "waiting" as const, note: "Waits for the transcript" }
        : item.storyboardDrafted
          ? { state: "ready" as const }
          : pieces.length === 0
            ? { state: "waiting" as const, note: "Nothing was said" }
            : { state: "working" as const }),
      onOpen: () => setTab("storyboard"),
    });
  }
  for (const one of translations) {
    works.push({
      label: `${one.name} subtitles`,
      state: one.status,
      onOpen: () => {
        setLanguage(one.language);
        setTab("words");
      },
    });
  }
  if (item.broll?.looked) {
    works.push({
      label: "B-Roll check",
      state: item.broll.looked,
      onOpen: () => setTab("details"),
    });
  }

  const player =
    item.kind === "video" ? (
      url ? (
        <video
          ref={media}
          src={url}
          controls
          playsInline
          preload="metadata"
          onTimeUpdate={(event) => setNow(event.currentTarget.currentTime)}
          className="max-h-[60dvh] w-full rounded-xl bg-black lg:max-h-[calc(100dvh-16rem)]"
          data-testid="library-player"
        />
      ) : (
        <div className="bg-muted aspect-video w-full animate-pulse rounded-xl" />
      )
    ) : item.kind === "audio" ? (
      <div className="bg-surface flex aspect-[3/1] w-full flex-col items-center justify-center gap-5 rounded-xl p-6">
        <AudioLines className="text-muted-foreground size-10" aria-hidden="true" />
        {url && (
          <audio
            ref={media}
            src={url}
            controls
            preload="metadata"
            onTimeUpdate={(event) => setNow(event.currentTarget.currentTime)}
            className="w-full max-w-lg"
            data-testid="library-player"
          />
        )}
      </div>
    ) : (
      <UploadFrame
        kind={item.kind}
        url={url}
        className="max-h-[calc(100dvh-16rem)] min-h-60 rounded-xl [aspect-ratio:auto]"
      />
    );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href="/library">
              <ArrowLeft />
              Library
            </Link>
          </Button>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <ShortId id={item.shortId} className="shrink-0" />
              <Title itemId={item._id} title={item.title} />
            </div>
            <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-sm">
              <span>{KIND_LABELS[item.kind]}</span>
              <span aria-hidden="true">·</span>
              <span>{sourceLabel(item)}</span>
              {item.parent && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    from{" "}
                    <Link
                      href={`/library/${item.parent._id}`}
                      className="text-foreground underline-offset-4 hover:underline"
                    >
                      {item.parent.shortId} {item.parent.title}
                    </Link>
                  </span>
                </>
              )}
              {item.details?.duration !== undefined && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{formatMoment(item.details.duration)}</span>
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {item.upload && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => void copyLink(item.upload!._id)}
              >
                <Copy />
                Copy link
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setDeleting(true)}
            >
              <Trash2 />
              Delete
            </Button>
          </div>
        </div>
        <WorkRow works={works} />
      </header>

      <Tabs value={openTab} onValueChange={(next) => setTab(next as Tab)}>
        <div
          className={cn(
            "grid gap-6",
            openTab !== "storyboard" &&
              "lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_28rem]",
          )}
        >
          {/* The player stays put while the tabs beside it change; the storyboard has
              its own clips, so it takes the whole width. */}
          <div className={cn("min-w-0", openTab === "storyboard" && "hidden")}>{player}</div>
          <div className="flex min-w-0 flex-col gap-4">
            <TabsList variant="line" className="h-9 max-w-full justify-start overflow-x-auto">
              <TabsTrigger value="details">Details</TabsTrigger>
              {hasWords && (
                <TabsTrigger value="words">{captions ? "Captions" : "Transcript"}</TabsTrigger>
              )}
              {hasStoryboard && <TabsTrigger value="storyboard">Storyboard</TabsTrigger>}
              {item.children.length > 0 && (
                <TabsTrigger value="made">
                  Made from this
                  <span className="text-muted-foreground tabular-nums">{item.children.length}</span>
                </TabsTrigger>
              )}
            </TabsList>
            <div
              className={cn(
                "min-w-0",
                // Beside the player on a wide screen the panel scrolls on its own, so the
                // page itself does not.
                openTab !== "storyboard" &&
                  "lg:max-h-[calc(100dvh-19rem)] lg:overflow-y-auto lg:pr-1",
              )}
            >
              {hasWords && (
                <TabsContent value="words">
                  <section
                    className="flex flex-col gap-3"
                    aria-label={captions ? "What the captions say" : "What was said"}
                  >
                    {captions && captionsFor && (
                      <p className="text-muted-foreground text-sm">
                        Captions for{" "}
                        <Link
                          href={`/library/${captionsFor._id}`}
                          className="text-foreground underline-offset-4 hover:underline"
                        >
                          {captionsFor.shortId} {captionsFor.title}
                        </Link>
                        . Pick a line to play it there.
                      </p>
                    )}
                    {wordsReady && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Segmented
                          aria-label="Show the words as"
                          className="w-auto"
                          value={shown}
                          onValueChange={setShown}
                          options={[
                            { value: "read", label: "Text" },
                            { value: "srt", label: "SRT" },
                            { value: "vtt", label: "VTT" },
                          ]}
                        />
                        <LanguagePicker
                          itemId={item._id}
                          translations={translations}
                          value={translation ? translation.language : ORIGINAL}
                          onValueChange={setLanguage}
                        />
                        {translation ? (
                          translation.status === "ready" && (
                            <TranscriptDownload
                              pieces={translation.cues}
                              title={item.title}
                              language={translation.language}
                            />
                          )
                        ) : (
                          <TranscriptDownload pieces={pieces} title={item.title} />
                        )}
                      </div>
                    )}
                    {wordsReady && translation && (
                      <TranslatedWords
                        itemId={item._id}
                        translation={translation}
                        shown={shown}
                        now={now}
                        onSeek={captions ? undefined : seek}
                        onRemoved={() => setLanguage(ORIGINAL)}
                      />
                    )}
                    {!translation && wordsReady && shown === "read" && (
                      <Input
                        value={find}
                        onChange={(event) => setFind(event.target.value)}
                        placeholder="Find in this file"
                        aria-label="Find in what was said"
                        className="h-8 w-full"
                      />
                    )}
                    {translation ? null : wordsReady && shown !== "read" ? (
                      <SubtitleText pieces={pieces} format={shown} />
                    ) : item.searchable === "ready" ? (
                      shownPieces.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          {pieces.length === 0
                            ? captions
                              ? "There are no captions in this file."
                              : "Nothing was said in this file."
                            : captions
                              ? "Not in these captions."
                              : "Not said in this file."}
                        </p>
                      ) : (
                        <ol className="-mx-3 flex flex-col gap-0.5" data-testid="transcript">
                          {shownPieces.map((piece) => {
                            const line = (
                              <>
                                <span className="text-primary w-12 shrink-0 font-medium tabular-nums">
                                  {formatMoment(piece.start)}
                                </span>
                                <span>{marked(piece.text, words)}</span>
                              </>
                            );
                            const look = "flex w-full gap-3 rounded-lg px-3 py-2 text-left text-sm";
                            return (
                              <li key={piece.start}>
                                {!captions ? (
                                  <button
                                    type="button"
                                    onClick={() => seek(piece.start)}
                                    className={cn(
                                      look,
                                      "hover:bg-surface",
                                      playing === piece.start && "bg-surface",
                                    )}
                                  >
                                    {line}
                                  </button>
                                ) : captionsFor ? (
                                  <Link
                                    href={`/library/${captionsFor._id}?t=${Math.floor(piece.start)}`}
                                    className={cn(look, "hover:bg-surface")}
                                  >
                                    {line}
                                  </Link>
                                ) : (
                                  <div className={look}>{line}</div>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      )
                    ) : said === "working" ? (
                      // Everything brought in is transcribed by itself; an older file is caught up.
                      <p className="text-muted-foreground text-sm">
                        {captions
                          ? "Reading the caption file."
                          : "Being transcribed on your toolkit. The words, SRT and VTT show here when it is done."}
                      </p>
                    ) : (
                      <div className="bg-surface flex flex-col items-start gap-3 rounded-xl p-5">
                        <p className="text-sm">
                          {item.searchable === "failed"
                            ? `The last try did not work${item.transcriptError ? `: ${item.transcriptError}` : "."}`
                            : "The caption file has not been read yet."}
                        </p>
                        <Button size="sm" variant="secondary" onClick={() => void sendToSearch()}>
                          <Bot />
                          {item.searchable === "failed" ? "Try again" : "Read it"}
                        </Button>
                        {!captions && (
                          <p className="text-muted-foreground text-xs">
                            Transcribed once on your own toolkit, with no AI tokens spent.
                          </p>
                        )}
                      </div>
                    )}
                  </section>
                </TabsContent>
              )}

              {hasStoryboard && (
                <TabsContent value="storyboard">
                  <section className="flex flex-col gap-3" aria-label="Storyboard">
                    <p className="text-muted-foreground text-sm">
                      Drafted from what was said: a line for every sentence, each with its own clip,
                      with pauses and retakes left out. Add it to a project to gather it with other
                      uploads.
                    </p>
                    <UploadStoryboard
                      libraryItemId={item._id}
                      transcribed={item.searchable === "ready"}
                    />
                  </section>
                </TabsContent>
              )}

              {item.children.length > 0 && (
                <TabsContent value="made">
                  <section aria-label="Made from this">
                    <ul className="grid grid-cols-2 gap-x-3 gap-y-4">
                      {item.children.map((child) => (
                        <li key={child._id} className="flex min-w-0 flex-col gap-2">
                          <Link
                            href={`/library/${child._id}`}
                            className="overflow-hidden rounded-lg"
                            aria-label={`Open ${child.shortId} ${child.title}`}
                          >
                            <UploadFrame kind={child.kind} url={childLinks.get(child._id)} />
                          </Link>
                          <div className="flex min-w-0 items-center gap-2">
                            <ShortId id={child.shortId} />
                            <span className="truncate text-sm">{child.title}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                </TabsContent>
              )}

              <TabsContent value="details">
                <div className="flex flex-col gap-6">
                  <dl className="flex flex-col gap-2.5">
                    <ClientFact itemId={item._id} teamId={team.id} client={item.client} />
                    <Fact label="Kind">{KIND_LABELS[item.kind]}</Fact>
                    <Fact label="Source">{sourceLabel(item)}</Fact>
                    {item.made > 0 && (
                      <Fact label="Made from this">
                        {item.made === 1 ? "1 file" : `${item.made} files`}
                      </Fact>
                    )}
                    {item.upload?.sharedBy && <Fact label="Shared by">{item.upload.sharedBy}</Fact>}
                    <Fact label="Added">
                      {new Date(item._creationTime).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </Fact>
                  </dl>
                  {item.details && <FileFacts details={item.details} />}

                  <div className="flex flex-col items-start gap-2">
                    <h2 className="text-sm font-medium">Run an automation on it</h2>
                    <p className="text-muted-foreground text-xs">
                      Automations set to start on an upload run by themselves. This runs one of the
                      others on this file now.
                    </p>
                    <RunMenu itemId={item._id} teamId={team.id} />
                  </div>

                  <FileRuns itemId={item._id} />

                  <div className="flex flex-col gap-2">
                    <h2 className="text-sm font-medium">Stars</h2>
                    <StarRating
                      size="md"
                      value={item.rating}
                      label="Stars"
                      onChange={(rating) => void setRating({ itemId: item._id, rating })}
                    />
                    <p className="text-muted-foreground text-xs">
                      Give stars once it is out, so the ones that did well are easy to find again.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <h2 className="text-sm font-medium">Tags</h2>
                    <TagEditor itemId={item._id} tags={item.tags} />
                  </div>

                  {item.broll && (
                    <BrollUse itemId={item._id} organizationId={team.id} broll={item.broll} />
                  )}

                  {item.upload && item.kind === "video" && item.details?.hasVideo !== false && (
                    <CopyLookFromUpload
                      upload={{ _id: item.upload._id, fileName: item.upload.fileName }}
                    />
                  )}
                </div>
              </TabsContent>
            </div>
          </div>
        </div>
      </Tabs>
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="break-words">Delete {item.title}?</DialogTitle>
            <DialogDescription>
              {item.key
                ? "This removes it from your storage and the library for good. It cannot be undone."
                : "This takes it out of the library for good. It cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDeleting(false);
                // A file in the team's storage goes from there, and the library follows it.
                const done = item.key
                  ? deleteFiles({ organizationId: team.id, keys: [item.key] }).then((result) => {
                      if (result.leftBehind > 0) throw new Error("left behind");
                    })
                  : remove({ itemId: item._id });
                void done.then(
                  () => {
                    toast.success(`Deleted ${item.title}.`);
                    router.push("/library");
                  },
                  (caught) =>
                    toast.error(errorMessage(caught, `${item.title} could not be deleted.`)),
                );
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const BROLL_USES = [
  { value: "auto", label: "When it looks like B-Roll" },
  { value: "yes", label: "Always" },
  { value: "no", label: "Never" },
] as const;

/** Whether Add B-Roll may lay this video over others, by hand or by how it looks. */
function BrollUse({
  itemId,
  organizationId,
  broll,
}: {
  itemId: Id<"libraryItems">;
  organizationId: string;
  broll: {
    use: "auto" | "yes" | "no";
    looked: "working" | "ready" | "failed" | null;
    looksLike: boolean | null;
    usable: boolean;
  };
}) {
  const setUse = useMutation(api.broll.setUse);
  const note =
    broll.use !== "auto"
      ? broll.usable
        ? "Add B-Roll can use it as a cutaway."
        : "Add B-Roll leaves it out."
      : broll.looked === "ready"
        ? broll.looksLike
          ? "It has no talking face, so Add B-Roll can use it as a cutaway."
          : "It looks like someone talking, so Add B-Roll leaves it out."
        : broll.looked === "working"
          ? "Being looked at now."
          : "Not looked at yet. It will be shortly, by itself.";
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium" id="broll-use-label">
        Use as B-Roll
      </h2>
      <Select
        value={broll.use}
        onValueChange={(use) =>
          void setUse({ organizationId, itemId, use: use as "auto" | "yes" | "no" }).catch(
            (caught) => toast.error(errorMessage(caught, "That could not be changed.")),
          )
        }
      >
        <SelectTrigger className="w-full" aria-labelledby="broll-use-label">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BROLL_USES.map((one) => (
            <SelectItem key={one.value} value={one.value}>
              {one.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs">{note}</p>
    </div>
  );
}
