"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { Link2, Upload, UploadCloud } from "lucide-react";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { errorMessage, formatBytes } from "@/lib/catalog";
import {
  chooseFilesOnDesktop,
  type DiskUpload,
  forgetDiskUpload,
  inDesktopApp,
  stoppedDiskUploads,
} from "@/lib/desktop";
import { type StartedUpload, StoppedUpload, useSendFile, useSendFromDisk } from "@/lib/send-file";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { LinkRow, PasteLink, useLinks } from "./paste-link";
import { UploadingCard } from "./upload-media";

/**
 * # Bringing files in
 *
 * Everything the Library needs to take files in: choosing or dropping files (sent straight
 * from the browser, or from disk in the desktop app), carrying on an upload that stopped,
 * pasting a link to a video, and what is still on its way in from Zoom, Google Meet,
 * Microsoft Teams and Dropbox. Once a file is in, it is a Library item like any other.
 */

type InFlight = { name: string; percent: number };
type Sendable = {
  name: string;
  type: string;
  size: number;
  go: (started: StartedUpload, onProgress: (percent: number) => void) => Promise<void>;
};

const SOURCES = [
  ["zoom", "Zoom"],
  ["google_meet", "Google Meet"],
  ["microsoft", "Microsoft Teams"],
  ["dropbox", "Dropbox"],
] as const;

export type Uploader = ReturnType<typeof useUploader>;

