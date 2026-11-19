"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ChevronRight,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  Music,
  Search,
  Users,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { errorMessage, formatBytes } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { SettingsSection } from "./settings-shell";

/** What Settings says when Dropbox sends someone back, by the result in the address. */
export const DROPBOX_RESULTS: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Your Dropbox is connected. Pick the folders to watch." },
  cancelled: { ok: false, text: "Nothing changed: Dropbox was closed before it finished." },
  expired: { ok: false, text: "That took too long. Press the button again." },
  taken: { ok: false, text: "That Dropbox is already connected to another team." },
  taken_here: {
    ok: false,
    text: "Someone else on the team has already connected that Dropbox.",
  },
  not_member: { ok: false, text: "You are no longer on this team." },
  not_ready: { ok: false, text: "Dropbox is not set up on this dashboard yet." },
  refused: { ok: false, text: "Dropbox did not finish signing you in. Try again." },
  unreachable: { ok: false, text: "Dropbox could not be reached. Try again in a minute." },
};

type FolderChoice = { name: string; path: string; shared: boolean };

type PastFile = {
  fileId: string;
  name: string;
  path: string;
  folder: string;
  kind: "video" | "audio" | "image";
  size: number;
  modifiedAt: number;
  brought: boolean;
};

const KIND_ICON = { video: Video, audio: Music, image: ImageIcon } as const;

const IMPORT_TEXT = {
  importing: "Coming in",
  done: "In Uploads",
  failed: "Did not come in",
  duplicate: "Already in Uploads",
} as const;

function plural(count: number, word: string) {
  return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
}

/** When a file was last changed; the year only when it is not this year. */
export function when(at: number) {
  const thisYear = new Date(at).getFullYear() === new Date().getFullYear();
  return new Date(at).toLocaleString(undefined, {
    ...(thisYear ? {} : { year: "numeric" as const }),
    month: "short",
    day: "numeric",
  });
}

/** The folders on the way to a path, for moving back up: "/A/B" gives Dropbox, A, B. */
export function crumbsOf(path: string): { name: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  return [
    { name: "Dropbox", path: "" },
    ...parts.map((name, i) => ({ name, path: `/${parts.slice(0, i + 1).join("/")}` })),
  ];
}

/**
 * Dropbox, both ways. Each person connects their own Dropbox once and picks folders to
 * watch, their own or the team's. New videos, sounds and pictures put in them come into
 * Uploads by themselves; what is already there can be brought over in one go.
 */
