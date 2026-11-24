"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  baseName,
  type BrandFileKey,
  fileDetailColumns,
  type FileDetails,
  folderTrail,
  isFolderKey,
  nameProblem,
  parentOf,
} from "@takewon/automation-core";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Download,
  Ellipsis,
  File as FileIcon,
  FileAudio,
  FileImage,
  FileVideo,
  Folder,
  FolderInput,
  FolderPlus,
  HardDrive,
  Link2,
  type LucideIcon,
  Pencil,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type DragEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { NeedsToolkit } from "@/components/uploads/needs-toolkit";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { errorMessage, formatBytes } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { useSendFile } from "@/lib/send-file";

import { PlatformFits, PlatformTag } from "@/components/platform-tag";

import { FilePreview } from "./file-preview";
import { MoveDialog } from "./move-dialog";

export type FileEntry = {
  key: string;
  name: string;
  size: number;
  lastModified: number;
  kind: "video" | "audio" | "image" | "other";
  uploadId: Id<"uploads"> | null;
  details: FileDetails | null;
  platform: string | null;
  usedAs: BrandFileKey | null;
};
type FolderEntry = { key: string; name: string };
const USED_AS: Record<BrandFileKey, string> = {
  logo: "Your logo",
  music: "Your music",
  card: "Your card",
  intro: "Your intro",
  outro: "Your outro",
};
// The top of the team's own folder. Many teams can share one toolkit's bucket, so the
// bucket's name means nothing to a team; its files are simply "your files".
const TOP_NAME = "Your files";

type Listing = { bucket: string; folders: FolderEntry[]; files: FileEntry[]; next: string | null };
type SortBy = "name" | "size" | "changed";

// Marks a drag that started on a row here, as opposed to files dragged in from the computer.
const ROW_DRAG = "application/x-ncat-files";
const KIND_ICONS: Record<FileEntry["kind"], LucideIcon> = {
  video: FileVideo,
  audio: FileAudio,
  image: FileImage,
  other: FileIcon,
};
const KIND_NAMES: Record<FileEntry["kind"], string> = {
  video: "Video",
  audio: "Audio",
  image: "Image",
  other: "File",
};
const changedAt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Skips the uploads query until the team is known to have storage. */
function connectedArgs(storage: unknown, organizationId: string) {
  return storage ? { organizationId } : "skip";
}

