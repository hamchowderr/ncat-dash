"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { MeetPastRecordings, when } from "./google-meet-past";
import { SettingsSection, SettingsTabs } from "./settings-shell";

/** What Settings says when Google sends someone back, by the result in the address. */
export const MEET_RESULTS: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Your Google Meet is connected" },
  cancelled: { ok: false, text: "Nothing changed: Google was closed before it finished." },
  expired: { ok: false, text: "That took too long. Press the button again." },
  missing_access: {
    ok: false,
    text: "Google did not allow everything needed. Connect again and leave every box ticked.",
  },
  taken: { ok: false, text: "That Google account is already connected to another team." },
  taken_here: {
    ok: false,
    text: "Someone else on the team has already connected that Google account.",
  },
  not_member: { ok: false, text: "You are no longer on this team." },
  not_ready: { ok: false, text: "Google Meet is not set up on this dashboard yet." },
  refused: { ok: false, text: "Google did not finish signing you in. Try again." },
  unreachable: { ok: false, text: "Google could not be reached. Try again in a minute." },
};

const STATUS_TEXT = {
  importing: "Coming in",
  done: "In the Library",
  failed: "Did not come in",
  duplicate: "Already in the Library",
} as const;

/**
 * Google Meet recordings, brought in by themselves. Each person who organizes meetings
 * connects their own Google account once; recordings Meet saves to their Drive then land
 * in the Library, ready to clip.
 */
export function GoogleMeetCard() {
  const team = useActiveTeam();
  const meet = useQuery(api.googleMeet.forTeam, { organizationId: team.id });
  const startLink = useMutation(api.googleMeet.startLink);
  const disconnect = useMutation(api.googleMeet.disconnect);
  const setAutoImport = useMutation(api.googleMeet.setAutoImport);
  const setIncludeShared = useMutation(api.googleMeet.setIncludeShared);
  const [busy, setBusy] = useState<string | null>(null);

  // Coming back from Google: say how it went once, then tidy the address.
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("meet");
    if (!result) return;
    const said = MEET_RESULTS[result] ?? MEET_RESULTS.refused;
    if (said.ok) toast.success(said.text);
    else toast.error(said.text);
    url.searchParams.delete("meet");
    window.history.replaceState(null, "", url.toString());
  }, []);

  if (meet === undefined) return <Skeleton className="h-40 rounded-xl" />;
  if (meet === null) return null;

  async function connect() {
    setBusy("connect");
    try {
      window.location.assign(await startLink({ organizationId: team.id }));
    } catch (caught) {
      toast.error(errorMessage(caught, "Google could not be opened. Try again."));
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

  if (!meet.ready) {
    return (
      <SettingsSection data-meet-card>
        <p className="text-muted-foreground text-sm">
          Google Meet is not set up on this dashboard yet. Whoever runs the dashboard sets up its
          Google app once, then everyone on every team can connect their own Google account here.
        </p>
      </SettingsSection>
    );
  }

  const connectButton = (label: string) => (
    <div>
      <Button size="sm" disabled={busy !== null} onClick={connect}>
        {busy === "connect" ? "Opening Google" : label}
      </Button>
    </div>
  );

  return (
    <SettingsSection data-meet-card>
      <SettingsTabs
        label="Google Meet"
        tabs={[
          { id: "connection", label: "Connection" },
          ...(meet.me !== null || meet.imports.length > 0
            ? [{ id: "recordings", label: "Past Recordings" }]
            : []),
        ]}
      >
        <TabsContent value="connection" className="flex flex-col gap-8">
          <section className="flex flex-col gap-3" aria-label="Your Google account">
            {meet.me ? (
              <>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    Connected as <span className="font-medium">{meet.me.googleName}</span>
                    {meet.me.googleEmail && (
                      <span className="text-muted-foreground"> · {meet.me.googleEmail}</span>
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
                        "Your Google Meet is disconnected",
                      )
                    }
                  >
                    Disconnect
                  </Button>
                </div>
                {meet.me.signInLost && (
                  <>
                    <p className="text-destructive text-sm">
                      Google stopped accepting this sign-in, so new recordings are not coming in.
                      Connect again to pick up where it left off.
                    </p>
                    {connectButton("Connect Google Meet again")}
                  </>
                )}
                <div className="flex items-start gap-3">
                  <Switch
                    id="meet-auto"
                    checked={meet.me.autoImport}
                    disabled={busy !== null}
                    onCheckedChange={(checked) =>
                      run("auto", () =>
                        setAutoImport({ organizationId: team.id, autoImport: checked }),
                      )
                    }
                  />
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="meet-auto">Bring in new recordings by themselves</Label>
                    <p className="text-muted-foreground text-sm">
                      When Meet finishes saving a recording of a meeting you organize, its video
                      goes to the Library within a few minutes and starts any automation set to run
                      on an upload.
                    </p>
                  </div>
                </div>
                {meet.me.autoImport && (
                  <div className="flex items-start gap-3">
                    <Switch
                      id="meet-shared"
                      checked={meet.me.includeShared}
                      disabled={busy !== null}
                      onCheckedChange={(checked) =>
                        run("shared", () =>
                          setIncludeShared({ organizationId: team.id, includeShared: checked }),
                        )
                      }
                    />
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="meet-shared">Also bring in recordings shared with you</Label>
                      <p className="text-muted-foreground text-sm">
                        Recordings of meetings someone else organized come in too, once they share
                        them with your Google account.
                      </p>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-muted-foreground text-sm">
                  Connect the Google account you organize meetings with. The recordings Meet saves
                  to its Drive then come into the Library by themselves, ready to clip and caption.
                </p>
                {connectButton("Connect Google Meet")}
              </>
            )}
            {meet.others.length > 0 && (
              <p className="text-muted-foreground text-sm">
                Also connected on this team:{" "}
                {meet.others
                  .map((one) =>
                    one.memberName ? `${one.memberName} (${one.googleName})` : one.googleName,
                  )
                  .join(", ")}
                .
              </p>
            )}
          </section>
        </TabsContent>
        <TabsContent value="recordings" className="flex flex-col gap-8">
          {meet.me && <MeetPastRecordings organizationId={team.id} />}

          {meet.imports.length > 0 && (
            <section className="flex flex-col gap-3" aria-label="Brought in from Google Meet">
              <p className="text-sm font-medium">Brought in from Google Meet</p>
              <ul className="flex flex-col gap-2 text-sm">
                {meet.imports.map((one: MeetImportRow) => (
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

type MeetImportRow = {
  _id: Id<"googleMeetImports">;
  topic: string;
  startTime: number;
  status: "importing" | "done" | "failed" | "duplicate";
  error: string | null;
};
