"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { errorMessage, formatBytes } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { ChannelMeetings } from "./microsoft-channels";
import { SettingsSection, SettingsTabs } from "./settings-shell";

/** What Settings says when Microsoft sends someone back, by the result in the address. */
export const MICROSOFT_RESULTS: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Your Microsoft account is connected" },
  shared: { ok: true, text: "Meetings shared with you now come in too" },
  channels: { ok: true, text: "Now pick the channels to bring in" },
  cancelled: { ok: false, text: "Nothing changed: Microsoft was closed before it finished." },
  expired: { ok: false, text: "That took too long. Press the button again." },
  taken: { ok: false, text: "That Microsoft account is already connected to another team." },
  taken_here: {
    ok: false,
    text: "Someone else on the team has already connected that Microsoft account.",
  },
  not_member: { ok: false, text: "You are no longer on this team." },
  not_ready: { ok: false, text: "Microsoft 365 is not set up on this dashboard yet." },
  refused: { ok: false, text: "Microsoft did not finish signing you in. Try again." },
  unreachable: { ok: false, text: "Microsoft could not be reached. Try again in a minute." },
};

type Past = {
  itemId: string;
  driveId?: string;
  shared: boolean;
  topic: string;
  startTime: number;
  minutes: number | null;
  size: number;
  brought: boolean;
};

