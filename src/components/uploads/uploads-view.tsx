"use client";

import { api } from "@convex/_generated/api";
import {
  fileDetailColumns,
  fileDetailRows,
  uploadKind,
  type FileDetails,
} from "@ncat-dash/automation-core";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { Copy, LayoutGrid, List, Trash2, UploadCloud } from "lucide-react";
import { useMemo, useRef, useSyncExternalStore, useState, type DragEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
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

import { NeedsToolkit } from "./needs-toolkit";
import {
  UploadFrame,
  UploadingCard,
  UploadingRow,
  UploadPlayer,
  usePreviewLinks,
  type UploadKind,
} from "./upload-media";

type InFlight = { name: string; percent: number };
type Layout = "tiles" | "list";

const LAYOUT_KEY = "uploads-layout";

// Kept here as well as in the browser's storage, so the choice holds where storage is blocked.
let chosenLayout: Layout | null = null;
const layoutWatchers = new Set<() => void>();

function readLayout(): Layout {
  if (chosenLayout) return chosenLayout;
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "tiles";
  } catch {
    return "tiles";
  }
}

function watchLayout(onChange: () => void) {
  layoutWatchers.add(onChange);
  return () => layoutWatchers.delete(onChange);
}

function chooseLayout(next: Layout) {
  chosenLayout = next;
  try {
    window.localStorage.setItem(LAYOUT_KEY, next);
  } catch {
    // Remembering the choice is a nicety; the page works without it.
  }
  layoutWatchers.forEach((onChange) => onChange());
}

/** "Video · 6:52 · 1920×1080 · 48 MB": what a tile says under its frame. */
function summaryOf(upload: {
  kind: UploadKind;
  size: number;
  details: FileDetails | null;
}): string {
  const columns = upload.details ? fileDetailColumns(upload.details) : null;
  const kindLabel = { video: "Video", audio: "Sound", image: "Picture", other: "File" }[
    upload.kind
  ];
  return [kindLabel, columns?.length, columns?.picture, formatBytes(upload.size)]
    .filter(Boolean)
    .join(" · ");
}

