"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { fileNameOf } from "@ncat-dash/timeline-export";
import { useQuery } from "convex/react";
import { Clapperboard, Download, FolderOpen, HardDriveDownload } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type DesktopSaved,
  inDesktopApp,
  openOnDesktop,
  saveToDesktop,
  showOnDesktop,
} from "@/lib/desktop";

/** Saves a file on the person's computer. */
function saveBlob(name: string, blob: Blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

const save = (name: string, text: string) =>
  saveBlob(name, new Blob([text], { type: "application/octet-stream" }));

/**
 * A finished clip's file name, numbered so the clips sort in the order they were made, and
 * under its readable name ("Space interviews clip 1.mp4") when it has one.
 */
export function clipName(url: string, index: number, names: Record<string, string> = {}): string {
  const own = fileNameOf(url);
  const readable = names[url];
  const ending = own.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? "";
  const name = readable ? (readable.endsWith(ending) ? readable : `${readable}${ending}`) : own;
  return `${String(index + 1).padStart(2, "0")} ${name.replace(/[\\/:*?"<>|]/g, "_")}`;
}

/**
 * Saves the finished clips one after another. Where the storage will not let the page
 * read a clip, the clip opens in a new tab so it can still be saved from there.
 */
async function saveClips(clips: string[], names: Record<string, string>) {
  let opened = 0;
  for (const [index, url] of clips.entries()) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(String(response.status));
      saveBlob(clipName(url, index, names), await response.blob());
    } catch {
      window.open(url, "_blank", "noopener");
      opened++;
    }
  }
  if (opened > 0) {
    toast.info(
      `${opened} ${opened === 1 ? "clip" : "clips"} opened in a new tab. Save ${opened === 1 ? "it" : "them"} from there.`,
    );
  }
}

/** One thing to download, with what it is for. */
function Row(props: { name: string; note: string; busy?: boolean; onDownload: () => void }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2">
      <div className="grid min-w-0 gap-0.5">
        <p className="truncate text-sm font-medium">{props.name}</p>
        <p className="text-muted-foreground text-xs">{props.note}</p>
      </div>
      <Button variant="outline" size="sm" disabled={props.busy} onClick={props.onDownload}>
        <Download />
        {props.busy ? "Downloading" : "Download"}
      </Button>
    </li>
  );
}