export function useUploader() {
  const team = useActiveTeam();
  const storage = useQuery(api.storage.get, { organizationId: team.id });
  const uploads = useQuery(api.storage.listUploads, storage ? { organizationId: team.id } : "skip");
  const startUpload = useAction(api.storage.startUpload);
  const sendFile = useSendFile();
  const fromDisk = useSendFromDisk();
  const cancelUpload = useAction(api.storage.cancelUpload);
  const finishUpload = useMutation(api.storage.finishUpload);
  const removeUpload = useMutation(api.storage.removeUpload);

  const input = useRef<HTMLInputElement>(null);
  const [inFlight, setInFlight] = useState<Record<string, InFlight>>({});
  const [dragging, setDragging] = useState(false);
  // Automations that run by themselves, unticked under On this upload for the files sent now.
  const [skipped, setSkipped] = useState<Id<"automations">[]>([]);
  const sending = Object.keys(inFlight).length > 0;
  // In the desktop app, files are chosen in the computer's own picker and sent from disk;
  // an upload that stopped part way is listed to carry on from where it got to.
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

  // Videos coming in from pasted links, and links that could not be brought in. Those
  // pasted to copy a look show in the step they were pasted in.
  const pasted = (useLinks() ?? []).filter((link) => !link.forLook);
  // Recordings and files the toolkit is still bringing in, straight to the bucket.
  const incoming = useMemo(
    () =>
      SOURCES.map(([source, label]) => ({
        source,
        label,
        names: (uploads ?? [])
          .filter((upload) => upload.status === "uploading" && upload.source === source)
          .map((upload) => upload.fileName),
      })).filter((group) => group.names.length > 0),
    [uploads],
  );
  const going = Object.entries(inFlight).map(([id, file]) => ({ id, ...file }));

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

  async function sendAll(files: Sendable[]) {
    for (const file of files) {
      let uploadId: Id<"uploads"> | null = null;
      try {
        const started = await startUpload({
          organizationId: team.id,
          fileName: file.name,
          contentType: file.type,
          size: file.size,
          ...(skipped.length > 0 ? { skipAutomations: skipped } : {}),
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

  // Files dragged in from the computer, anywhere on the page. Rows dragged within the page
  // carry no files and are left alone.
  const dropTarget = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!storage || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      setDragging(false);
      if (!storage || event.dataTransfer.files.length === 0) return;
      event.preventDefault();
      void send(event.dataTransfer.files);
    },
  };

  const fileInput = (
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
  );

  return {
    fileInput,
    /** undefined while loading, null when the team has no toolkit storage yet. */
    storage,
    dragging,
    dropTarget,
    sending,
    desktop,
    going,
    stopped,
    pasted,
    incoming,
    send,
    choose,
    carryOn,
    drop,
    skipped,
    setSkipped,
  };
}

/** The hidden file input the Upload buttons open, outside the desktop app. */
export function UploadInput({ uploader }: { uploader: Uploader }) {
  return uploader.fileInput;
}

/** Upload and Paste a link, for the top of the Library. */
export function UploadButtons({ uploader }: { uploader: Uploader }) {
  const [pasting, setPasting] = useState(false);
  if (!uploader.storage) return null;
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" onClick={() => setPasting(true)}>
        <Link2 />
        Paste a link
      </Button>
      <Button onClick={() => void uploader.choose()}>
        <Upload />
        Upload
      </Button>
      <Dialog open={pasting} onOpenChange={setPasting}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bring in a video from a link</DialogTitle>
            <DialogDescription>
              A post on TikTok, Instagram, YouTube, X, Facebook, LinkedIn or another video site. It
              shows in your Library once it is in.
            </DialogDescription>
          </DialogHeader>
          <PasteLink onBrought={() => setPasting(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The big place to drop files, for a Library with nothing in it yet: the first thing a new
 * team does is bring files in.
 */
export function UploadDropArea({ uploader }: { uploader: Uploader }) {
  return (
    <div
      data-upload-area
      data-dragging={uploader.dragging}
      className="data-[dragging=true]:bg-accent/50 flex flex-col items-center gap-3 rounded-xl bg-surface p-5 text-center transition-colors sm:p-8"
    >
      <UploadCloud className="text-muted-foreground size-8 max-sm:size-7" aria-hidden="true" />
      <p className="text-sm font-medium">Nothing in the library yet</p>
      {/* A phone has nothing to drag from: its picker opens the camera roll and the camera. */}
      <p className="text-muted-foreground text-sm pointer-coarse:hidden">
        Drop files here, or choose them from your computer. The files your automations make show up
        here too.
      </p>
      <p className="text-muted-foreground hidden text-sm pointer-coarse:block">
        Choose videos and photos from your phone.
      </p>
      <Button
        size="sm"
        className="pointer-coarse:h-11 pointer-coarse:w-full pointer-coarse:max-w-xs pointer-coarse:text-base"
        onClick={() => void uploader.choose()}
      >
        Choose files
      </Button>
      <PasteLink className="mt-3 w-full max-w-md text-left" />
    </div>
  );
}

/**
 * What is on its way in: files going up (each in the spot its tile will take), uploads that
 * stopped part way, videos from pasted links, and recordings the toolkit is bringing in.
 * Nothing shows when nothing is coming.
 */
export function ComingIn({ uploader, className }: { uploader: Uploader; className?: string }) {
  const { going, stopped, pasted, incoming, sending, desktop } = uploader;
  if (!going.length && !stopped.length && !pasted.length && !incoming.length) return null;
  return (
    <div className={cn("flex flex-col gap-4", className)}>
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
                <Button size="sm" onClick={() => void uploader.carryOn(record)}>
                  Carry on
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Drop ${record.name}`}
                  onClick={() => void uploader.drop(record)}
                >
                  Drop
                </Button>
              </div>
            );
          })}
        </section>
      )}

      {incoming.map((group) => (
        <p
          key={group.source}
          className="text-muted-foreground text-sm"
          data-coming-from={group.source}
        >
          Coming in from {group.label}: {group.names.join(", ")}. They show here once they arrive.
        </p>
      ))}

      {going.length > 0 && (
        <ul
          aria-label="Uploading"
          className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] sm:gap-x-5"
        >
          {going.map((file) => (
            <li key={file.id}>
              <UploadingCard name={file.name} percent={file.percent} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