export function DropboxCard() {
  const team = useActiveTeam();
  const box = useQuery(api.dropbox.forTeam, { organizationId: team.id });
  const startLink = useMutation(api.dropbox.startLink);
  const disconnect = useMutation(api.dropbox.disconnect);
  const setAutoImport = useMutation(api.dropbox.setAutoImport);
  const removeFolder = useMutation(api.dropbox.removeFolder);
  const sendAgain = useMutation(api.dropbox.sendAgain);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  // Coming back from Dropbox: say how it went once, then tidy the address.
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("dropbox");
    if (!result) return;
    const said = DROPBOX_RESULTS[result] ?? DROPBOX_RESULTS.refused;
    if (said.ok) toast.success(said.text);
    else toast.error(said.text);
    url.searchParams.delete("dropbox");
    window.history.replaceState(null, "", url.toString());
  }, []);

  if (box === undefined) return <Skeleton className="h-40 rounded-xl" />;
  if (box === null) return null;

  async function connect() {
    setBusy("connect");
    try {
      window.location.assign(await startLink({ organizationId: team.id }));
    } catch (caught) {
      toast.error(errorMessage(caught, "Dropbox could not be opened. Try again."));
      setBusy(null);
    }
  }

  async function run(key: string, work: () => Promise<unknown>, done?: string) {
    setBusy(key);
    try {
      await work();
      if (done) toast.success(done);
    } catch (caught) {
      toast.error(errorMessage(caught, "That did not work. Try again."));
    } finally {
      setBusy(null);
    }
  }

  if (!box.ready) {
    return (
      <SettingsSection data-dropbox-card>
        <p className="text-muted-foreground text-sm">
          Dropbox is not set up on this dashboard yet. Whoever runs the dashboard sets up its
          Dropbox app once, then everyone on every team can connect their own Dropbox here.
        </p>
      </SettingsSection>
    );
  }

  const me = box.me;

  return (
    <SettingsSection data-dropbox-card className="gap-8">
      <section className="flex flex-col gap-3" aria-label="Your Dropbox">
        {me ? (
          <>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>
                Connected as <span className="font-medium">{me.name}</span>
                {me.email && <span className="text-muted-foreground"> · {me.email}</span>}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() =>
                  run(
                    "disconnect",
                    () => disconnect({ organizationId: team.id }),
                    "Your Dropbox is disconnected",
                  )
                }
              >
                Disconnect
              </Button>
            </div>
            {me.needsReconnect && (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-destructive">
                  Dropbox stopped accepting your sign-in, so nothing new comes in.
                </span>
                <Button size="sm" disabled={busy !== null} onClick={connect}>
                  Connect again
                </Button>
              </div>
            )}
            <div className="flex items-start gap-3">
              <Switch
                id="dropbox-auto"
                checked={me.autoImport}
                disabled={busy !== null}
                onCheckedChange={(checked) =>
                  run("auto", () => setAutoImport({ organizationId: team.id, autoImport: checked }))
                }
              />
              <div className="flex flex-col gap-1">
                <Label htmlFor="dropbox-auto">Bring in new files by themselves</Label>
                <p className="text-muted-foreground text-sm">
                  When a video, sound or picture is added to a folder you watch, it goes to Uploads
                  and starts any automation set to run on an upload. Documents and other files stay
                  in Dropbox.
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              Connect your Dropbox, then pick the folders to watch. Footage added to them comes into
              Uploads by themselves, and automations can send finished clips back to Dropbox.
            </p>
            <div>
              <Button size="sm" disabled={busy !== null} onClick={connect}>
                {busy === "connect" ? "Opening Dropbox" : "Connect Dropbox"}
              </Button>
            </div>
          </>
        )}
        {box.others.length > 0 && (
          <p className="text-muted-foreground text-sm">
            Also connected on this team:{" "}
            {box.others
              .map((one) => (one.memberName ? `${one.memberName} (${one.name})` : one.name))
              .join(", ")}
            .
          </p>
        )}
      </section>

      {me && (
        <section className="flex flex-col gap-3" aria-label="Watched folders">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Watched folders</p>
            {!picking && (
              <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
                <FolderPlus />
                Add a folder
              </Button>
            )}
          </div>
          {me.folders.length === 0 && !picking && (
            <p className="text-muted-foreground text-sm">
              No folders yet. Add the ones your footage goes into
              {me.teamSpace ? ", your own or your team's" : ""}. Folders inside them are watched
              too.
            </p>
          )}
          {me.folders.length > 0 && (
            <ul className="flex flex-col gap-1.5 text-sm">
              {me.folders.map((folder) => (
                <li key={folder._id} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <Folder className="text-muted-foreground size-4 shrink-0" />
                    <span className="truncate">{folder.path}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    disabled={busy !== null}
                    onClick={() =>
                      run(
                        `remove-${folder._id}`,
                        () => removeFolder({ folderId: folder._id }),
                        `Stopped watching ${folder.path}`,
                      )
                    }
                  >
                    Stop watching
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {picking && (
            <FolderPicker
              teamSpace={me.teamSpace}
              watched={me.folders.map((one) => one.path.toLowerCase())}
              onDone={() => setPicking(false)}
            />
          )}
        </section>
      )}

      {me && me.folders.length > 0 && <AlreadyThere />}

      {box.imports.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="Brought in from Dropbox">
          <p className="text-sm font-medium">Brought in from Dropbox</p>
          <ul className="flex flex-col gap-2 text-sm">
            {box.imports.map((one: DropboxImportRow) => (
              <li key={one._id} className="flex flex-col gap-0.5">
                <span className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{one.name}</span>
                    <span className="text-muted-foreground"> · {parentOf(one.path)}</span>
                  </span>
                  <span
                    className={
                      one.status === "failed"
                        ? "text-destructive shrink-0"
                        : "text-muted-foreground shrink-0"
                    }
                  >
                    {one.status === "done" ? (
                      <Link href="/uploads" className="underline-offset-4 hover:underline">
                        {IMPORT_TEXT.done}
                      </Link>
                    ) : (
                      IMPORT_TEXT[one.status]
                    )}
                  </span>
                </span>
                {one.status === "failed" && one.error && (
                  <span className="text-muted-foreground">{one.error}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {box.sends.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="Sent to Dropbox">
          <p className="text-sm font-medium">Sent to Dropbox</p>
          <ul className="flex flex-col gap-2 text-sm">
            {box.sends.map((one: DropboxSendRow) => (
              <li key={one._id} className="flex flex-col gap-0.5">
                <span className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{one.name}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {one.automationName} ·{" "}
                      {one.dropboxPath ? parentOf(one.dropboxPath) : one.folder}
                    </span>
                  </span>
                  {one.status === "failed" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0"
                      disabled={busy !== null}
                      onClick={() => run(`send-${one._id}`, () => sendAgain({ sendId: one._id }))}
                    >
                      Send again
                    </Button>
                  ) : (
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {one.status === "done"
                        ? "Sent"
                        : one.size > 0
                          ? `Sending ${Math.floor((one.offset / one.size) * 100)}%`
                          : "Sending"}
                    </span>
                  )}
                </span>
                {one.status === "failed" && one.error && (
                  <span className="text-muted-foreground">{one.error}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </SettingsSection>
  );
}

/** "/Raw footage/Day 1/clip.mp4" gives "/Raw footage/Day 1". */
function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut > 0 ? path.slice(0, cut) : "/";
}

/**
 * Picks a folder to watch: opens folders one level at a time, like Dropbox's own "Move"
 * window, with the way back up along the top. Shown in place, not over the page.
 */
function FolderPicker({
  teamSpace,
  watched,
  onDone,
}: {
  teamSpace: boolean;
  watched: string[];
  onDone: () => void;
}) {
  const team = useActiveTeam();
  const browse = useAction(api.dropbox.browse);
  const addFolder = useAction(api.dropbox.addFolder);
  const [path, setPath] = useState("");
  // What Dropbox listed, and for which folder: anything else is still loading.
  const [listed, setListed] = useState<{ path: string; list: FolderChoice[] } | null>(null);
  const folders = listed?.path === path ? listed.list : null;
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    browse({ organizationId: team.id, path })
      .then((list) => current && setListed({ path, list }))
      .catch((caught) => {
        if (!current) return;
        toast.error(errorMessage(caught, "Dropbox did not list that folder."));
        setListed({ path, list: [] });
      });
    return () => {
      current = false;
    };
  }, [browse, team.id, path]);

  async function watch(target: string) {
    setAdding(target);
    try {
      await addFolder({ organizationId: team.id, path: target });
      toast.success(`Watching ${target || "your whole Dropbox"}`);
      onDone();
    } catch (caught) {
      toast.error(errorMessage(caught, "That folder could not be watched."));
    } finally {
      setAdding(null);
    }
  }

  const crumbs = crumbsOf(path);
  const isWatched = (target: string) => watched.includes((target || "/").toLowerCase());

  return (
    <div className="bg-muted/40 flex flex-col gap-3 rounded-lg p-3" data-dropbox-picker>
      <div className="flex items-center justify-between gap-3">
        <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          {crumbs.map((crumb, i) => (
            <span key={crumb.path} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="text-muted-foreground size-3.5" />}
              {i === crumbs.length - 1 ? (
                <span className="font-medium">{crumb.name}</span>
              ) : (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground outline-none focus-visible:underline"
                  onClick={() => setPath(crumb.path)}
                >
                  {crumb.name}
                </button>
              )}
            </span>
          ))}
        </nav>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
      {folders === null ? (
        <Skeleton className="h-24 rounded-md" />
      ) : folders.length === 0 ? (
        <p className="text-muted-foreground text-sm">No folders in here.</p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto text-sm" aria-label="Folders">
          {folders.map((folder) => (
            <li key={folder.path} className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="hover:bg-muted flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:underline"
                onClick={() => setPath(folder.path)}
                aria-label={`Open ${folder.name}`}
              >
                {folder.shared ? (
                  <Users className="text-muted-foreground size-4 shrink-0" />
                ) : (
                  <Folder className="text-muted-foreground size-4 shrink-0" />
                )}
                <span className="truncate">{folder.name}</span>
                {folder.shared && teamSpace && (
                  <span className="text-muted-foreground shrink-0 text-xs">Team folder</span>
                )}
              </button>
              {isWatched(folder.path) ? (
                <span className="text-muted-foreground shrink-0 text-xs">Watched</span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  disabled={adding !== null}
                  onClick={() => void watch(folder.path)}
                  aria-label={`Watch ${folder.name}`}
                >
                  {adding === folder.path ? "Adding" : "Watch"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {path !== "" && !isWatched(path) && (
        <div>
          <Button size="sm" disabled={adding !== null} onClick={() => void watch(path)}>
            {adding === path ? "Adding" : `Watch ${crumbs[crumbs.length - 1].name}`}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * What is already in the watched folders: listed when asked for, newest first, with
 * tick boxes, and brought over in one press.
 */
function AlreadyThere() {
  const team = useActiveTeam();
  const listFiles = useAction(api.dropbox.pastFiles);
  const bringOver = useAction(api.dropbox.bringOver);
  const [files, setFiles] = useState<PastFile[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<"list" | "bring" | null>(null);

  async function find() {
    setBusy("list");
    try {
      const list = await listFiles({ organizationId: team.id });
      setFiles(list);
      setPicked(new Set(list.filter((one) => !one.brought).map((one) => one.fileId)));
    } catch (caught) {
      toast.error(errorMessage(caught, "Dropbox could not be reached. Try again."));
    } finally {
      setBusy(null);
    }
  }

  const shown = useMemo(() => {
    const words = search.trim().toLowerCase();
    return (files ?? []).filter((one) => !words || one.path.toLowerCase().includes(words));
  }, [files, search]);
  const fresh = (files ?? []).filter((one) => !one.brought);
  const shownFresh = shown.filter((one) => !one.brought);
  const shownPicked = shownFresh.filter((one) => picked.has(one.fileId)).length;
  const pickedCount = fresh.filter((one) => picked.has(one.fileId)).length;

  function setMany(ids: string[], on: boolean) {
    setPicked((before) => {
      const next = new Set(before);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function bring() {
    const ids = fresh.filter((one) => picked.has(one.fileId)).map((one) => one.fileId);
    setBusy("bring");
    try {
      const outcome = await bringOver({ organizationId: team.id, fileIds: ids.slice(0, 500) });
      toast.success(
        outcome.started > 0
          ? `${plural(outcome.started, "file")} on the way to Uploads`
          : "Those files are already in Uploads",
      );
      const sent = new Set(ids.slice(0, 500));
      setFiles((list) =>
        (list ?? []).map((one) => (sent.has(one.fileId) ? { ...one, brought: true } : one)),
      );
      setPicked(new Set());
    } catch (caught) {
      toast.error(errorMessage(caught, "Those files could not be brought over."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Already in these folders">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium">Already in these folders</p>
          <p className="text-muted-foreground text-sm">
            Only files added from now on come in by themselves. Bring over what is there already.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={busy !== null}
          onClick={find}
        >
          {busy === "list" ? "Asking Dropbox" : files ? "Look again" : "Find files"}
        </Button>
      </div>

      {files !== null && files.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No videos, sounds or pictures in the folders you watch.
        </p>
      )}

      {files !== null && files.length > 0 && (
        <>
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search files"
              aria-label="Search files"
              className="pl-8"
            />
          </div>
          {fresh.length > 0 && (
            <div className="bg-muted/50 flex items-center justify-between gap-3 rounded-lg px-3 py-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={
                    shownFresh.length === 0
                      ? false
                      : shownPicked === shownFresh.length
                        ? true
                        : shownPicked === 0
                          ? false
                          : "indeterminate"
                  }
                  disabled={shownFresh.length === 0}
                  onCheckedChange={(on) =>
                    setMany(
                      shownFresh.map((one) => one.fileId),
                      on === true,
                    )
                  }
                  aria-label="Pick every file shown that is not in Uploads"
                />
                {pickedCount === fresh.length
                  ? `All ${fresh.length.toLocaleString()} picked`
                  : `${pickedCount.toLocaleString()} of ${fresh.length.toLocaleString()} picked`}
              </label>
              <Button size="sm" disabled={busy !== null || pickedCount === 0} onClick={bring}>
                {busy === "bring" ? "Bringing over" : `Bring over ${plural(pickedCount, "file")}`}
              </Button>
            </div>
          )}
          {shown.length === 0 ? (
            <p className="text-muted-foreground text-sm">No files match.</p>
          ) : (
            <ul className="flex max-h-96 flex-col gap-1.5 overflow-y-auto text-sm">
              {shown.map((one) => {
                const Icon = KIND_ICON[one.kind];
                return (
                  <li key={one.fileId} className="flex items-center gap-3">
                    {one.brought ? (
                      <span className="size-4 shrink-0" />
                    ) : (
                      <Checkbox
                        checked={picked.has(one.fileId)}
                        onCheckedChange={(on) => setMany([one.fileId], on === true)}
                        aria-label={`Pick ${one.name}`}
                      />
                    )}
                    <Icon className="text-muted-foreground size-4 shrink-0" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-medium">{one.name}</span>
                      <span className="text-muted-foreground truncate text-xs">
                        {parentOf(one.path)} · {when(one.modifiedAt)} · {formatBytes(one.size)}
                      </span>
                    </span>
                    {one.brought && (
                      <span className="text-muted-foreground shrink-0 text-xs">In Uploads</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

type DropboxImportRow = {
  _id: Id<"dropboxImports">;
  name: string;
  path: string;
  status: "importing" | "done" | "failed" | "duplicate";
  error: string | null;
};

type DropboxSendRow = {
  _id: Id<"dropboxSends">;
  name: string;
  automationName: string;
  folder: string;
  dropboxPath: string | null;
  size: number;
  offset: number;
  status: "sending" | "done" | "failed";
  error: string | null;
};