function when(at: number) {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_TEXT = {
  importing: "Coming in",
  done: "In the Library",
  failed: "Did not come in",
} as const;

/**
 * Teams meetings, brought in by themselves. Each person who organizes meetings connects
 * their own Microsoft 365 account once; the recordings Teams saves to their OneDrive then
 * land in the Library, ready to clip.
 */
export function MicrosoftCard() {
  const team = useActiveTeam();
  const ms = useQuery(api.microsoft.forTeam, { organizationId: team.id });
  const startLink = useMutation(api.microsoft.startLink);
  const disconnect = useMutation(api.microsoft.disconnect);
  const setAutoImport = useMutation(api.microsoft.setAutoImport);
  const setIncludeShared = useMutation(api.microsoft.setIncludeShared);
  const listPast = useAction(api.microsoft.pastRecordings);
  const bringIn = useAction(api.microsoft.bringIn);
  const [busy, setBusy] = useState<string | null>(null);
  const [past, setPast] = useState<Past[] | null>(null);

  // Coming back from Microsoft: say how it went once, then tidy the address.
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("microsoft");
    if (!result) return;
    const said = MICROSOFT_RESULTS[result] ?? MICROSOFT_RESULTS.refused;
    if (said.ok) toast.success(said.text);
    else toast.error(said.text);
    url.searchParams.delete("microsoft");
    window.history.replaceState(null, "", url.toString());
  }, []);

  if (ms === undefined) return <Skeleton className="h-40 rounded-xl" />;
  if (ms === null) return null;

  async function connect(kind: "connect" | "shared" | "channels" = "connect") {
    setBusy(kind);
    try {
      window.location.assign(
        await startLink({
          organizationId: team.id,
          ...(kind === "shared" ? { shared: true } : {}),
          ...(kind === "channels" ? { channels: true } : {}),
        }),
      );
    } catch (caught) {
      toast.error(errorMessage(caught, "Microsoft could not be opened. Try again."));
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

  if (!ms.ready) {
    return (
      <SettingsSection data-microsoft-card>
        <p className="text-muted-foreground text-sm">
          Microsoft 365 is not set up on this dashboard yet. Whoever runs the dashboard sets up its
          Microsoft app once, then everyone on every team can connect their own account here.
        </p>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection data-microsoft-card>
      <SettingsTabs
        label="Microsoft 365"
        tabs={[
          { id: "connection", label: "Connection" },
          ...(ms.me !== null || ms.imports.length > 0
            ? [{ id: "recordings", label: "Past Recordings" }]
            : []),
        ]}
      >
        <TabsContent value="connection" className="flex flex-col gap-8">
          <section className="flex flex-col gap-3" aria-label="Your Microsoft account">
            {ms.me ? (
              <>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    Connected as <span className="font-medium">{ms.me.msName}</span>
                    {ms.me.msEmail && (
                      <span className="text-muted-foreground"> · {ms.me.msEmail}</span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() =>
                      run(
                        "disconnect",
                        () => disconnect({ organizationId: team.id }),
                        "Your Microsoft account is disconnected",
                      )
                    }
                  >
                    Disconnect
                  </Button>
                </div>
                {ms.me.needsReconnect && (
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-destructive">
                      Microsoft stopped accepting your sign-in, so nothing new comes in.
                    </span>
                    <Button size="sm" disabled={busy !== null} onClick={() => connect()}>
                      Connect again
                    </Button>
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <Switch
                    id="microsoft-auto"
                    checked={ms.me.autoImport}
                    disabled={busy !== null}
                    onCheckedChange={(checked) =>
                      run("auto", () =>
                        setAutoImport({ organizationId: team.id, autoImport: checked }),
                      )
                    }
                  />
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="microsoft-auto">Bring in new recordings by themselves</Label>
                    <p className="text-muted-foreground text-sm">
                      When Teams saves the recording of a meeting you organize to your OneDrive, it
                      goes to the Library and starts any automation set to run on an upload.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Switch
                    id="microsoft-shared"
                    checked={ms.me.includeShared}
                    disabled={busy !== null}
                    onCheckedChange={(checked) =>
                      checked && !ms.me?.sharedGranted
                        ? connect("shared")
                        : run("shared", () =>
                            setIncludeShared({ organizationId: team.id, includeShared: checked }),
                          )
                    }
                  />
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="microsoft-shared">Also bring in meetings shared with me</Label>
                    <p className="text-muted-foreground text-sm">
                      {busy === "shared" && !ms.me.sharedGranted
                        ? "Opening Microsoft to ask for reading files shared with you."
                        : "Recordings of other people's Teams meetings you were in. They arrive within 15 minutes of the meeting ending. The first time, Microsoft asks you to allow reading files shared with you."}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-muted-foreground text-sm">
                  Connect the Microsoft account you hold Teams meetings with. The recordings Teams
                  saves to your OneDrive then come into the Library by themselves, ready to clip and
                  caption.
                </p>
                <div>
                  <Button size="sm" disabled={busy !== null} onClick={() => connect()}>
                    {busy === "connect" ? "Opening Microsoft" : "Connect Microsoft 365"}
                  </Button>
                </div>
              </>
            )}
            {ms.others.length > 0 && (
              <p className="text-muted-foreground text-sm">
                Also connected on this team:{" "}
                {ms.others
                  .map((one) => (one.memberName ? `${one.memberName} (${one.msName})` : one.msName))
                  .join(", ")}
                .
              </p>
            )}
          </section>

          {ms.me && (
            <section className="flex flex-col gap-3" aria-label="Channel meetings">
              <p className="text-sm font-medium">Channel meetings</p>
              <ChannelMeetings
                granted={ms.me.channelsGranted}
                watched={ms.channels}
                opening={busy === "channels"}
                onAllow={() => connect("channels")}
              />
            </section>
          )}
        </TabsContent>
        <TabsContent value="recordings" className="flex flex-col gap-8">
          {ms.me && (
            <section className="flex flex-col gap-3" aria-label="Past recordings">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Past recordings</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    run("past", async () => setPast(await listPast({ organizationId: team.id })))
                  }
                >
                  {busy === "past"
                    ? "Asking OneDrive"
                    : past
                      ? "Look again"
                      : "Show the last 30 days"}
                </Button>
              </div>
              {past !== null &&
                (past.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {ms.me.includeShared
                      ? "No Teams recordings in your OneDrive or shared with you from the last 30 days."
                      : "No Teams recordings in your OneDrive from the last 30 days."}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {past.map((meeting) => (
                      <li
                        key={`${meeting.driveId ?? ""}:${meeting.itemId}`}
                        className="flex items-center justify-between gap-3"
                      >
                        <span className="min-w-0">
                          <span className="font-medium">{meeting.topic}</span>
                          <span className="text-muted-foreground">
                            {meeting.shared ? " · Shared with you" : ""} · {when(meeting.startTime)}
                            {meeting.minutes ? ` · ${meeting.minutes} min` : ""}
                            {meeting.size ? ` · ${formatBytes(meeting.size)}` : ""}
                          </span>
                        </span>
                        {meeting.brought ? (
                          <span className="text-muted-foreground shrink-0">Brought in</span>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="shrink-0"
                            disabled={busy !== null}
                            onClick={() =>
                              run(
                                `bring-${meeting.itemId}`,
                                async () => {
                                  await bringIn({
                                    organizationId: team.id,
                                    itemId: meeting.itemId,
                                    ...(meeting.driveId ? { driveId: meeting.driveId } : {}),
                                  });
                                  setPast((list) =>
                                    (list ?? []).map((one) =>
                                      one.itemId === meeting.itemId &&
                                      one.driveId === meeting.driveId
                                        ? { ...one, brought: true }
                                        : one,
                                    ),
                                  );
                                },
                                `${meeting.topic} is on its way to the Library`,
                              )
                            }
                          >
                            {busy === `bring-${meeting.itemId}` ? "Starting" : "Bring in"}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                ))}
            </section>
          )}

          {ms.imports.length > 0 && (
            <section className="flex flex-col gap-3" aria-label="Brought in from Teams">
              <p className="text-sm font-medium">Brought in from Teams</p>
              <ul className="flex flex-col gap-2 text-sm">
                {ms.imports.map((one: MicrosoftImportRow) => (
                  <li key={one._id} className="flex flex-col gap-0.5">
                    <span className="flex items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="font-medium">{one.topic}</span>
                        <span className="text-muted-foreground"> · {when(one.startTime)}</span>
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
                            {STATUS_TEXT.done}
                          </Link>
                        ) : (
                          STATUS_TEXT[one.status]
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
        </TabsContent>
      </SettingsTabs>
    </SettingsSection>
  );
}

type MicrosoftImportRow = {
  _id: Id<"microsoftImports">;
  topic: string;
  startTime: number;
  status: "importing" | "done" | "failed";
  error: string | null;
};
