"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ShortId, useLibraryLinks } from "@/components/library/library-media";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SegmentedButton, SegmentedGroup } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadFrame } from "@/components/uploads/upload-media";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

export type LibraryFile = FunctionReturnType<typeof api.library.list>["items"][number];

/** What a post can carry: a video or a picture. Sounds and other files are not posted. */
const POSTABLE = new Set<LibraryFile["kind"]>(["video", "image"]);

type Shown = "all" | "video" | "image";

function lengthOf(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function matches(file: LibraryFile, words: string[]): boolean {
  if (words.length === 0) return true;
  const text = [
    file.shortId,
    file.title,
    file.automationName ?? "",
    file.client?.name ?? "",
    ...file.tags,
  ]
    .join(" ")
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

/**
 * The library as a grid of pictures to pick from: each video shows its opening frame and
 * plays while the pointer is on it. Pressing a file picks it, pressing it again lets it go;
 * the numbers say the order the posts will be made in.
 */
export function LibraryPicker({
  picked,
  onPick,
  onClose,
}: {
  picked: LibraryFile[];
  onPick: (files: LibraryFile[]) => void;
  onClose: () => void;
}) {
  const team = useActiveTeam();
  const library = useQuery(api.library.list, { organizationId: team.id });
  const [chosen, setChosen] = useState<LibraryFile[]>(picked);
  const [text, setText] = useState("");
  const [shown, setShown] = useState<Shown>("all");
  const [hovered, setHovered] = useState<Id<"libraryItems"> | null>(null);

  const postable = useMemo(
    () => (library?.items ?? []).filter((file) => POSTABLE.has(file.kind)),
    [library],
  );
  const hasBoth =
    postable.some((file) => file.kind === "video") &&
    postable.some((file) => file.kind === "image");
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const files = postable.filter(
    (file) => (shown === "all" || file.kind === shown) && matches(file, words),
  );
  const links = useLibraryLinks(team.id, files);
  const order = new Map(chosen.map((file, index) => [file._id, index + 1]));

  function toggle(file: LibraryFile) {
    setChosen((current) =>
      current.some((entry) => entry._id === file._id)
        ? current.filter((entry) => entry._id !== file._id)
        : [...current, file],
    );
  }

  const count = chosen.length;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[min(44rem,calc(100svh-2rem))] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Choose From Your Library</DialogTitle>
          <DialogDescription>
            Pick one or more. Each one becomes its own post, in the order you pick them.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label="Search your library"
              placeholder="Search by name, ID, tag or client"
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="pl-8"
              autoFocus
            />
          </div>
          {hasBoth && (
            <SegmentedGroup aria-label="Show">
              {(
                [
                  ["all", "All"],
                  ["video", "Videos"],
                  ["image", "Pictures"],
                ] as const
              ).map(([value, label]) => (
                <SegmentedButton
                  key={value}
                  pressed={shown === value}
                  onClick={() => setShown(value)}
                >
                  {label}
                </SegmentedButton>
              ))}
            </SegmentedGroup>
          )}
        </div>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-1">
          {library === undefined ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="aspect-video rounded-xl" />
              ))}
            </div>
          ) : postable.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center text-sm">
              <p>There are no videos or pictures in your library yet.</p>
              <Link href="/uploads" className="text-foreground underline underline-offset-4">
                Upload One
              </Link>
            </div>
          ) : files.length === 0 ? (
            <p className="text-muted-foreground py-12 text-center text-sm">
              Nothing in your library matches that.
            </p>
          ) : (
            <ul
              aria-label="Library files"
              className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3"
            >
              {files.map((file) => {
                const number = order.get(file._id);
                return (
                  <li key={file._id}>
                    <button
                      type="button"
                      aria-pressed={number !== undefined}
                      aria-label={`${file.shortId} ${file.title}`}
                      onClick={() => toggle(file)}
                      onPointerEnter={() => setHovered(file._id)}
                      onPointerLeave={() =>
                        setHovered((current) => (current === file._id ? null : current))
                      }
                      className="group focus-visible:ring-ring/50 flex w-full flex-col gap-2 rounded-xl text-left outline-none focus-visible:ring-3"
                    >
                      <span
                        className={cn(
                          "relative block overflow-hidden rounded-xl transition-[outline-color] duration-150",
                          number !== undefined && "picked-ring",
                        )}
                      >
                        <UploadFrame
                          kind={file.kind}
                          url={links.get(file._id)}
                          hovering={hovered === file._id}
                          className={cn(
                            "transition-[transform,opacity] duration-300 ease-out group-hover:scale-[1.02]",
                            number !== undefined && "opacity-90",
                          )}
                        />
                        <span
                          aria-hidden="true"
                          className={cn(
                            "absolute top-2 right-2 flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums shadow-sm transition-[opacity,transform,background-color] duration-150",
                            number !== undefined
                              ? "bg-foreground text-background scale-100 opacity-100"
                              : "bg-background/85 text-foreground scale-90 opacity-0 group-hover:opacity-100",
                          )}
                        >
                          {number ?? <Check className="size-3.5" />}
                        </span>
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        <ShortId id={file.shortId} />
                        <span className="truncate text-sm font-medium">{file.title}</span>
                      </span>
                      <span className="text-muted-foreground -mt-1 truncate text-xs">
                        {[file.client?.name, lengthOf(file.duration), file.automationName]
                          .filter(Boolean)
                          .join(" · ") || (file.source === "upload" ? "Uploaded" : "Made")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {count === 0 ? "Nothing picked yet" : count === 1 ? "1 picked" : `${count} picked`}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={count === 0 && picked.length === 0}
              onClick={() => {
                onPick(chosen);
                onClose();
              }}
            >
              {count === 0 ? "Clear Picks" : count === 1 ? "Use 1 File" : `Use ${count} Files`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The files picked for a new post, each with its picture, and a way to take one out. */
export function PickedFiles({
  files,
  onRemove,
}: {
  files: LibraryFile[];
  onRemove: (file: LibraryFile) => void;
}) {
  const team = useActiveTeam();
  const links = useLibraryLinks(team.id, files);
  return (
    <ul aria-label="Picked files" className="flex flex-col gap-1.5">
      {files.map((file) => (
        <li
          key={file._id}
          className="bg-background flex items-center gap-2.5 rounded-lg py-1.5 pr-1 pl-1.5"
        >
          <UploadFrame
            kind={file.kind}
            url={links.get(file._id)}
            className="w-14 shrink-0 rounded-md [&_svg]:size-4"
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{file.title}</span>
            <span className="text-muted-foreground font-mono text-[11px]">{file.shortId}</span>
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Take out ${file.shortId}`}
            onClick={() => onRemove(file)}
          >
            <X />
          </Button>
        </li>
      ))}
    </ul>
  );
}
