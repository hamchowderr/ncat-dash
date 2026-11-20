"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatMoment } from "@ncat-dash/automation-core";
import { useAction, useMutation, useQuery } from "convex/react";
import { Bot, Columns3, LayoutGrid, List, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { UploadFrame } from "@/components/uploads/upload-media";
import { Button } from "@/components/ui/button";
import { PageTourButton, StartPageTour } from "@/components/tours/page-tour";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import {
  KIND_LABELS,
  ShortId,
  sourceLabel,
  StarRating,
  useLibraryLinks,
  type LibraryKind,
} from "./library-media";
import { SegmentedButton, SegmentedGroup } from "@/components/ui/segmented";

type Item = {
  _id: Id<"libraryItems">;
  _creationTime: number;
  shortId: string;
  kind: LibraryKind;
  source: "upload" | "automation";
  title: string;
  tags: string[];
  rating: number | null;
  duration: number | null;
  automationName: string | null;
  parent: { _id: Id<"libraryItems">; shortId: string; title: string } | null;
  client: { _id: Id<"clients">; name: string } | null;
  made: number;
  searchable: "no" | "working" | "ready" | "failed";
};

type Shown = "all" | "videos" | "clips" | "audio" | "images" | "other";

const SHOWN: [Shown, string][] = [
  ["all", "All"],
  ["videos", "Videos"],
  ["clips", "Clips"],
  ["audio", "Sound"],
  ["images", "Pictures"],
  ["other", "Other files"],
];

function shows(item: Item, shown: Shown): boolean {
  switch (shown) {
    case "all":
      return true;
    case "videos":
      return item.kind === "video" && item.source === "upload";
    case "clips":
      return item.kind === "video" && item.source === "automation";
    case "audio":
      return item.kind === "audio";
    case "images":
      return item.kind === "image";
    case "other":
      return item.kind === "other";
  }
}

const TEAM_OWN = "team";

// Columns of the list, in order, and whether each shows until someone changes it.
const COLUMNS = [
  ["id", "ID", true],
  ["client", "Client", true],
  ["kind", "Kind", false],
  ["source", "Source", true],
  ["from", "Made from", true],
  ["length", "Length", true],
  ["tags", "Tags", true],
  ["stars", "Stars", true],
  ["searchable", "Searchable", false],
  ["added", "Added", true],
] as const;
type Column = (typeof COLUMNS)[number][0];

// The layout and columns are each viewer's own, kept in the browser where it allows.
function remembered<T>(key: string, fallback: T) {
  let chosen: T | null = null;
  const watchers = new Set<() => void>();
  let cache: { raw: string | null; value: T } | null = null;
  return {
    read(): T {
      if (chosen !== null) return chosen;
      try {
        const raw = window.localStorage.getItem(key);
        if (cache && cache.raw === raw) return cache.value;
        const value = raw === null ? fallback : (JSON.parse(raw) as T);
        cache = { raw, value };
        return value;
      } catch {
        return fallback;
      }
    },
    server: () => fallback,
    watch(onChange: () => void) {
      watchers.add(onChange);
      return () => watchers.delete(onChange);
    },
    choose(next: T) {
      chosen = next;
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // A nicety; the page works without it.
      }
      watchers.forEach((onChange) => onChange());
    },
  };
}

const layoutChoice = remembered<"tiles" | "list">("library-layout", "tiles");
const columnChoice = remembered<Column[]>(
  "library-columns",
  COLUMNS.filter(([, , on]) => on).map(([id]) => id),
);

function lengthOf(seconds: number | null): string {
  return seconds === null ? "" : formatMoment(seconds);
}