function UploadActions({
  upload,
  onCopy,
  onRemove,
}: {
  upload: { fileName: string };
  onCopy: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Copy a link to ${upload.fileName}`}
        onClick={onCopy}
      >
        <Copy />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${upload.fileName} from this list`}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

export function UploadsView() {
  const team = useActiveTeam();
  const storage = useQuery(api.storage.get, { organizationId: team.id });
  const uploads = useQuery(api.storage.listUploads, { organizationId: team.id });
  const startUpload = useAction(api.storage.startUpload);
  const sendFile = useSendFile();
  const finishUpload = useMutation(api.storage.finishUpload);
  const removeUpload = useMutation(api.storage.removeUpload);
  const linkFor = useAction(api.storage.linkFor);

  const input = useRef<HTMLInputElement>(null);
  const [inFlight, setInFlight] = useState<Record<string, InFlight>>({});
  const [dragging, setDragging] = useState(false);
  const [opened, setOpened] = useState<Id<"uploads"> | null>(null);
  const [hovered, setHovered] = useState<Id<"uploads"> | null>(null);
  // The server always draws tiles; the browser then uses the viewer's own choice.
  const layout = useSyncExternalStore(watchLayout, readLayout, () => "tiles" as const);
  const ready = useMemo(
    () =>
      uploads
        ?.filter((upload) => upload.status === "ready")
        .map((upload) => ({ ...upload, kind: uploadKind(upload.contentType, upload.details) })),
    [uploads],
  );
  const links = usePreviewLinks(team.id, ready);
  // A file still going up sits where it will land, as a skeleton with its percentage.
  const shown = useMemo(
    () =>
      uploads
        ?.filter((upload) => upload.status === "ready" || inFlight[upload._id])
        .map((upload) => {
          const going = upload.status === "ready" ? undefined : inFlight[upload._id];
          return going
            ? ({ going: true, id: upload._id, ...going } as const)
            : ({
                going: false,
                id: upload._id,
                upload: ready!.find((each) => each._id === upload._id)!,
              } as const);
        }),
    [uploads, ready, inFlight],
  );

  async function send(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      let uploadId: Id<"uploads"> | null = null;
      try {
        const started = await startUpload({
          organizationId: team.id,
          fileName: file.name,
          contentType: file.type,
          size: file.size,
        });
        uploadId = started.uploadId;
        const id = started.uploadId;
        setInFlight((current) => ({ ...current, [id]: { name: file.name, percent: 0 } }));
        await sendFile(started, file, (percent) =>
          setInFlight((current) => ({ ...current, [id]: { name: file.name, percent } })),
        );
        await finishUpload({ uploadId: id });
      } catch (caught) {
        if (uploadId) await removeUpload({ uploadId });
        toast.error(
          errorMessage(
            caught,
            `${file.name} did not upload. Check your bucket's CORS rule allows PUT from this site.`,
          ),
        );
      } finally {
        if (uploadId) {
          const id = uploadId;
          setInFlight((current) =>
            Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)),
          );
        }
      }
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) void send(event.dataTransfer.files);
  }

  async function copyLink(uploadId: Id<"uploads">) {
    try {
      await navigator.clipboard.writeText(await linkFor({ uploadId }));
      toast.success("Link copied. It works for seven days.");
    } catch {
      toast.error("The link could not be copied.");
    }
  }

  const heading = (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Uploads</h1>
      <p className="text-muted-foreground text-sm">
        Your files. They go straight from your browser to your toolkit&apos;s storage, and each one
        is read for its length, size and format.
      </p>
    </div>
  );

  if (storage === undefined) {
    return (
      <>
        {heading}
        <Skeleton className="h-48 rounded-xl" />
      </>
    );
  }

  if (storage === null) {
    return (
      <>
        {heading}
        <NeedsToolkit className="max-w-2xl" />
      </>
    );
  }

  const openedUpload = ready?.find((upload) => upload._id === opened);

  return (
    <>
      {heading}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-dragging={dragging}
        className="data-[dragging=true]:border-primary data-[dragging=true]:bg-accent/50 flex flex-col items-center gap-3 rounded-xl bg-surface p-8 text-center transition-colors"
      >
        <UploadCloud className="text-muted-foreground size-8" aria-hidden="true" />
        <p className="text-sm">Drop files here, or choose them from your computer.</p>
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          aria-label="Choose files to upload"
          onChange={(event) => {
            if (event.target.files?.length) void send(event.target.files);
            event.target.value = "";
          }}
        />
        <Button size="sm" onClick={() => input.current?.click()}>
          Choose files
        </Button>
        <p className="text-muted-foreground text-xs">
          Going to your toolkit&apos;s storage, bucket {storage.bucket}.
        </p>
      </div>

      {shown === undefined ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : shown.length === 0 ? null : (
        <section className="flex flex-col gap-4" aria-label="Your uploads">
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm tabular-nums">
              {shown.length === 1 ? "1 file" : `${shown.length} files`}
            </p>
            <div className="bg-surface flex rounded-lg p-0.5" role="group" aria-label="Show as">
              {(
                [
                  ["tiles", LayoutGrid, "Tiles"],
                  ["list", List, "List"],
                ] as const
              ).map(([value, Icon, label]) => (
                <Button
                  key={value}
                  variant={layout === value ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={layout === value}
                  onClick={() => chooseLayout(value)}
                >
                  <Icon />
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {layout === "tiles" ? (
            <ul className="reveal grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-x-5 gap-y-6">
              {shown.map((entry) => {
                if (entry.going)
                  return (
                    <li key={entry.id}>
                      <UploadingCard name={entry.name} percent={entry.percent} />
                    </li>
                  );
                const upload = entry.upload;
                return (
                  <li
                    key={upload._id}
                    className="group flex flex-col gap-2.5"
                    onPointerEnter={() => setHovered(upload._id)}
                    onPointerLeave={() =>
                      setHovered((current) => (current === upload._id ? null : current))
                    }
                  >
                    <button
                      type="button"
                      className="focus-visible:ring-ring/50 overflow-hidden rounded-xl outline-none focus-visible:ring-3"
                      aria-label={`Open ${upload.fileName}`}
                      onClick={() => setOpened(upload._id)}
                      onFocus={() => setHovered(upload._id)}
                      onBlur={() =>
                        setHovered((current) => (current === upload._id ? null : current))
                      }
                    >
                      <UploadFrame
                        kind={upload.kind}
                        url={links.get(upload._id)}
                        hovering={hovered === upload._id}
                        className="transition-transform duration-300 ease-out group-hover:scale-[1.02]"
                      />
                    </button>
                    <div className="flex items-start gap-2">
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <button
                          type="button"
                          className="truncate text-left text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:underline"
                          onClick={() => setOpened(upload._id)}
                          tabIndex={-1}
                        >
                          {upload.fileName}
                        </button>
                        <p className="text-muted-foreground truncate text-xs tabular-nums">
                          {summaryOf(upload)}
                        </p>
                      </div>
                      <UploadActions
                        upload={upload}
                        onCopy={() => copyLink(upload._id)}
                        onRemove={() => removeUpload({ uploadId: upload._id })}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="reveal overflow-hidden rounded-xl bg-surface">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">
                      <span className="sr-only">Preview</span>
                    </TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Length</TableHead>
                    <TableHead>Picture size</TableHead>
                    <TableHead>Frame rate</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((entry) => {
                    if (entry.going)
                      return (
                        <UploadingRow key={entry.id} name={entry.name} percent={entry.percent} />
                      );
                    const upload = entry.upload;
                    return (
                      <TableRow
                        key={upload._id}
                        onPointerEnter={() => setHovered(upload._id)}
                        onPointerLeave={() =>
                          setHovered((current) => (current === upload._id ? null : current))
                        }
                      >
                        <TableCell className="py-1.5">
                          <button
                            type="button"
                            className="focus-visible:ring-ring/50 block w-24 overflow-hidden rounded-md outline-none focus-visible:ring-3"
                            aria-label={`Open ${upload.fileName}`}
                            tabIndex={-1}
                            onClick={() => setOpened(upload._id)}
                          >
                            <UploadFrame
                              kind={upload.kind}
                              url={links.get(upload._id)}
                              hovering={hovered === upload._id}
                            />
                          </button>
                        </TableCell>
                        <TableCell className="w-1/3 max-w-0 truncate font-medium">
                          <button
                            type="button"
                            className="max-w-full truncate rounded-sm underline-offset-4 outline-none hover:underline focus-visible:underline"
                            onClick={() => setOpened(upload._id)}
                          >
                            {upload.fileName}
                          </button>
                        </TableCell>
                        {(() => {
                          const columns = upload.details ? fileDetailColumns(upload.details) : null;
                          return (
                            ["type", "length", "picture", "frameRate", "format"] as const
                          ).map((key) => (
                            <TableCell
                              key={key}
                              className="text-muted-foreground whitespace-nowrap tabular-nums"
                            >
                              {columns?.[key] ?? "–"}
                            </TableCell>
                          ));
                        })()}
                        <TableCell className="text-muted-foreground whitespace-nowrap tabular-nums">
                          {formatBytes(upload.size)}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <UploadActions
                            upload={upload}
                            onCopy={() => copyLink(upload._id)}
                            onRemove={() => removeUpload({ uploadId: upload._id })}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}
      <Dialog open={openedUpload !== undefined} onOpenChange={(open) => !open && setOpened(null)}>
        <DialogContent className={openedUpload?.kind === "other" ? "sm:max-w-md" : "sm:max-w-5xl"}>
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{openedUpload?.fileName}</DialogTitle>
            <DialogDescription>
              {openedUpload?.details
                ? "Read from the file when it was uploaded. A run this file starts is given the same details."
                : "Your toolkit is still reading this file's details, or could not read them."}
            </DialogDescription>
          </DialogHeader>
          {openedUpload && (
            <div
              className={
                openedUpload.kind === "other"
                  ? "flex flex-col gap-4"
                  : "grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]"
              }
            >
              <UploadPlayer kind={openedUpload.kind} url={links.get(openedUpload._id)} />
              <div className="flex flex-col gap-5">
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                  {[
                    ...(openedUpload.details
                      ? fileDetailRows(openedUpload.details, openedUpload.fileName)
                      : []),
                    ["File size", formatBytes(openedUpload.size)],
                  ].map(([label, value]) => (
                    <div key={label} className="col-span-2 grid grid-cols-subgrid">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="min-w-0 break-words tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => copyLink(openedUpload._id)}>
                    <Copy />
                    Copy link
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const id = openedUpload._id;
                      setOpened(null);
                      void removeUpload({ uploadId: id });
                    }}
                  >
                    <Trash2 />
                    Remove from this list
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
