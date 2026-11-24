"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { Folder, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { SettingsSection, SettingsTabs } from "./settings-shell";

/** What Settings says when Dropbox sends someone back, by the result in the address. */
export const DROPBOX_RESULTS: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Your Dropbox is connected. Tick the folders to bring in." },
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

const IMPORT_TEXT = {
  importing: "Coming in",
  done: "In the Library",
  failed: "Did not come in",
  duplicate: "Already in the Library",
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

/**
 * Dropbox, both ways. Each person connects their own Dropbox once; the dashboard reads it
 * and lists the folders with media, their own or the team's. Ticked folders come into
 * the Library, now and from then on, and automations can send finished clips back.
 */
export function DropboxCard() {
  const team = useActiveTeam();
  const box = useQuery(api.dropbox.forTeam, { organizationId: team.id });
  const startLink = useMutation(api.dropbox.startLink);
  const disconnect = useMutation(api.dropbox.disconnect);
  const setAutoImport = useMutation(api.dropbox.setAutoImport);
  const sendAgain = useMutation(api.dropbox.sendAgain);
  const [busy, setBusy] = useState<string | null>(null);

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
    <SettingsSection data-dropbox-card>
      <SettingsTabs
        label="Dropbox"
        tabs={[
          { id: "connection", label: "Connection" },
          ...(me !== null || box.imports.length > 0 || box.sends.length > 0
            ? [{ id: "folders", label: "Folders" }]
            : []),
        ]}
      >
        <TabsContent value="connection" className="flex flex-col gap-8">
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
                      run("auto", () =>
                        setAutoImport({ organizationId: team.id, autoImport: checked }),
                      )
                    }
                  />
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="dropbox-auto">Bring in new files by themselves</Label>
                    <p className="text-muted-foreground text-sm">
                      When a video, sound or picture is added to a folder you watch, it goes to the
                      Library and starts any automation set to run on an upload. Documents and other
                      files stay in Dropbox.
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-muted-foreground text-sm">
                  Connect your Dropbox, then tick the folders to bring in. Their footage comes into
                  the Library, now and whenever more is added, and automations can send finished
                  clips back to Dropbox.
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
        </TabsContent>
        <TabsContent value="folders" className="flex flex-col gap-8">
          {me && <MediaFolders watched={me.folders} teamSpace={me.teamSpace} />}

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
                          <Link href="/library" className="underline-offset-4 hover:underline">
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
                          onClick={() =>
                            run(`send-${one._id}`, () => sendAgain({ sendId: one._id }))
                          }
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
        </TabsContent>
      </SettingsTabs>
    </SettingsSection>
  );
}

/** "/Raw footage/Day 1/clip.mp4" gives "/Raw footage/Day 1". */
function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut > 0 ? path.slice(0, cut) : "/";
}

type MediaFolder = {
  path: string;
  name: string;
  files: number | null;
  fresh: number;
  watched: boolean;
};

type WatchedFolder = { _id: Id<"dropboxFolders">; path: string; recursive: boolean };

/** How a watched folder reads in the list: the very top is all of Dropbox. */
export function folderLabel(path: string): string {
  return path === "/" || path === "" ? "All of Dropbox" : path;
}

/**
 * Every folder in the person's Dropbox that holds videos, sounds or pictures, read in one
 * go, with tick boxes. One press watches the ticked folders, brings in what is in them,
 * and stops watching the ones unticked. Like Google Photos' "Back up device folders".
 */