const added = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** A title that turns into a text box when clicked, and saves when left. */
function InlineTitle({ item }: { item: Item }) {
  const rename = useMutation(api.library.rename);
  const [editing, setEditing] = useState<string | null>(null);
  async function save() {
    const next = editing?.trim();
    setEditing(null);
    if (!next || next === item.title) return;
    try {
      await rename({ itemId: item._id, title: next });
    } catch (caught) {
      toast.error(errorMessage(caught, "The name could not be changed."));
    }
  }
  if (editing !== null) {
    return (
      <input
        autoFocus
        value={editing}
        aria-label={`Name of ${item.shortId}`}
        onChange={(event) => setEditing(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setEditing(null);
        }}
        className="focus-visible:ring-ring/50 bg-background w-full min-w-40 rounded-md px-1.5 py-0.5 text-sm outline-none focus-visible:ring-2"
      />
    );
  }
  return (
    <button
      type="button"
      className="hover:bg-muted max-w-full truncate rounded-md px-1.5 py-0.5 text-left text-sm font-medium"
      onClick={() => setEditing(item.title)}
      aria-label={`Rename ${item.shortId} ${item.title}`}
    >
      {item.title}
    </button>
  );
}

function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span key={tag} className="bg-muted rounded-md px-1.5 py-0.5 text-xs">
          {tag}
        </span>
      ))}
    </span>
  );
}

function SearchableNote({ state }: { state: Item["searchable"] }) {
  const text = { no: "Not yet", working: "Working…", ready: "Yes", failed: "Failed" }[state];
  return (
    <span
      className={cn("text-xs", state === "failed" ? "text-destructive" : "text-muted-foreground")}
    >
      {text}
    </span>
  );
}

