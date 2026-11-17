"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { fileNameOf } from "@ncat-dash/timeline-export";
import { useQuery } from "convex/react";
import { Clapperboard, Download } from "lucide-react";
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

/** A finished clip's file name, numbered so the clips sort in the order they were made. */
const clipName = (url: string, index: number) =>
  `${String(index + 1).padStart(2, "0")} ${fileNameOf(url)}`;

/**
 * Saves the finished clips one after another. Where the storage will not let the page
 * read a clip, the clip opens in a new tab so it can still be saved from there.
 */
async function saveClips(clips: string[]) {
  let opened = 0;
  for (const [index, url] of clips.entries()) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(String(response.status));
      saveBlob(clipName(url, index), await response.blob());
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
    <li className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
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
      await saveClips(result.clips);
    } finally {
      setSaving(false);
    }
  }

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
              <Link href="/settings" className="underline underline-offset-4">
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
