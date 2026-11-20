"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { describeFileDetails, formatMoment } from "@ncat-dash/automation-core";
import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowLeft, AudioLines, Bot, Play, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { UploadFrame } from "@/components/uploads/upload-media";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { KIND_LABELS, ShortId, sourceLabel, StarRating, useLibraryLinks } from "./library-media";
import { PickList } from "@/components/ui/pick-list";

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
      await rename({ itemId, title: next });
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
        <Button disabled={running}>
          <Play />
          Run an automation on this
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
  const makeSearchable = useAction(api.library.makeSearchable);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [now, setNow] = useState(0);
  const [find, setFind] = useState(search ?? "");

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

  return (
    <>
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/library">
            <ArrowLeft />
            Library
          </Link>
        </Button>
      </div>
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-8">
          {item.kind === "video" ? (
            url ? (
              <video
                ref={media}
                src={url}
                controls
                playsInline
                preload="metadata"
                onTimeUpdate={(event) => setNow(event.currentTarget.currentTime)}
                className="max-h-[70vh] w-full rounded-xl bg-black"
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
              className="rounded-xl [aspect-ratio:auto] min-h-60"
            />
          )}

          {(speaks || captions) && (
            <section
              className="flex flex-col gap-3"
              aria-label={captions ? "What the captions say" : "What was said"}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h2 className="text-base font-semibold">
                    {captions ? "What the captions say" : "What was said"}
                  </h2>
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
                </div>
                {item.searchable === "ready" && (
                  <Input
                    value={find}
                    onChange={(event) => setFind(event.target.value)}
                    placeholder="Find in this file"
                    aria-label="Find in what was said"
                    className="h-8 w-56"
                  />
                )}
              </div>
              {item.searchable === "ready" ? (
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
                  <ol
                    className="flex max-h-[32rem] flex-col gap-0.5 overflow-y-auto"
                    data-testid="transcript"
                  >
                    {shownPieces.map((piece) => {
                      const line = (
                        <>
                          <span className="text-primary w-14 shrink-0 font-medium tabular-nums">
                            {formatMoment(piece.start)}
                          </span>
                          <span>{marked(piece.text, words)}</span>
                        </>
                      );
                      const look = "flex w-full gap-4 rounded-lg px-3 py-2 text-left text-sm";
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
              ) : item.searchable === "working" ? (
                <p className="text-muted-foreground text-sm">
                  {captions
                    ? "Reading the caption file."
                    : "Being transcribed on your toolkit. The words show here when it is done."}
                </p>
              ) : (
                <div className="bg-surface flex flex-col items-start gap-3 rounded-xl p-5">
                  <p className="text-sm">
                    {item.searchable === "failed"
                      ? `The last try did not work${item.transcriptError ? `: ${item.transcriptError}` : "."}`
                      : captions
                        ? "The caption file has not been read yet."
                        : "Make this file searchable to find any moment by what was said in it."}
                  </p>
                  <Button size="sm" variant="secondary" onClick={() => void sendToSearch()}>
                    <Bot />
                    {item.searchable === "failed"
                      ? "Try again"
                      : captions
                        ? "Read it"
                        : "Make searchable"}
                  </Button>
                  {!captions && (
                    <p className="text-muted-foreground text-xs">
                      Transcribed once on your own toolkit, with no AI tokens spent.
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          {item.children.length > 0 && (
            <section className="flex flex-col gap-3" aria-label="Made from this">
              <h2 className="text-base font-semibold">Made from this</h2>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-4 gap-y-5">
                {item.children.map((child) => (
                  <li key={child._id} className="flex flex-col gap-2">
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
          )}
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-6 lg:sticky lg:top-6 lg:w-80">
          <div className="flex flex-col gap-2">
            <ShortId id={item.shortId} className="self-start" />
            <Title itemId={item._id} title={item.title} />
          </div>

          <RunMenu itemId={item._id} teamId={team.id} />

          <dl className="flex flex-col gap-2.5">
            <ClientFact itemId={item._id} teamId={team.id} client={item.client} />
            <Fact label="Kind">{KIND_LABELS[item.kind]}</Fact>
            <Fact label="Source">{sourceLabel(item)}</Fact>
            {item.parent && (
              <Fact label="Made from">
                <Link href={`/library/${item.parent._id}`} className="hover:underline">
                  {item.parent.shortId} {item.parent.title}
                </Link>
              </Fact>
            )}
            {item.made > 0 && (
              <Fact label="Made from this">
                {item.made === 1 ? "1 file" : `${item.made} files`}
              </Fact>
            )}
            {item.details && <Fact label="File">{describeFileDetails(item.details)}</Fact>}
            <Fact label="Added">
              {new Date(item._creationTime).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </Fact>
          </dl>

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

          {item.broll && <BrollUse itemId={item._id} organizationId={team.id} broll={item.broll} />}

          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground self-start"
            onClick={() => {
              void remove({ itemId: item._id }).then(() => router.push("/library"));
            }}
          >
            <Trash2 />
            Take out of the library
          </Button>
          <p className="text-muted-foreground -mt-4 text-xs">The file itself stays in Files.</p>
        </aside>
      </div>
    </>
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
          : "Not looked at yet. Make it searchable and it will be.";
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