function ItemList({
  items,
  links,
  columns,
}: {
  items: Item[];
  links: Map<Id<"libraryItems">, string>;
  // Only the columns that apply to this team: Client is left out until it has clients.
  columns: Column[];
}) {
  const router = useRouter();
  const setRating = useMutation(api.library.setRating);
  const on = (column: Column) => columns.includes(column);
  return (
    <div className="bg-surface overflow-x-auto rounded-xl">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-24">
              <span className="sr-only">Preview</span>
            </TableHead>
            {on("id") && <TableHead className="w-16">ID</TableHead>}
            <TableHead>Name</TableHead>
            {on("client") && <TableHead>Client</TableHead>}
            {on("kind") && <TableHead>Kind</TableHead>}
            {on("source") && <TableHead>Source</TableHead>}
            {on("from") && <TableHead>Made from</TableHead>}
            {on("length") && <TableHead className="text-right">Length</TableHead>}
            {on("tags") && <TableHead>Tags</TableHead>}
            {on("stars") && <TableHead>Stars</TableHead>}
            {on("searchable") && <TableHead>Searchable</TableHead>}
            {on("added") && <TableHead className="text-right">Added</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item._id} data-testid="library-row">
              <TableCell>
                <button
                  type="button"
                  className="block w-20 overflow-hidden rounded-md"
                  aria-label={`Open ${item.shortId} ${item.title}`}
                  onClick={() => router.push(`/library/${item._id}`)}
                >
                  <UploadFrame
                    kind={item.kind}
                    url={links.get(item._id)}
                    className="[&_svg]:size-4"
                  />
                </button>
              </TableCell>
              {on("id") && (
                <TableCell>
                  <ShortId id={item.shortId} />
                </TableCell>
              )}
              <TableCell className="max-w-72">
                <InlineTitle item={item} />
              </TableCell>
              {on("client") && <TableCell className="text-sm">{item.client?.name ?? ""}</TableCell>}
              {on("kind") && <TableCell className="text-sm">{KIND_LABELS[item.kind]}</TableCell>}
              {on("source") && (
                <TableCell className="text-muted-foreground text-sm">{sourceLabel(item)}</TableCell>
              )}
              {on("from") && (
                <TableCell className="text-sm">
                  {item.parent ? (
                    <Link
                      href={`/library/${item.parent._id}`}
                      className="hover:underline"
                      title={item.parent.title}
                    >
                      {item.parent.shortId}
                    </Link>
                  ) : null}
                </TableCell>
              )}
              {on("length") && (
                <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                  {lengthOf(item.duration)}
                </TableCell>
              )}
              {on("tags") && (
                <TableCell>
                  <Tags tags={item.tags} />
                </TableCell>
              )}
              {on("stars") && (
                <TableCell>
                  <StarRating
                    value={item.rating}
                    label={`Stars for ${item.shortId}`}
                    onChange={(rating) => void setRating({ itemId: item._id, rating })}
                  />
                </TableCell>
              )}
              {on("searchable") && (
                <TableCell>
                  <SearchableNote state={item.searchable} />
                </TableCell>
              )}
              {on("added") && (
                <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                  {added.format(item._creationTime)}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ItemTiles({ items, links }: { items: Item[]; links: Map<Id<"libraryItems">, string> }) {
  const [hovered, setHovered] = useState<Id<"libraryItems"> | null>(null);
  return (
    <ul className="reveal grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-5 gap-y-6">
      {items.map((item) => (
        <li
          key={item._id}
          className="group flex flex-col gap-2"
          data-testid="library-tile"
          onPointerEnter={() => setHovered(item._id)}
          onPointerLeave={() => setHovered((current) => (current === item._id ? null : current))}
        >
          <Link
            href={`/library/${item._id}`}
            className="focus-visible:ring-ring/50 overflow-hidden rounded-xl outline-none focus-visible:ring-3"
            aria-label={`Open ${item.shortId} ${item.title}`}
          >
            <UploadFrame
              kind={item.kind}
              url={links.get(item._id)}
              hovering={hovered === item._id}
              className="transition-transform duration-300 ease-out group-hover:scale-[1.02]"
            />
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <ShortId id={item.shortId} />
            <span className="truncate text-sm font-medium">{item.title}</span>
          </div>
          <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
            <span className="truncate">
              {[
                item.client?.name ?? null,
                sourceLabel(item),
                item.parent ? `from ${item.parent.shortId}` : null,
                item.made > 0 ? `${item.made} made from it` : null,
                lengthOf(item.duration) || null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <StarRating value={item.rating} label={`Stars for ${item.shortId}`} />
          </div>
          <Tags tags={item.tags} />
        </li>
      ))}
    </ul>
  );
}

type Hit = Item & { moments: { start: number; text: string }[] };

/** Search results: each file, and under it the moments it was said, to jump straight to. */
function SearchResults({
  text,
  hits,
  links,
}: {
  text: string;
  hits: Hit[] | undefined;
  links: Map<Id<"libraryItems">, string>;
}) {
  if (hits === undefined) return <Skeleton className="h-40 rounded-xl" />;
  if (hits.length === 0) {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        Nothing matches &ldquo;{text}&rdquo;. Only files made searchable are searched for what was
        said in them.
      </p>
    );
  }
  const query = encodeURIComponent(text);
  return (
    <ul className="flex flex-col gap-3" aria-label="Search results">
      {hits.map((hit) => (
        <li
          key={hit._id}
          className="bg-surface flex flex-col gap-4 rounded-xl p-4 sm:flex-row"
          data-testid="library-hit"
        >
          <Link
            href={`/library/${hit._id}?q=${query}`}
            className="w-full shrink-0 overflow-hidden rounded-lg sm:w-48"
            aria-label={`Open ${hit.shortId} ${hit.title}`}
          >
            <UploadFrame kind={hit.kind} url={links.get(hit._id)} />
          </Link>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <ShortId id={hit.shortId} />
              <Link
                href={`/library/${hit._id}?q=${query}`}
                className="truncate text-sm font-medium hover:underline"
              >
                {hit.title}
              </Link>
            </div>
            <p className="text-muted-foreground text-xs">
              {[sourceLabel(hit), hit.parent ? `from ${hit.parent.shortId}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {hit.moments.length > 0 && (
              <ul className="flex flex-col gap-1">
                {hit.moments.map((moment) => (
                  <li key={moment.start}>
                    <Link
                      href={`/library/${hit._id}?t=${Math.floor(moment.start)}&q=${query}`}
                      className="hover:bg-muted flex gap-3 rounded-md px-2 py-1.5 text-sm"
                    >
                      <span className="text-primary shrink-0 font-medium tabular-nums">
                        {formatMoment(moment.start)}
                      </span>
                      <span className="text-muted-foreground">{moment.text}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Tags tags={hit.tags} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function LibraryView() {
  const team = useActiveTeam();
  const library = useQuery(api.library.list, { organizationId: team.id });
  const fill = useMutation(api.library.fill);
  const setSearchNewFiles = useMutation(api.library.setSearchNewFiles);
  const makeSearchable = useAction(api.library.makeSearchable);
  const layout = useSyncExternalStore(layoutChoice.watch, layoutChoice.read, layoutChoice.server);
  const columns = useSyncExternalStore(columnChoice.watch, columnChoice.read, columnChoice.server);
  const [typed, setTyped] = useState("");
  const [text, setText] = useState("");
  const [shown, setShown] = useState<Shown>("all");
  const [tag, setTag] = useState<string | null>(null);
  // A client's ID, TEAM_OWN for the team's own files, or null for every file.
  const [client, setClient] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Searches once typing pauses, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => setText(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);

  // Files the team had before the library are brought in the first time it is opened.
  const filled = library?.filled;
  useEffect(() => {
    if (filled === false) void fill({ organizationId: team.id }).catch(() => {});
  }, [filled, fill, team.id]);

  const hits = useQuery(api.library.search, text ? { organizationId: team.id, text } : "skip");
  const items = useMemo(
    () =>
      (library?.items ?? []).filter(
        (item) =>
          shows(item, shown) &&
          (tag === null || item.tags.includes(tag)) &&
          (client === null || (item.client?._id ?? TEAM_OWN) === client),
      ),
    [library, shown, tag, client],
  );
  const clients = library?.clients ?? [];
  const chosenClient =
    client === TEAM_OWN ? "Your team" : clients.find((one) => one._id === client)?.name;
  // Each team sees a Client column and filter only once it has clients.
  const columnsHere = COLUMNS.filter(([id]) => id !== "client" || clients.length > 0);
  const columnsOn = columns.filter((id) => columnsHere.some(([one]) => one === id));
  const onScreen = text ? hits : items;
  const links = useLibraryLinks(team.id, onScreen);

  const waiting = (library?.items ?? []).filter(
    (item) =>
      (item.kind === "video" || item.kind === "audio") &&
      (item.searchable === "no" || item.searchable === "failed"),
  );

  async function searchWaiting() {
    setSending(true);
    try {
      const batch = waiting.slice(0, 25).map((item) => item._id);
      const sent = await makeSearchable({ organizationId: team.id, itemIds: batch });
      toast.success(
        sent === 1
          ? "1 file is being transcribed on your toolkit."
          : `${sent} files are being transcribed on your toolkit.`,
      );
    } catch (caught) {
      toast.error(errorMessage(caught, "The files could not be sent."));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <StartPageTour tourId="library" ready={library !== undefined} />
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          <p className="text-muted-foreground text-sm">
            Everything your team has, uploads and what your automations made. Each file has a short
            ID, like C12, that you can use with the agent: &ldquo;caption C12&rdquo;.
          </p>
        </div>
        <PageTourButton tourId="library" />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <InputGroup
          data-tour-step-id="tour-library-search"
          className="bg-surface h-10 rounded-xl border-transparent lg:max-w-xl"
        >
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Search what was said, names, tags or an ID"
            aria-label="Search the library"
          />
        </InputGroup>
        {library && (
          <div className="flex flex-1 flex-wrap items-center justify-end gap-x-5 gap-y-2">
            {waiting.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                disabled={sending}
                onClick={() => void searchWaiting()}
              >
                <Bot />
                {waiting.length === 1
                  ? "Make 1 file searchable"
                  : `Make ${Math.min(waiting.length, 25)} files searchable`}
              </Button>
            )}
            <label
              className="flex items-center gap-2 text-sm"
              data-tour-step-id="tour-library-searchable"
            >
              <Switch
                checked={library.searchNewFiles}
                disabled={!library.canChangeSettings}
                onCheckedChange={(on) =>
                  void setSearchNewFiles({ organizationId: team.id, on }).catch((caught) =>
                    toast.error(errorMessage(caught, "The setting could not be changed.")),
                  )
                }
                aria-describedby="search-new-files-note"
              />
              Make new files searchable
            </label>
          </div>
        )}
      </div>
      <p id="search-new-files-note" className="text-muted-foreground -mt-3 text-xs">
        Searchable files are transcribed once on your own toolkit, with no AI tokens spent.
        {library && !library.canChangeSettings && " Only an owner or admin can change this."}
      </p>

      {library === undefined ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : text ? (
        <SearchResults text={text} hits={hits} links={links} />
      ) : library.items.length === 0 ? (
        <div className="bg-surface flex flex-col items-center gap-3 rounded-xl p-10 text-center">
          <p className="text-sm font-medium">Nothing in the library yet</p>
          <p className="text-muted-foreground max-w-md text-sm">
            Files you upload and the files your automations make show up here. Bringing in your back
            catalogue? Drop all of it on the Uploads page at once.
          </p>
          <Button asChild size="sm">
            <Link href="/uploads">Go to Uploads</Link>
          </Button>
        </div>
      ) : (
        <section className="flex flex-col gap-4" aria-label="Your library">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              className="flex flex-wrap items-center gap-1"
              role="group"
              aria-label="Show"
              data-tour-step-id="tour-library-filters"
            >
              {SHOWN.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={shown === value}
                  onClick={() => setShown(value)}
                  className="choice-chip focus-visible:ring-ring/50 h-8 rounded-lg px-3 text-sm outline-none focus-visible:ring-3"
                >
                  {label}
                </button>
              ))}
              {clients.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant={client ? "secondary" : "ghost"}>
                      {chosenClient ? `Client: ${chosenClient}` : "Client"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
                    <DropdownMenuCheckboxItem
                      checked={client === null}
                      onCheckedChange={() => setClient(null)}
                    >
                      Any client
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={client === TEAM_OWN}
                      onCheckedChange={() => setClient(client === TEAM_OWN ? null : TEAM_OWN)}
                    >
                      Your team
                    </DropdownMenuCheckboxItem>
                    {clients.map((one) => (
                      <DropdownMenuCheckboxItem
                        key={one._id}
                        checked={client === one._id}
                        onCheckedChange={() => setClient(client === one._id ? null : one._id)}
                      >
                        {one.name}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {library.tags.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant={tag ? "secondary" : "ghost"}>
                      {tag ? `Tag: ${tag}` : "Tag"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
                    <DropdownMenuCheckboxItem
                      checked={tag === null}
                      onCheckedChange={() => setTag(null)}
                    >
                      Any tag
                    </DropdownMenuCheckboxItem>
                    {library.tags.map((one) => (
                      <DropdownMenuCheckboxItem
                        key={one}
                        checked={tag === one}
                        onCheckedChange={() => setTag(tag === one ? null : one)}
                      >
                        {one}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm tabular-nums">
                {items.length === 1 ? "1 file" : `${items.length} files`}
              </span>
              {layout === "list" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost">
                      <Columns3 />
                      Columns
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                    {columnsHere.map(([id, label]) => (
                      <DropdownMenuCheckboxItem
                        key={id}
                        checked={columns.includes(id)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={(on) =>
                          columnChoice.choose(
                            COLUMNS.map(([one]) => one).filter((one) =>
                              one === id ? on : columns.includes(one),
                            ),
                          )
                        }
                      >
                        {label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <SegmentedGroup aria-label="Show as">
                {(
                  [
                    ["tiles", LayoutGrid, "Tiles"],
                    ["list", List, "List"],
                  ] as const
                ).map(([value, Icon, label]) => (
                  <SegmentedButton
                    key={value}
                    pressed={layout === value}
                    onClick={() => layoutChoice.choose(value)}
                  >
                    <Icon />
                    {label}
                  </SegmentedButton>
                ))}
              </SegmentedGroup>
            </div>
          </div>
          {items.length === 0 ? (
            <p className="text-muted-foreground py-10 text-center text-sm">
              No files of this kind{tag ? ` tagged ${tag}` : ""}
              {client === TEAM_OWN ? " for your team" : chosenClient ? ` for ${chosenClient}` : ""}.
            </p>
          ) : (
            <div data-tour-step-id="tour-library-items">
              {layout === "tiles" ? (
                <ItemTiles items={items} links={links} />
              ) : (
                <ItemList items={items} links={links} columns={columnsOn} />
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}