/** A small dialog that asks for one name: a new folder's, or a new one for a file. */
function NameDialog({
  title,
  description,
  action,
  startWith,
  keepEnding,
  onSubmit,
  onClose,
}: {
  title: string;
  description: string;
  action: string;
  startWith: string;
  // A file's ending (".mp4"), put back when the new name is typed without one.
  keepEnding?: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(startWith);
  const field = useRef<HTMLInputElement>(null);
  const addsEnding = Boolean(keepEnding && name.trim() && !name.includes("."));
  const full = addsEnding ? `${name.trim()}${keepEnding}` : name.trim();
  const problem = nameProblem(full);
  const unchanged = full === startWith;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!problem && !unchanged) onSubmit(full);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          // Select the name without its ending, so typing replaces "clip" and keeps ".mp4".
          const input = field.current;
          if (!input) return;
          event.preventDefault();
          input.focus();
          const dot = startWith.lastIndexOf(".");
          const end = dot > 0 ? dot : startWith.length;
          input.setSelectionRange(0, end);
          // The menu this opened from hands focus back a moment later, which selects
          // everything again.
          requestAnimationFrame(() => input.setSelectionRange(0, end));
        }}
      >
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Input
              ref={field}
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Name"
              aria-invalid={name !== "" && problem !== null}
              autoComplete="off"
              spellCheck={false}
            />
            {name !== "" && problem ? (
              <p className="text-destructive text-xs">{problem}</p>
            ) : addsEnding ? (
              <p className="text-muted-foreground text-xs">Saved as {full}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={problem !== null || unchanged}>
              {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FilesView() {
  const team = useActiveTeam();
  const router = useRouter();
  const pathname = usePathname();
  const prefix = useSearchParams().get("path") ?? "";

  const storage = useQuery(api.storage.get, { organizationId: team.id });
  // Where the team posts, so a video lists only the apps it is posted to that it fits.
  const goals = useQuery(api.contentGoals.get, { organizationId: team.id });
  // Live, so a file's details appear as soon as they are read, without reading the folder again.
  const uploads = useQuery(api.storage.listUploads, connectedArgs(storage, team.id));
  // Also live: details of files that did not come through this app, as each is read.
  const readSince = useQuery(
    api.files.detailsIn,
    storage ? { organizationId: team.id, prefix } : "skip",
  );
  const list = useAction(api.files.list);
  const createFolder = useAction(api.files.createFolder);
  const renameEntry = useAction(api.files.rename);
  const moveEntries = useAction(api.files.move);
  const removeEntries = useAction(api.files.remove);
  const linkFor = useAction(api.files.linkFor);
  const startUpload = useAction(api.files.startUpload);
  const sendFile = useSendFile();
  const finishUpload = useMutation(api.storage.finishUpload);
  const removeUpload = useMutation(api.storage.removeUpload);

  const [loaded, setLoaded] = useState<{ prefix: string; listing: Listing } | null>(null);
  const [failed, setFailed] = useState<{ prefix: string; message: string } | null>(null);
  const [version, setVersion] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selection, setSelection] = useState<{ prefix: string; keys: Set<string> }>({
    prefix: "",
    keys: new Set(),
  });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ by: SortBy; down: boolean }>({ by: "name", down: false });
  const [naming, setNaming] = useState<"folder" | { key: string } | null>(null);
  const [moving, setMoving] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState<Record<string, { name: string; percent: number }>>({});
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [draggingIn, setDraggingIn] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const connected = storage !== undefined && storage !== null;
  useEffect(() => {
    if (!connected) return;
    let live = true;
    list({ organizationId: team.id, prefix })
      .then((listing) => {
        if (!live) return;
        setLoaded({ prefix, listing });
        setFailed(null);
      })
      .catch((caught) => {
        if (live) {
          setFailed({ prefix, message: errorMessage(caught, "Your storage could not be read.") });
        }
      });
    return () => {
      live = false;
    };
  }, [connected, list, prefix, team.id, version]);

  const listing = useMemo(() => {
    if (loaded?.prefix !== prefix) return null;
    const fresh = new Map(uploads?.map((upload) => [upload._id, upload.details]));
    const outside = new Map(readSince?.map((row) => [row.key, row.details]));
    return {
      ...loaded.listing,
      files: loaded.listing.files.map((file) =>
        file.details
          ? file
          : {
              ...file,
              details: (file.uploadId ? fresh.get(file.uploadId) : outside.get(file.key)) ?? null,
            },
      ),
    };
  }, [loaded, prefix, uploads, readSince]);
  const error = failed?.prefix === prefix ? failed.message : null;
  const selected = selection.prefix === prefix ? selection.keys : new Set<string>();
  const refresh = () => setVersion((current) => current + 1);

  const rows = useMemo(() => {
    if (!listing) return { folders: [], files: [] };
    const wanted = search.trim().toLowerCase();
    const matches = (name: string) => !wanted || name.toLowerCase().includes(wanted);
    const flip = sort.down ? -1 : 1;
    const byName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    return {
      folders: listing.folders
        .filter((folder) => matches(folder.name))
        .sort((a, b) => byName(a, b) * (sort.by === "name" ? flip : 1)),
      files: listing.files
        .filter((file) => matches(file.name))
        .sort(
          (a, b) =>
            (sort.by === "size"
              ? a.size - b.size
              : sort.by === "changed"
                ? a.lastModified - b.lastModified
                : byName(a, b)) * flip,
        ),
    };
  }, [listing, search, sort]);
  const visibleKeys = [...rows.folders, ...rows.files].map((entry) => entry.key);
  const openedFile = listing?.files.find((file) => file.key === opened);

  function open(folder: string) {
    setSearch("");
    router.push(folder ? `${pathname}?path=${encodeURIComponent(folder)}` : pathname);
  }

  function toggle(key: string, on: boolean) {
    const keys = new Set(selected);
    if (on) keys.add(key);
    else keys.delete(key);
    setSelection({ prefix, keys });
  }

  /** Runs one change, says how it went, and reads the folder again either way. */
  async function change<T>(doing: string, work: () => Promise<T>, done: (result: T) => string) {
    const id = toast.loading(doing);
    try {
      toast.success(done(await work()), { id });
      setSelection({ prefix, keys: new Set() });
    } catch (caught) {
      toast.error(errorMessage(caught, "That did not work. Check your storage and try again."), {
        id,
      });
    }
    refresh();
  }

  const leftBehindNote = (count: number) =>
    count > 0 ? ` ${count} of the old copies could not be removed and are still there.` : "";
  const describe = (keys: string[]) =>
    keys.length === 1 ? `"${baseName(keys[0])}"` : `${keys.length} items`;

  function move(keys: string[], toFolder: string) {
    const staying = keys.filter((key) => parentOf(key) !== toFolder && key !== toFolder);
    if (staying.length === 0) return;
    void change(
      `Moving ${describe(staying)}…`,
      () => moveEntries({ organizationId: team.id, keys: staying, toFolder }),
      (result) =>
        `Moved ${describe(staying)} to ${toFolder ? baseName(toFolder) : TOP_NAME}.${leftBehindNote(result.leftBehind)}`,
    );
  }

  async function upload(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      let uploadId: Id<"uploads"> | null = null;
      try {
        const started = await startUpload({
          organizationId: team.id,
          prefix,
          fileName: file.name,
          contentType: file.type,
          size: file.size,
        });
        const id = (uploadId = started.uploadId);
        setInFlight((current) => ({ ...current, [id]: { name: file.name, percent: 0 } }));
        await sendFile(started, file, (percent) =>
          setInFlight((current) => ({ ...current, [id]: { name: file.name, percent } })),
        );
        await finishUpload({ uploadId: id });
        refresh();
      } catch (caught) {
        if (uploadId) await removeUpload({ uploadId });
        toast.error(
          errorMessage(
            caught,
            `${file.name} did not upload. Check your bucket's CORS rule allows PUT from this site.`,
          ),
        );
      } finally {
        const id = uploadId;
        if (id) {
          setInFlight((current) =>
            Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)),
          );
        }
      }
    }
  }

  async function download(key: string) {
    try {
      const link = document.createElement("a");
      link.href = await linkFor({ organizationId: team.id, key, use: "download" });
      link.click();
    } catch {
      toast.error("The download could not be started.");
    }
  }

  async function copyLink(key: string) {
    try {
      await navigator.clipboard.writeText(
        await linkFor({ organizationId: team.id, key, use: "share" }),
      );
      toast.success("Link copied. It works for seven days.");
    } catch {
      toast.error("The link could not be copied.");
    }
  }

  // Dragging rows: onto a folder row or a folder in the path moves them there.
  function dragStart(event: DragEvent, key: string) {
    const keys = selected.has(key) ? [...selected] : [key];
    event.dataTransfer.setData(ROW_DRAG, JSON.stringify(keys));
    event.dataTransfer.effectAllowed = "move";
  }
  function dropTarget(folder: string) {
    return {
      onDragOver: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes(ROW_DRAG)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropOn(folder);
      },
      onDragLeave: () => setDropOn((current) => (current === folder ? null : current)),
      onDrop: (event: DragEvent) => {
        const data = event.dataTransfer.getData(ROW_DRAG);
        if (!data) return;
        event.preventDefault();
        event.stopPropagation();
        setDropOn(null);
        const keys = (JSON.parse(data) as string[]).filter(
          (key) => !(isFolderKey(key) && folder.startsWith(key)),
        );
        move(keys, folder);
      },
      "data-drop": dropOn === folder,
    };
  }

  const heading = (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
      <p className="text-muted-foreground text-sm">
        Everything in your storage. Rename, move and sort files into folders here, and the
        automations that use them keep working.
      </p>
    </div>
  );

  if (storage === undefined) {
    return (
      <>
        {heading}
        <Skeleton className="h-64 rounded-xl" />
      </>
    );
  }
  if (storage === null) {
    return (
      <>
        {heading}
        <NeedsToolkit />
      </>
    );
  }

  const trail = folderTrail(prefix);
  const active = Object.entries(inFlight);
  const allSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));
  const sortHead = (by: SortBy, label: string, className?: string) => (
    <TableHead
      className={className}
      aria-sort={sort.by === by ? (sort.down ? "descending" : "ascending") : undefined}
    >
      <button
        type="button"
        className="hover:text-foreground -mx-1 inline-flex items-center gap-1 rounded-sm px-1"
        onClick={() => setSort({ by, down: sort.by === by ? !sort.down : by !== "name" })}
      >
        {label}
        {sort.by === by &&
          (sort.down ? (
            <ArrowDown className="size-3.5" aria-hidden="true" />
          ) : (
            <ArrowUp className="size-3.5" aria-hidden="true" />
          ))}
      </button>
    </TableHead>
  );
  const menu = (key: string, name: string, file: boolean) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {file && (
          <>
            <DropdownMenuItem onSelect={() => void download(key)}>
              <Download />
              Download
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copyLink(key)}>
              <Link2 />
              Copy link
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={() => setNaming({ key })}>
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setMoving([key])}>
          <FolderInput />
          Move to…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting([key])}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        {heading}
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setNaming("folder")}>
            <FolderPlus />
            New folder
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            className="sr-only"
            aria-label="Choose files to upload"
            onChange={(event) => {
              if (event.target.files?.length) void upload(event.target.files);
              event.target.value = "";
            }}
          />
          <Button onClick={() => input.current?.click()}>
            <Upload />
            Upload
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Folder" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          <button
            type="button"
            aria-current={prefix === "" ? "page" : undefined}
            className="hover:bg-muted data-[drop=true]:bg-accent data-[drop=true]:ring-primary flex items-center gap-1.5 rounded-md px-1.5 py-1 font-medium data-[drop=true]:ring-2"
            onClick={() => open("")}
            {...dropTarget("")}
          >
            <HardDrive className="size-4" aria-hidden="true" />
            {TOP_NAME}
          </button>
          {trail.map((folder, index) => (
            <span key={folder.prefix} className="flex min-w-0 items-center gap-1">
              <ChevronRight
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden="true"
              />
              <button
                type="button"
                aria-current={index === trail.length - 1 ? "page" : undefined}
                className="hover:bg-muted data-[drop=true]:bg-accent data-[drop=true]:ring-primary aria-[current=page]:text-foreground text-muted-foreground max-w-48 truncate rounded-md px-1.5 py-1 font-medium data-[drop=true]:ring-2"
                onClick={() => open(folder.prefix)}
                {...dropTarget(folder.prefix)}
              >
                {folder.name}
              </button>
            </span>
          ))}
        </nav>

        {selected.size > 0 ? (
          <div className="flex h-8 items-center gap-2 text-sm">
            <span className="text-muted-foreground tabular-nums">{selected.size} selected</span>
            <Button variant="outline" size="sm" onClick={() => setMoving([...selected])}>
              <FolderInput />
              Move
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setDeleting([...selected])}>
              <Trash2 />
              Delete
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clear the selection"
              onClick={() => setSelection({ prefix, keys: new Set() })}
            >
              <X />
            </Button>
          </div>
        ) : (
          <div className="relative w-full sm:w-64">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find in this folder"
              aria-label="Find in this folder"
              className="pl-8"
            />
          </div>
        )}
      </div>

      {active.length > 0 && (
        <ul className="flex flex-col gap-3" aria-live="polite">
          {active.map(([id, file]) => (
            <li key={id} className="flex flex-col gap-1.5 rounded-lg bg-surface p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate font-medium">{file.name}</span>
                <span className="text-muted-foreground tabular-nums">{file.percent}%</span>
              </div>
              <Progress value={file.percent} aria-label={`Uploading ${file.name}`} />
            </li>
          ))}
        </ul>
      )}

      {error && !listing ? (
        <div className="flex flex-col items-start gap-3 rounded-xl bg-surface p-6">
          <p className="text-muted-foreground text-sm">{error}</p>
          <Button size="sm" variant="outline" onClick={refresh}>
            Try again
          </Button>
        </div>
      ) : !listing ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <div
          data-dragging={draggingIn}
          className="data-[dragging=true]:border-primary data-[dragging=true]:bg-accent/40 overflow-hidden rounded-xl bg-surface transition-colors"
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            setDraggingIn(true);
          }}
          onDragLeave={() => setDraggingIn(false)}
          onDrop={(event) => {
            setDraggingIn(false);
            if (event.dataTransfer.files.length === 0) return;
            event.preventDefault();
            void upload(event.dataTransfer.files);
          }}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    disabled={visibleKeys.length === 0}
                    aria-label="Select everything in this folder"
                    onCheckedChange={(on) =>
                      setSelection({ prefix, keys: new Set(on === true ? visibleKeys : []) })
                    }
                  />
                </TableHead>
                {sortHead("name", "Name")}
                <TableHead>Type</TableHead>
                <TableHead>Length</TableHead>
                <TableHead>Picture size</TableHead>
                <TableHead>Platforms</TableHead>
                {sortHead("size", "Size")}
                {sortHead("changed", "Changed")}
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.folders.map((folder) => (
                <TableRow
                  key={folder.key}
                  draggable
                  onDragStart={(event) => dragStart(event, folder.key)}
                  data-state={selected.has(folder.key) ? "selected" : undefined}
                  className="data-[drop=true]:bg-accent data-[drop=true]:outline-primary data-[drop=true]:outline-2 data-[drop=true]:-outline-offset-2"
                  {...dropTarget(folder.key)}
                >
                  <TableCell>
                    <Checkbox
                      checked={selected.has(folder.key)}
                      aria-label={`Select ${folder.name}`}
                      onCheckedChange={(on) => toggle(folder.key, on === true)}
                    />
                  </TableCell>
                  <TableCell className="w-2/5 max-w-0 font-medium">
                    <button
                      type="button"
                      className="flex max-w-full items-center gap-2 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:underline"
                      onClick={() => open(folder.key)}
                    >
                      <Folder
                        className="fill-muted-foreground/20 text-muted-foreground size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="truncate">{folder.name}</span>
                    </button>
                  </TableCell>
                  <TableCell className="text-muted-foreground">Folder</TableCell>
                  <TableCell className="text-muted-foreground">–</TableCell>
                  <TableCell className="text-muted-foreground">–</TableCell>
                  <TableCell className="text-muted-foreground">–</TableCell>
                  <TableCell className="text-muted-foreground">–</TableCell>
                  <TableCell className="text-muted-foreground">–</TableCell>
                  <TableCell className="text-right">
                    {menu(folder.key, folder.name, false)}
                  </TableCell>
                </TableRow>
              ))}
              {rows.files.map((file) => {
                const Icon = KIND_ICONS[file.kind];
                const columns = file.details ? fileDetailColumns(file.details) : null;
                return (
                  <TableRow
                    key={file.key}
                    draggable
                    onDragStart={(event) => dragStart(event, file.key)}
                    data-state={selected.has(file.key) ? "selected" : undefined}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selected.has(file.key)}
                        aria-label={`Select ${file.name}`}
                        onCheckedChange={(on) => toggle(file.key, on === true)}
                      />
                    </TableCell>
                    <TableCell className="w-2/5 max-w-0 font-medium">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="flex min-w-0 items-center gap-2 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:underline"
                          onClick={() => setOpened(file.key)}
                        >
                          <Icon
                            className="text-muted-foreground size-4 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="truncate">{file.name}</span>
                        </button>
                        {file.usedAs && <Badge variant="secondary">{USED_AS[file.usedAs]}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {columns?.type ?? KIND_NAMES[file.kind]}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap tabular-nums">
                      {columns?.length ?? "–"}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap tabular-nums">
                      {columns?.picture ?? "–"}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {file.platform ? (
                        <PlatformTag platform={file.platform} />
                      ) : file.kind === "video" && file.details ? (
                        <PlatformFits video={file.details} apps={goals?.apps} />
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap tabular-nums">
                      {formatBytes(file.size)}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap tabular-nums">
                      {changedAt.format(file.lastModified)}
                    </TableCell>
                    <TableCell className="text-right">{menu(file.key, file.name, true)}</TableCell>
                  </TableRow>
                );
              })}
              {visibleKeys.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={9} className="text-muted-foreground py-10 text-center">
                    {search.trim()
                      ? `Nothing in this folder matches "${search.trim()}".`
                      : "This folder is empty. Drop files here, or move some in."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {listing.next && (
            <div className="flex justify-center p-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={loadingMore}
                onClick={async () => {
                  setLoadingMore(true);
                  try {
                    const more = await list({
                      organizationId: team.id,
                      prefix,
                      token: listing.next ?? undefined,
                    });
                    setLoaded({
                      prefix,
                      listing: {
                        bucket: more.bucket,
                        folders: [...listing.folders, ...more.folders],
                        files: [...listing.files, ...more.files],
                        next: more.next,
                      },
                    });
                  } catch {
                    toast.error("The rest of this folder could not be read.");
                  } finally {
                    setLoadingMore(false);
                  }
                }}
              >
                {loadingMore ? "Loading…" : "Show more"}
              </Button>
            </div>
          )}
        </div>
      )}

      {naming === "folder" && (
        <NameDialog
          title="New folder"
          description={`It is made inside ${prefix ? baseName(prefix) : TOP_NAME}.`}
          action="Create folder"
          startWith=""
          onClose={() => setNaming(null)}
          onSubmit={(name) => {
            setNaming(null);
            void change(
              "Making the folder…",
              () => createFolder({ organizationId: team.id, prefix, name }),
              () => `Made the folder "${name}".`,
            );
          }}
        />
      )}
      {naming !== null && naming !== "folder" && (
        <NameDialog
          title={`Rename ${isFolderKey(naming.key) ? "folder" : "file"}`}
          description={
            isFolderKey(naming.key)
              ? "Everything inside comes along, and automations that watch it follow."
              : "Anything that uses this file keeps working under the new name."
          }
          action="Rename"
          startWith={baseName(naming.key)}
          keepEnding={
            isFolderKey(naming.key) ? undefined : /\.[A-Za-z0-9]+$/.exec(baseName(naming.key))?.[0]
          }
          onClose={() => setNaming(null)}
          onSubmit={(name) => {
            const { key } = naming;
            setNaming(null);
            void change(
              `Renaming "${baseName(key)}"…`,
              () => renameEntry({ organizationId: team.id, key, name }),
              (result) => `Renamed to "${name}".${leftBehindNote(result.leftBehind)}`,
            );
          }}
        />
      )}
      {moving && (
        <MoveDialog
          organizationId={team.id}
          bucket={TOP_NAME}
          keys={moving}
          startAt={prefix}
          onClose={() => setMoving(null)}
          onMove={(toFolder) => {
            const keys = moving;
            setMoving(null);
            move(keys, toFolder);
          }}
        />
      )}
      {deleting && (
        <Dialog open onOpenChange={(open) => !open && setDeleting(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {describe(deleting)}?</DialogTitle>
              <DialogDescription>
                {deleting.some(isFolderKey)
                  ? "This removes it from your storage for good, with everything inside the folder. It cannot be undone."
                  : "This removes it from your storage for good. It cannot be undone."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const keys = deleting;
                  setDeleting(null);
                  void change(
                    `Deleting ${describe(keys)}…`,
                    () => removeEntries({ organizationId: team.id, keys }),
                    (result) =>
                      result.leftBehind > 0
                        ? `Deleted ${result.removed} files. ${result.leftBehind} could not be deleted.`
                        : `Deleted ${describe(keys)}.`,
                  );
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {openedFile && (
        <FilePreview
          organizationId={team.id}
          file={openedFile}
          onDownload={() => void download(openedFile.key)}
          onCopyLink={() => void copyLink(openedFile.key)}
          onClose={() => setOpened(null)}
        />
      )}
    </>
  );
}
