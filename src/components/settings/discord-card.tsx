"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

/** What Settings says when Discord sends someone back, by the result in the address. */
export const DISCORD_RESULTS: Record<string, { ok: boolean; text: string }> = {
  added: { ok: true, text: "The agent is in your Discord server" },
  linked: { ok: true, text: "Your Discord is linked" },
  cancelled: { ok: false, text: "Nothing changed: Discord was closed before it finished." },
  expired: { ok: false, text: "That took too long. Press the button again." },
  taken: { ok: false, text: "That Discord server is already linked to another team." },
  not_manager: { ok: false, text: "Only a team owner or admin can add the agent to a server." },
  not_member: { ok: false, text: "You are no longer on this team." },
  no_server: { ok: false, text: "Pick a server on Discord to add the agent to." },
  not_ready: { ok: false, text: "Discord is not set up on this dashboard yet." },
  refused: { ok: false, text: "Discord did not finish signing you in. Try again." },
  unreachable: { ok: false, text: "Discord could not be reached. Try again in a minute." },
};

function day(at: number) {
  return new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The agent in Discord. The dashboard has one Discord bot; a team adds it to its own
 * server here, and each person links their own Discord account so the agent knows who
 * wrote and does only what they could do here.
 */
export function DiscordCard() {
  const team = useActiveTeam();
  const discord = useQuery(api.discord.forTeam, { organizationId: team.id });
  const startLink = useMutation(api.discord.startLink);
  const removeServer = useMutation(api.discord.removeServer);
  const unlinkMe = useMutation(api.discord.unlinkMe);
  const [busy, setBusy] = useState<string | null>(null);

  // Coming back from Discord: say how it went once, then tidy the address.
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("discord");
    if (!result) return;
    const said = DISCORD_RESULTS[result] ?? DISCORD_RESULTS.refused;
    if (said.ok) toast.success(said.text);
    else toast.error(said.text);
    url.searchParams.delete("discord");
    window.history.replaceState(null, "", url.toString());
  }, []);

  if (discord === undefined) return <Skeleton className="h-40 max-w-xl rounded-xl" />;
  if (discord === null) return null;

  async function go(kind: "server" | "person") {
    setBusy(kind);
    try {
      window.location.assign(await startLink({ organizationId: team.id, kind }));
    } catch (caught) {
      toast.error(errorMessage(caught, "Discord could not be opened. Try again."));
      setBusy(null);
    }
  }

  async function run(key: string, work: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await work();
      toast.success(done);
    } catch (caught) {
      toast.error(errorMessage(caught, "That did not work. Try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="max-w-xl" data-discord-card>
      <CardHeader>
        <CardTitle>
          <h2>Discord</h2>
        </CardTitle>
        <CardDescription>
          Tag the agent in your Discord server or message it directly, and it answers there.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {!discord.ready ? (
          <p className="text-muted-foreground text-sm">
            Discord is not set up on this dashboard yet. Whoever runs the dashboard sets up its
            Discord bot once, then every team can add it here.
          </p>
        ) : (
          <>
            <section className="flex flex-col gap-3" aria-label="Your Discord servers">
              {discord.servers.length > 0 ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {discord.servers.map((server) => (
                    <li key={server.guildId} className="flex items-center justify-between gap-3">
                      <span>
                        <span className="font-medium">{server.guildName}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · added {day(server.addedAt)}
                          {server.addedBy ? ` by ${server.addedBy}` : ""}
                        </span>
                      </span>
                      {discord.canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy !== null}
                          onClick={() =>
                            run(
                              `remove-${server.guildId}`,
                              () =>
                                removeServer({ organizationId: team.id, guildId: server.guildId }),
                              `The agent no longer answers in ${server.guildName}`,
                            )
                          }
                        >
                          Remove
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {discord.canEdit
                    ? "Add the agent to your team's Discord server. Discord asks which server, then you're back here."
                    : "The agent is not in a Discord server yet. A team owner or admin can add it here."}
                </p>
              )}
              {discord.canEdit && (
                <div>
                  <Button
                    size="sm"
                    variant={discord.servers.length ? "outline" : "default"}
                    disabled={busy !== null}
                    onClick={() => go("server")}
                  >
                    {busy === "server"
                      ? "Opening Discord"
                      : discord.servers.length
                        ? "Add to another server"
                        : "Add to Discord"}
                  </Button>
                </div>
              )}
            </section>

            <section className="flex flex-col gap-2" aria-label="Your Discord account">
              <p className="text-sm font-medium">Your Discord account</p>
              {discord.me ? (
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    Linked as <span className="font-medium">{discord.me.discordName}</span>
                    <span className="text-muted-foreground"> · {day(discord.me.linkedAt)}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() =>
                      run(
                        "unlink",
                        () => unlinkMe({ organizationId: team.id }),
                        "Your Discord is unlinked",
                      )
                    }
                  >
                    Unlink
                  </Button>
                </div>
              ) : (
                <>
                  <p className="text-muted-foreground text-sm">
                    Discord doesn&apos;t share email addresses, so link your account once. The agent
                    then knows it&apos;s you and does only what you could do here.
                  </p>
                  <div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => go("person")}
                    >
                      {busy === "person" ? "Opening Discord" : "Link my Discord"}
                    </Button>
                  </div>
                </>
              )}
              <p className="text-muted-foreground text-sm">
                {discord.linkedCount === 1
                  ? "1 person on the team has linked their Discord."
                  : `${discord.linkedCount} people on the team have linked their Discord.`}
              </p>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