function MediaFolders({ watched, teamSpace }: { watched: WatchedFolder[]; teamSpace: boolean }) {
  const team = useActiveTeam();
  const scan = useAction(api.dropbox.scan);
  const pullIn = useAction(api.dropbox.pullIn);
  const removeFolder = useMutation(api.dropbox.removeFolder);
  const [found, setFound] = useState<{ folders: MediaFolder[]; partial: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  // Only what the person changed; anything else is ticked when it is watched now.
  const [changed, setChanged] = useState<Map<string, boolean>>(new Map());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let current = true;
    scan({ organizationId: team.id })
      .then((result) => {
        if (!current) return;
        setFailed(false);
        setFound(result);
      })
      .catch((caught) => {
        if (!current) return;
        setFailed(true);
        toast.error(errorMessage(caught, "Dropbox could not be read. Try again."));
      });
    return () => {
      current = false;
    };
  }, [scan, team.id, round]);

  const watchedKeys = useMemo(
    () => new Set(watched.map((one) => one.path.toLowerCase())),
    [watched],
  );
  const isPicked = (path: string) => {
    const key = path.toLowerCase();
    return changed.get(key) ?? watchedKeys.has(key);
  };

  const rows = useMemo(() => {
    const list: MediaFolder[] = (found?.folders ?? []).map((one) => ({ ...one }));
    const listed = new Set(list.map((one) => one.path.toLowerCase()));
    // Watched folders with no media right in them still show, so they can be unticked.
    for (const one of watched) {
      if (listed.has(one.path.toLowerCase())) continue;
      list.push({
        path: one.path,
        name: one.path === "/" ? "All of Dropbox" : one.path.slice(one.path.lastIndexOf("/") + 1),
        files: null,
        fresh: 0,
        watched: true,
      });
    }
    return list;
  }, [found, watched]);

  const words = search.trim().toLowerCase();
  const shown = rows.filter((one) => !words || one.path.toLowerCase().includes(words));
  const toAdd = rows.filter(
    (one) => isPicked(one.path) && !watchedKeys.has(one.path.toLowerCase()),
  );
  const toRemove = watched.filter((one) => !isPicked(one.path));

  function flip(path: string, on: boolean) {
    setChanged((before) => new Map(before).set(path.toLowerCase(), on));
  }

  async function apply() {
    setBusy(true);
    try {
      for (const one of toRemove) await removeFolder({ folderId: one._id });
      let started = 0;
      let more = false;
      for (let i = 0; i < toAdd.length; i += 50) {
        const outcome = await pullIn({
          organizationId: team.id,
          paths: toAdd.slice(i, i + 50).map((one) => one.path),
        });
        started += outcome.started;
        more ||= outcome.more;
      }
      const said: string[] = [];
      if (toAdd.length > 0) {
        said.push(
          started > 0
            ? `${plural(started, "file")} on the way to the Library`
            : `Watching ${plural(toAdd.length, "folder")}`,
        );
      }
      if (toRemove.length > 0) said.push(`stopped watching ${plural(toRemove.length, "folder")}`);
      const text = said.join(", ");
      toast.success(text.charAt(0).toUpperCase() + text.slice(1));
      if (more) toast.message("More files are waiting. Press Bring in again for the rest.");
      setChanged(new Map());
      setRound((n) => n + 1);
    } catch (caught) {
      toast.error(errorMessage(caught, "Those folders could not be brought in."));
    } finally {
      setBusy(false);
    }
  }

  const label =
    toAdd.length > 0
      ? `Bring in ${plural(toAdd.length, "folder")}`
      : toRemove.length > 0
        ? `Stop watching ${plural(toRemove.length, "folder")}`
        : "Bring in";

  return (
    <section className="flex flex-col gap-3" aria-label="Folders with media">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">Folders with videos, sounds or pictures</p>
        <p className="text-muted-foreground text-sm">
          Tick the folders to bring in. What is in them now comes into the Library, and anything
          added later comes in by itself.{teamSpace ? " Team folders are included." : ""}
        </p>
      </div>

      {found === null && !failed && (
        <div className="flex flex-col gap-2" aria-label="Reading your Dropbox">
          <p className="text-muted-foreground text-sm">Reading your Dropbox</p>
          <Skeleton className="h-8 rounded-lg" />
          <Skeleton className="h-8 rounded-lg" />
          <Skeleton className="h-8 rounded-lg" />
        </div>
      )}

      {failed && found === null && (
        <div>
          <Button size="sm" variant="outline" onClick={() => setRound((n) => n + 1)}>
            Try again
          </Button>
        </div>
      )}

      {found !== null && rows.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No videos, sounds or pictures in your Dropbox yet. Once some are there, open this page
          again and they show up here.
        </p>
      )}

      {rows.length > 0 && (
        <>
          {rows.length > 8 && (
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search folders"
                aria-label="Search folders"
                className="pl-8"
              />
            </div>
          )}
          {shown.length === 0 ? (
            <p className="text-muted-foreground text-sm">No folders match.</p>
          ) : (
            <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto text-sm">
              {shown.map((one) => {
                const key = one.path.toLowerCase();
                const id = `dropbox-folder-${key}`;
                return (
                  <li
                    key={key}
                    className="hover:bg-muted/50 flex items-center gap-3 rounded-lg px-2 py-1.5"
                  >
                    <Checkbox
                      id={id}
                      checked={isPicked(one.path)}
                      disabled={busy}
                      onCheckedChange={(on) => flip(one.path, on === true)}
                      aria-label={`Bring in ${folderLabel(one.path)}`}
                    />
                    <label
                      htmlFor={id}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
                    >
                      <Folder className="text-muted-foreground size-4 shrink-0" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{one.name}</span>
                        {one.path !== "/" && (
                          <span className="text-muted-foreground truncate text-xs">{one.path}</span>
                        )}
                      </span>
                    </label>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {one.watched
                        ? "Watching"
                        : one.files === null
                          ? ""
                          : one.fresh === one.files
                            ? plural(one.files, "file")
                            : one.fresh === 0
                              ? "All in the Library"
                              : `${one.fresh.toLocaleString()} new of ${one.files.toLocaleString()}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {found?.partial && (
            <p className="text-muted-foreground text-sm">
              Your Dropbox is very big, so only the first part was read. Search for a folder by name
              if it is not listed.
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground text-sm">
              {plural(rows.filter((one) => isPicked(one.path)).length, "folder")} ticked
            </span>
            <Button
              size="sm"
              disabled={busy || (toAdd.length === 0 && toRemove.length === 0)}
              onClick={apply}
            >
              {busy ? "Bringing in" : label}
            </Button>
          </div>
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
