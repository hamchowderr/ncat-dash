"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Clapperboard, Download } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
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

/** Saves text as a file on the person's computer. */
function save(name: string, text: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** The button on a run that hands its cuts to the team's video editors. */
export function EditorExport({ runId }: { runId: Id<"runs"> }) {
  const [open, setOpen] = useState(false);
  // The files are made when asked for, so nothing is fetched until the dialog opens.
  const result = useQuery(api.runs.editorFiles, open ? { runId } : "skip");

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
            {result.files.length > 0 ? (
              <>
                <ul className="flex flex-col gap-2">
                  {result.files.map((file) => (
                    <li
                      key={file.name}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="grid min-w-0 gap-0.5">
                        <p className="truncate text-sm font-medium">{file.name}</p>
                        <p className="text-muted-foreground text-xs">
                          {file.editors.length > 0
                            ? `For ${file.editors.join(" and ")}`
                            : "Three steps to open the timeline"}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => save(file.name, file.text)}
                      >
                        <Download />
                        Download
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button
                  className="self-start"
                  onClick={() => result.files.forEach((file) => save(file.name, file.text))}
                >
                  <Download />
                  Download all
                </Button>
                <p className="text-muted-foreground text-sm text-pretty">
                  Keep these files in one folder with the original recording. If the editor says the
                  media is missing, point it at that folder once.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                No editor that opens a timeline is ticked.
              </p>
            )}
            {result.usesCapCut && (
              <Alert>
                <AlertDescription>
                  CapCut cannot open a timeline from another tool. Bring the finished clips from
                  this run into CapCut as footage.
                </AlertDescription>
              </Alert>
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
