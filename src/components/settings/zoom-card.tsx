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

import { SettingsSection, SettingsTabs } from "./settings-shell";

/** What Settings says when Zoom sends someone back, by the result in the address. */
export const ZOOM_RESULTS: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Your Zoom is connected" },
  account_connected: {
    ok: true,
    text: "The whole Zoom account is connected. Every host's recordings now come in",
  },
  account_taken: {
    ok: false,
    text: "That Zoom account is already connected as a whole to another team.",
  },
  not_manager: {
    ok: false,
    text: "Only a team owner or admin can connect a whole Zoom account.",
  },
  cancelled: { ok: false, text: "Nothing changed: Zoom was closed before it finished." },
  expired: { ok: false, text: "That took too long. Press the button again." },
  taken: { ok: false, text: "That Zoom account is already connected to another team." },
  taken_here: {
    ok: false,
    text: "Someone else on the team has already connected that Zoom account.",
  },
  not_member: { ok: false, text: "You are no longer on this team." },
  not_ready: { ok: false, text: "Zoom is not set up on this dashboard yet." },
  refused: { ok: false, text: "Zoom did not finish signing you in. Try again." },
  unreachable: { ok: false, text: "Zoom could not be reached. Try again in a minute." },
};

type Past = {
  meetingUuid: string;
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
  done: "In Uploads",
  failed: "Did not come in",
} as const;

/**
 * Zoom meetings, brought in by themselves. Each person who hosts meetings connects their
 * own Zoom once; their finished cloud recordings then land in Uploads, ready to clip.
 */
