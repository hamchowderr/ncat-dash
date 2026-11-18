"use client";

import { api } from "@convex/_generated/api";
import { baseName, folderTrail } from "@ncat-dash/automation-core";
import { useAction } from "convex/react";
import { ChevronRight, Folder, FolderPlus, HardDrive } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type FolderEntry = { key: string; name: string };

/**
 * Walks the folders of the team's bucket. `at` is the open folder ("" for the top of the
 * bucket); opening a folder calls `onOpen`. Folders in `disabled` cannot be opened.
 */
export function FolderBrowser({
  organizationId,
  bucket,
  at,
  onOpen,
  disabled,
  canCreate = false,
}: {
  organizationId: string;
  bucket: string;
  at: string;
  onOpen: (prefix: string) => void;
  disabled?: Set<string>;
  canCreate?: boolean;
}) {
  const loadFolders = useAction(api.files.folders);
  const createFolder = useAction(api.files.createFolder);
  const [loaded, setLoaded] = useState<{ at: string; folders: FolderEntry[] } | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadFolders({ organizationId, prefix: at })
      .then((folders) => live && setLoaded({ at, folders }))
      .catch(() => live && setLoaded({ at, folders: [] }));
    return () => {
      live = false;
    };
  }, [at, loadFolders, organizationId]);

  const folders = loaded?.at === at ? loaded.folders : null;
  const here = at === "" ? bucket : baseName(at);

  async function create() {
    const name = (naming ?? "").trim();
    if (!name) return;
    try {
      const key = await createFolder({ organizationId, prefix: at, name });
      setNaming(null);
      setProblem(null);
      onOpen(key);
    } catch (error) {
      const data = (error as { data?: { message?: string } }).data;
      setProblem(data?.message ?? "That folder could not be made. Try another name.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-sm">
        <button
          type="button"
          className="hover:bg-muted flex items-center gap-1.5 rounded-md px-1.5 py-1 font-medium"
          onClick={() => onOpen("")}
        >
          <HardDrive className="size-4" aria-hidden="true" />
          {bucket}
        </button>
        {folderTrail(at).map((folder) => (
          <span key={folder.prefix} className="flex items-center gap-1">
            <ChevronRight className="text-muted-foreground size-3.5" aria-hidden="true" />
            <button
              type="button"
              className="hover:bg-muted rounded-md px-1.5 py-1 font-medium"
              onClick={() => onOpen(folder.prefix)}
            >
              {folder.name}
            </button>
          </span>
        ))}
      </nav>

      <div className="bg-surface h-64 overflow-y-auto rounded-lg">
        {folders === null ? (
          <div className="flex flex-col gap-2 p-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : folders.length === 0 ? (
          <p className="text-muted-foreground p-4 text-sm">No folders inside {here}.</p>
        ) : (
          <ul className="reveal p-1">
            {folders.map((folder) => (
              <li key={folder.key}>
                <button
                  type="button"
                  disabled={disabled?.has(folder.key)}
                  className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => onOpen(folder.key)}
                >
                  <Folder className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                  <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canCreate &&
        (naming === null ? (
          <div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setNaming("")}>
              <FolderPlus />
              New folder in {here}
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <div className="flex gap-2">
              <Input
                aria-label="New folder name"
                autoFocus
                value={naming}
                maxLength={200}
                placeholder="Folder name"
                onChange={(event) => setNaming(event.target.value)}
                aria-invalid={problem !== null}
              />
              <Button type="submit" size="sm" disabled={!naming.trim()}>
                Make it
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setNaming(null);
                  setProblem(null);
                }}
              >
                Cancel
              </Button>
            </div>
            {problem && <p className="text-destructive text-sm">{problem}</p>}
          </form>
        ))}
    </div>
  );
}