/** The button on a run that hands its cuts to the team's video editors. */
export function EditorExport({ runId }: { runId: Id<"runs"> }) {
  const [open, setOpen] = useState(false);
  // The files are made when asked for, so nothing is fetched until the dialog opens.
  const result = useQuery(api.runs.editorFiles, open ? { runId } : "skip");
  const [saving, setSaving] = useState(false);
  // In the desktop app everything can go straight into one folder on this computer.
  const [desktop] = useState(inDesktopApp);
  const [onDisk, setOnDisk] = useState<DesktopSaved | null>(null);

  const files = result?.files ?? [];
  const timelines = files.filter((file) => file.editors.length > 0);
  const captions = files.filter((file) => file.captions);
  const notes = files.filter((file) => file.editors.length === 0 && !file.captions);

  /** Saves the finished clips, with every other file first when asked for everything. */
  async function clips(everything: boolean) {
    if (!result) return;
    if (everything) result.files.forEach((file) => save(file.name, file.text));
    setSaving(true);
    try {
      await saveClips(result.clips, result.clipNames);
    } finally {
      setSaving(false);
    }
  }

  /** Saves the timelines, captions, recordings and clips into one folder via the app. */
  async function saveToComputer() {
    if (!result) return;
    setSaving(true);
    try {
      const downloads = [
        ...result.recordings,
        ...result.clips.map((url, index) => ({
          url,
          name: clipName(url, index, result.clipNames),
        })),
      ];
      const saved = await saveToDesktop(result.folder, result.files, downloads);
      if (!saved) {
        toast.error("The app could not save the files. Download them below instead.");
        return;
      }
      setOnDisk(saved);
    } finally {
      setSaving(false);
    }
  }

  /** Where the app saved a file, by the name it was given. */
  const savedPath = (name: string) => onDisk?.files.find((file) => file.name === name)?.path;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Clapperboard />
          Open in editor
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open in your editor</DialogTitle>
          <DialogDescription>
            The timeline shows the original recording with every cut as its own piece, so you can
            move any cut.
          </DialogDescription>
        </DialogHeader>
        {result === undefined && <Skeleton className="h-24 rounded-lg" />}
        {result === null && (
          <p className="text-muted-foreground text-sm">This run has no cuts to open.</p>
        )}
        {result && desktop && (
          <section aria-label="On this computer" className="flex flex-col gap-3">
            {!onDisk ? (
              <>
                <p className="text-muted-foreground text-sm text-pretty">
                  Save the timelines, the original recording and the finished clips into one folder
                  on this computer, then open the timeline straight from here.
                </p>
                <Button className="self-start" disabled={saving} onClick={saveToComputer}>
                  <HardDriveDownload />
                  {saving ? "Saving to this computer" : "Save to this computer"}
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-pretty">
                  Saved to <span className="font-medium break-all">{onDisk.folder}</span>
                </p>
                {onDisk.failed.length > 0 && (
                  <p className="text-destructive text-sm text-pretty">
                    {onDisk.failed.length === 1
                      ? `${onDisk.failed[0]} could not be fetched.`
                      : `${onDisk.failed.length} files could not be fetched: ${onDisk.failed.join(", ")}.`}{" "}
                    Save again to try them once more.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {timelines.map((file) => {
                    const path = savedPath(file.name);
                    if (!path) return null;
                    return (
                      <Button
                        key={file.name}
                        onClick={async () => {
                          if (!(await openOnDesktop(path))) {
                            toast.error(
                              `Nothing on this computer opens ${file.name}. Open it from ${file.editors.join(" or ")}.`,
                            );
                          }
                        }}
                      >
                        <Clapperboard />
                        Open {file.name}
                      </Button>
                    );
                  })}
                  {onDisk.files[0] && (
                    <Button
                      variant="outline"
                      onClick={() => void showOnDesktop(onDisk.files[0].path)}
                    >
                      <FolderOpen />
                      Show in folder
                    </Button>
                  )}
                </div>
              </>
            )}
          </section>
        )}
        {result && (
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-2">
              {timelines.map((file) => (
                <Row
                  key={file.name}
                  name={file.name}
                  note={`Timeline for ${file.editors.join(" and ")}`}
                  onDownload={() => save(file.name, file.text)}
                />
              ))}
              {captions.length > 0 && (
                <Row
                  name={captions.length === 1 ? captions[0].name : `Captions (${captions.length})`}
                  note="Captions as text you can edit, timed to the cuts"
                  onDownload={() => captions.forEach((file) => save(file.name, file.text))}
                />
              )}
              {notes.map((file) => (
                <Row
                  key={file.name}
                  name={file.name}
                  note="Short steps for opening the timeline"
                  onDownload={() => save(file.name, file.text)}
                />
              ))}
              {result.clips.length > 0 && (
                <Row
                  name={`Finished clips (${result.clips.length})`}
                  note={
                    result.usesCapCut
                      ? "For CapCut, which opens no timeline: bring these in as footage"
                      : "The clips as this run made them, numbered in order"
                  }
                  busy={saving}
                  onDownload={() => clips(false)}
                />
              )}
            </ul>
            {timelines.length === 0 && (
              <p className="text-muted-foreground text-sm">
                No editor that opens a timeline is ticked.
              </p>
            )}
            {result.files.length + result.clips.length > 1 && (
              <Button className="self-start" disabled={saving} onClick={() => clips(true)}>
                <Download />
                Download everything
              </Button>
            )}
            {timelines.length > 0 && (
              <p className="text-muted-foreground text-sm text-pretty">
                Keep the files in one folder with the original recording. If the editor says the
                media is missing, point it at that folder once.
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              Editors are picked once in{" "}
              <Link href="/settings/editors" className="underline underline-offset-4">
                Settings
              </Link>
              .
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