export function ZoomCard() {
  const team = useActiveTeam();
  const zoom = useQuery(api.zoom.forTeam, { organizationId: team.id });
  const startLink = useMutation(api.zoom.startLink);
  const disconnect = useMutation(api.zoom.disconnect);
  const setAutoImport = useMutation(api.zoom.setAutoImport);
  const listPast = useAction(api.zoom.pastRecordings);
  const bringIn = useAction(api.zoom.bringIn);
  const [busy, setBusy] = useState<string | null>(null);
  const [past, setPast] = useState<Past[] | null>(null);

  // Coming back from Zoom: say how it went once, then tidy the address.
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("zoom");
    if (!result) return;
    const said = ZOOM_RESULTS[result] ?? ZOOM_RESULTS.refused;
    if (said.ok) toast.success(said.text);
    else toast.error(said.text);
    url.searchParams.delete("zoom");
    window.history.replaceState(null, "", url.toString());
  }, []);

  if (zoom === undefined) return <Skeleton className="h-40 rounded-xl" />;
  if (zoom === null) return null;

  async function connect(wholeAccount = false) {
    setBusy(wholeAccount ? "connect-account" : "connect");
    try {
      window.location.assign(
        await startLink({
          organizationId: team.id,
          ...(wholeAccount ? { wholeAccount: true } : {}),
        }),
      );
    } catch (caught) {
      toast.error(errorMessage(caught, "Zoom could not be opened. Try again."));
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

  if (!zoom.ready) {
    return (
      <SettingsSection data-zoom-card>
        <p className="text-muted-foreground text-sm">
          Zoom is not set up on this dashboard yet. Whoever runs the dashboard sets up its Zoom app
          once, then everyone on every team can connect their own Zoom here.
        </p>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection data-zoom-card>
      <SettingsTabs
        label="Zoom"
        tabs={[
          { id: "connection", label: "Connection" },
          ...(zoom.me !== null || zoom.wholeAccount !== null || zoom.imports.length > 0
            ? [{ id: "recordings", label: "Past Recordings" }]
            : []),
        ]}
      >
        <TabsContent value="connection" className="flex flex-col gap-8">
          <section className="flex flex-col gap-3" aria-label="Your Zoom">
            {zoom.me ? (
              <>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    Connected as <span className="font-medium">{zoom.me.zoomName}</span>
                    {zoom.me.zoomEmail && (
                      <span className="text-muted-foreground"> · {zoom.me.zoomEmail}</span>
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
                        "Your Zoom is disconnected",
                      )
                    }
                  >
                    Disconnect
                  </Button>
                </div>
                <div className="flex items-start gap-3">
                  <Switch
                    id="zoom-auto"
                    checked={zoom.me.autoImport}
                    disabled={busy !== null}
                    onCheckedChange={(checked) =>
                      run("auto", () =>
                        setAutoImport({ organizationId: team.id, autoImport: checked }),
                      )
                    }
                  />
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="zoom-auto">Bring in new recordings by themselves</Label>
                    <p className="text-muted-foreground text-sm">
                      When Zoom finishes a cloud recording of a meeting you host, its video goes to
                      Uploads and starts any automation set to run on an upload.
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-muted-foreground text-sm">
                  Connect the Zoom account you host meetings with. Its cloud recordings then come
                  into Uploads by themselves, ready to clip and caption.
                </p>
                <div>
                  <Button size="sm" disabled={busy !== null} onClick={() => connect()}>
                    {busy === "connect" ? "Opening Zoom" : "Connect Zoom"}
                  </Button>
                </div>
              </>
            )}
            {zoom.others.length > 0 && (
              <p className="text-muted-foreground text-sm">
                Also connected on this team:{" "}
                {zoom.others
                  .map((one) =>
                    one.memberName ? `${one.memberName} (${one.zoomName})` : one.zoomName,
                  )
                  .join(", ")}
                .
              </p>
            )}
          </section>

          {zoom.accountReady && (
            <section className="flex flex-col gap-3" aria-label="Whole Zoom account">
              <p className="text-sm font-medium">Whole Zoom account</p>
              {zoom.wholeAccount ? (
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    Every host&apos;s recordings come in, connected by{" "}
                    <span className="font-medium">
                      {zoom.wholeAccount.memberName ?? zoom.wholeAccount.zoomName}
                    </span>
                    {zoom.wholeAccount.zoomEmail && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {zoom.wholeAccount.zoomEmail}
                      </span>
                    )}
                  </span>
                  {(zoom.canManage || zoom.wholeAccount.mine) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() =>
                        run(
                          "disconnect-account",
                          () => disconnect({ organizationId: team.id, wholeAccount: true }),
                          "The whole Zoom account is disconnected",
                        )
                      }
                    >
                      Disconnect
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <p className="text-muted-foreground text-sm">
                    A Zoom account admin can connect the whole Zoom account once. Then the cloud
                    recordings of every host in it come into Uploads, without each person
                    connecting.
                  </p>
                  {zoom.canManage ? (
                    <div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => connect(true)}
                      >
                        {busy === "connect-account" ? "Opening Zoom" : "Connect whole Zoom account"}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      Ask a team owner or admin to connect it.
                    </p>
                  )}
                </>
              )}
            </section>
          )}
        </TabsContent>
        <TabsContent value="recordings" className="flex flex-col gap-8">
          {(zoom.me || zoom.wholeAccount) && (
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
                  {busy === "past" ? "Asking Zoom" : past ? "Look again" : "Show the last 30 days"}
                </Button>
              </div>
              {past !== null &&
                (past.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No cloud recordings in the last 30 days.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {past.map((meeting) => (
                      <li
                        key={meeting.meetingUuid}
                        className="flex items-center justify-between gap-3"
                      >
                        <span className="min-w-0">
                          <span className="font-medium">{meeting.topic}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            · {when(meeting.startTime)}
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
                                `bring-${meeting.meetingUuid}`,
                                async () => {
                                  await bringIn({
                                    organizationId: team.id,
                                    meetingUuid: meeting.meetingUuid,
                                  });
                                  setPast((list) =>
                                    (list ?? []).map((one) =>
                                      one.meetingUuid === meeting.meetingUuid
                                        ? { ...one, brought: true }
                                        : one,
                                    ),
                                  );
                                },
                                `${meeting.topic} is on its way to Uploads`,
                              )
                            }
                          >
                            {busy === `bring-${meeting.meetingUuid}` ? "Starting" : "Bring in"}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                ))}
            </section>
          )}

          {zoom.imports.length > 0 && (
            <section className="flex flex-col gap-3" aria-label="Brought in from Zoom">
              <p className="text-sm font-medium">Brought in from Zoom</p>
              <ul className="flex flex-col gap-2 text-sm">
                {zoom.imports.map((one: ZoomImportRow) => (
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
                          <Link href="/uploads" className="underline-offset-4 hover:underline">
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

type ZoomImportRow = {
  _id: Id<"zoomImports">;
  topic: string;
  startTime: number;
  status: "importing" | "done" | "failed";
  error: string | null;
};
