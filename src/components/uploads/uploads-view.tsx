"use client";

import { api } from "@convex/_generated/api";
import {
  fileDetailColumns,
  fileDetailRows,
  uploadKind,
  type FileDetails,
} from "@takewon/automation-core";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { Copy, FileText, LayoutGrid, List, Trash2, UploadCloud } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  useState,
  type DragEvent,
} from "react";
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
import { cn } from "@/lib/utils";
import {
  chooseFilesOnDesktop,
  type DiskUpload,
  forgetDiskUpload,
  inDesktopApp,
  stoppedDiskUploads,
} from "@/lib/desktop";
import { type StartedUpload, StoppedUpload, useSendFile, useSendFromDisk } from "@/lib/send-file";
import { usePhone } from "@/hooks/use-narrow";
import { useWakeLock } from "@/hooks/use-wake-lock";

import { CopyLookFromUpload } from "@/components/looks/look-study";

import { NeedsToolkit } from "./needs-toolkit";
import { WorkChip } from "@/components/library/work-status";

import { LinkRow, PasteLink, useLinks } from "./paste-link";
import {
  UploadFrame,
  UploadingCard,
  UploadingRow,
  UploadPlayer,
  usePreviewLinks,
  type UploadKind,
} from "./upload-media";
import { SegmentedButton, SegmentedGroup } from "@/components/ui/segmented";

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
  sharedBy?: string | null;
}): string {
  const columns = upload.details ? fileDetailColumns(upload.details) : null;
  const kindLabel = { video: "Video", audio: "Sound", image: "Picture", other: "File" }[
    upload.kind
  ];
  return [
    kindLabel,
    columns?.length,
    columns?.picture,
    formatBytes(upload.size),
    upload.sharedBy ? `Shared by ${upload.sharedBy}` : null,
  ]
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
    // On a phone the opened file carries these, as big buttons; the tile stays a picture.
    <div className="flex shrink-0 items-center max-sm:hidden">
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
  const fromDisk = useSendFromDisk();
  const cancelUpload = useAction(api.storage.cancelUpload);
  const finishUpload = useMutation(api.storage.finishUpload);
  const removeUpload = useMutation(api.storage.removeUpload);
  const linkFor = useAction(api.storage.linkFor);

  const input = useRef<HTMLInputElement>(null);
  const [inFlight, setInFlight] = useState<Record<string, InFlight>>({});
  const [dragging, setDragging] = useState(false);
  const [opened, setOpened] = useState<Id<"uploads"> | null>(null);
  const [hovered, setHovered] = useState<Id<"uploads"> | null>(null);
  // The server always draws tiles; the browser then uses the viewer's own choice. A phone
  // always gets tiles: the list's nine columns do not fit across one.
  const phone = usePhone();
  const chosen = useSyncExternalStore(watchLayout, readLayout, () => "tiles" as const);
  const layout = phone ? "tiles" : chosen;
  const sending = Object.keys(inFlight).length > 0;
  // In the desktop app, files are chosen in the computer's own picker and sent from disk;
  // an upload that stopped part way is listed here to carry on from where it got to.
  const [desktop] = useState(inDesktopApp);
  const [stoppedRecords, setStoppedRecords] = useState<DiskUpload[]>([]);
  const refreshStopped = useCallback(() => {
    void stoppedDiskUploads().then(setStoppedRecords);
  }, []);
  useEffect(() => {
    if (desktop) refreshStopped();
  }, [desktop, refreshStopped]);
  const stopped = useMemo(
    () =>
      stoppedRecords.filter(
        (record) =>
          !inFlight[record.uploadId] &&
          uploads?.some(
            (upload) => upload._id === record.uploadId && upload.status === "uploading",
          ),
      ),
    [stoppedRecords, uploads, inFlight],
  );
  // The app remembers an upload the team no longer has (removed elsewhere): forget it.
  useEffect(() => {
    if (!uploads) return;
    for (const record of stoppedRecords) {
      if (!uploads.some((upload) => upload._id === record.uploadId)) {
        void forgetDiskUpload(record.uploadId);
      }
    }
  }, [uploads, stoppedRecords]);
  useWakeLock(sending);
  const ready = useMemo(
    () =>
      uploads
        ?.filter((upload) => upload.status === "ready")
        .map((upload) => ({ ...upload, kind: uploadKind(upload.contentType, upload.details) })),
    [uploads],
  );
  const links = usePreviewLinks(team.id, ready);
  // Videos coming in from pasted links, and links that could not be brought in. Those
  // pasted to copy a look show in the step they were pasted in.
  const pasted = (useLinks() ?? []).filter((link) => !link.forLook);
  // Meeting recordings the toolkit is still bringing in, straight from Zoom or Google
  // Drive to the bucket.
  const fromZoom = useMemo(
    () =>
      (uploads ?? []).filter((upload) => upload.status === "uploading" && upload.source === "zoom"),
    [uploads],
  );
  const fromMeet = useMemo(
    () =>
      (uploads ?? []).filter(
        (upload) => upload.status === "uploading" && upload.source === "google_meet",
      ),
    [uploads],
  );
  // Teams recordings the toolkit is still bringing in, straight from OneDrive to the bucket.
  const fromTeams = useMemo(
    () =>
      (uploads ?? []).filter(
        (upload) => upload.status === "uploading" && upload.source === "microsoft",
      ),
    [uploads],
  );
  // Files from watched Dropbox folders the toolkit is still bringing in.
  const fromDropbox = useMemo(
    () =>
      (uploads ?? []).filter(
        (upload) => upload.status === "uploading" && upload.source === "dropbox",
      ),
    [uploads],
  );
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

  function send(files: FileList | File[]) {
    return sendAll(
      Array.from(files).map((file) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        go: (started: StartedUpload, onProgress: (percent: number) => void) =>
          sendFile(started, file, onProgress),
      })),
    );
  }

  async function choose() {
    const chosen = desktop ? await chooseFilesOnDesktop() : null;
    // Outside the app, or an app too old to have its own picker: the page's file input.
    if (chosen === null) {
      input.current?.click();
      return;
    }
    await sendAll(
      chosen.map((file) => ({
        name: file.name,
        type: file.contentType,
        size: file.size,
        go: (started: StartedUpload, onProgress: (percent: number) => void) =>
          fromDisk.send(started, file, onProgress),
      })),
    );
  }

  function stoppedNotice(name: string) {
    refreshStopped();
    toast.error(`${name} stopped part way. Carry on below to send the rest.`);
  }

  async function carryOn(record: DiskUpload) {
    const id = record.uploadId as Id<"uploads">;
    setInFlight((current) => ({ ...current, [id]: { name: record.name, percent: 0 } }));
    try {
      await fromDisk.carryOn(record, (percent) =>
        setInFlight((current) => ({ ...current, [id]: { name: record.name, percent } })),
      );
      await finishUpload({ uploadId: id });
      refreshStopped();
    } catch (caught) {
      if (caught instanceof StoppedUpload) stoppedNotice(record.name);
      else {
        await removeUpload({ uploadId: id }).catch(() => null);
        refreshStopped();
        toast.error(errorMessage(caught, `${record.name} did not upload.`));
      }
    } finally {
      setInFlight((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)),
      );
    }
  }

  async function drop(record: DiskUpload) {
    await cancelUpload({ uploadId: record.uploadId as Id<"uploads"> }).catch(() => null);
    await forgetDiskUpload(record.uploadId);
    refreshStopped();
  }

  async function sendAll(
    files: {
      name: string;
      type: string;
      size: number;
      go: (started: StartedUpload, onProgress: (percent: number) => void) => Promise<void>;
    }[],
  ) {
    for (const file of files) {
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
        await file.go(started, (percent) =>
          setInFlight((current) => ({ ...current, [id]: { name: file.name, percent } })),
        );
        await finishUpload({ uploadId: id });
      } catch (caught) {
        // Stopped part way from disk: kept, to carry on from where it got to.
        if (caught instanceof StoppedUpload) {
          stoppedNotice(file.name);
          continue;
        }
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
        data-upload-area
        className="data-[dragging=true]:border-primary data-[dragging=true]:bg-accent/50 flex flex-col items-center gap-3 rounded-xl bg-surface p-5 text-center transition-colors sm:p-8"
      >
        <UploadCloud className="text-muted-foreground size-8 max-sm:size-7" aria-hidden="true" />
        {/* A phone has nothing to drag from: its picker opens the camera roll and the camera. */}
        <p className="text-sm pointer-coarse:hidden">
          Drop files here, or choose them from your computer.
        </p>
        <p className="hidden text-sm pointer-coarse:block">
          Choose videos and photos from your phone.
        </p>
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
        <Button
          size="sm"
          className="pointer-coarse:h-11 pointer-coarse:w-full pointer-coarse:max-w-xs pointer-coarse:text-base"
          onClick={() => void choose()}
        >
          Choose files
        </Button>
        <p className="text-muted-foreground text-xs">
          Going to your toolkit&apos;s storage, bucket {storage.bucket}.
        </p>
        <PasteLink className="mt-3 max-w-md text-left" />
      </div>

      {pasted.length > 0 && (
        <section aria-label="Videos from links" className="flex flex-col gap-3">
          {pasted.map((link) => (
            <LinkRow key={link._id} link={link} />
          ))}
        </section>
      )}

      {sending && (
        <p role="status" className="text-muted-foreground text-sm" data-keep-open>
          {desktop
            ? "Keep the app open until your files finish sending; closing the window keeps it running. If sending stops, it carries on from where it got to."
            : "Keep this page open until your files finish sending. The screen stays on meanwhile."}
        </p>
      )}

      {stopped.length > 0 && (
        <section aria-label="Stopped uploads" className="flex flex-col gap-2">
          {stopped.map((record) => {
            const sent = record.parts.reduce(
              (total, part) =>
                total +
                Math.min(
                  record.plan.partSize,
                  record.size - (part.partNumber - 1) * record.plan.partSize,
                ),
              0,
            );
            return (
              <div
                key={record.uploadId}
                className="flex flex-wrap items-center gap-3 rounded-lg bg-surface px-4 py-3 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {record.name} stopped at {Math.floor((sent / record.size) * 100)}% (
                  {formatBytes(sent)} of {formatBytes(record.size)}).
                </span>
                <Button size="sm" onClick={() => void carryOn(record)}>
                  Carry on
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Drop ${record.name}`}
                  onClick={() => void drop(record)}
                >
                  Drop
                </Button>
              </div>
            );
          })}
        </section>
      )}

      {fromZoom.length > 0 && (
        <p className="text-muted-foreground text-sm" data-zoom-coming>
          Coming in from Zoom: {fromZoom.map((upload) => upload.fileName).join(", ")}. They show
          here once they arrive.
        </p>
      )}

      {fromMeet.length > 0 && (
        <p className="text-muted-foreground text-sm" data-meet-coming>
          Coming in from Google Meet: {fromMeet.map((upload) => upload.fileName).join(", ")}. They
          show here once they arrive.
        </p>
      )}

      {fromTeams.length > 0 && (
        <p className="text-muted-foreground text-sm" data-teams-coming>
          Coming in from Microsoft Teams: {fromTeams.map((upload) => upload.fileName).join(", ")}.
          They show here once they arrive.
        </p>
      )}

      {fromDropbox.length > 0 && (
        <p className="text-muted-foreground text-sm" data-dropbox-coming>
          Coming in from Dropbox: {fromDropbox.map((upload) => upload.fileName).join(", ")}. They
          show here once they arrive.
        </p>
      )}

      {shown === undefined ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : shown.length === 0 ? null : (
        <section className="flex flex-col gap-4" aria-label="Your uploads">
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm tabular-nums">
              {shown.length === 1 ? "1 file" : `${shown.length} files`}
            </p>
            <SegmentedGroup aria-label="Show as" className="max-sm:hidden">
              {(
                [
                  ["tiles", LayoutGrid, "Tiles"],
                  ["list", List, "List"],
                ] as const
              ).map(([value, Icon, label]) => (
                <SegmentedButton
                  key={value}
                  pressed={layout === value}
                  onClick={() => chooseLayout(value)}
                >
                  <Icon />
                  {label}
                </SegmentedButton>
              ))}
            </SegmentedGroup>
          </div>

          {layout === "tiles" ? (
            <ul className="reveal grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] sm:gap-x-5 sm:gap-y-6">
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
        <DialogContent
          className={cn(
            "max-h-[calc(100dvh-2rem)] overflow-y-auto",
            openedUpload?.kind === "other" ? "sm:max-w-md" : "sm:max-w-5xl",
            // A phone gets the whole screen: the player at the top, the details under it and
            // the buttons in reach of a thumb.
            "max-sm:inset-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:content-start max-sm:overflow-y-auto max-sm:rounded-none max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]",
          )}
        >
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{openedUpload?.fileName}</DialogTitle>
            <DialogDescription>
              {openedUpload?.details
                ? "Read from the file when it was uploaded. A run this file starts is given the same details."
                : "Your toolkit is still reading this file's details, or could not read them."}
            </DialogDescription>
            {openedUpload?.libraryItemId &&
              (openedUpload.kind === "video" || openedUpload.kind === "audio") && (
                <WorkChip
                  className="mt-1 self-start"
                  work={{
                    label: "Transcript and SRT",
                    // Every upload is transcribed as it comes in, so none yet means on its way.
                    state:
                      openedUpload.transcript === "ready"
                        ? "ready"
                        : openedUpload.transcript === "failed"
                          ? "failed"
                          : "working",
                  }}
                />
              )}
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
                    ...(openedUpload.sharedBy ? [["Shared by", openedUpload.sharedBy]] : []),
                  ].map(([label, value]) => (
                    <div key={label} className="col-span-2 grid grid-cols-subgrid">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="min-w-0 break-words tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-wrap gap-2 max-sm:grid max-sm:grid-cols-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="max-sm:h-11"
                    onClick={() => copyLink(openedUpload._id)}
                  >
                    <Copy />
                    Copy link
                  </Button>
                  {openedUpload.libraryItemId &&
                    (openedUpload.kind === "video" || openedUpload.kind === "audio") && (
                      <Button asChild variant="secondary" size="sm" className="max-sm:h-11">
                        <Link href={`/library/${openedUpload.libraryItemId}`}>
                          <FileText />
                          {openedUpload.transcript === "working"
                            ? "Transcript on its way"
                            : "Transcript and SRT"}
                        </Link>
                      </Button>
                    )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="max-sm:h-11"
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
          {openedUpload?.kind === "video" && openedUpload.details?.hasVideo !== false && (
            <CopyLookFromUpload upload={openedUpload} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
