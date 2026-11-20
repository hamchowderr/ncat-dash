"use client";

import { api } from "@convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { SettingsSection } from "./settings-shell";

function day(at: number) {
  return new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The agent and alerts in Telegram. The dashboard has one Telegram bot. Each person
 * links their own Telegram by opening the bot from here and pressing Start; the agent
 * then knows who wrote and does only what they could do here, and their alerts arrive
 * in that chat. Owners and admins can also add the bot to a Telegram group.
 */
export function TelegramCard() {
  const team = useActiveTeam();
  const telegram = useQuery(api.telegram.forTeam, { organizationId: team.id });
  const startLink = useMutation(api.telegram.startLink);
  const removeGroup = useMutation(api.telegram.removeGroup);
  const setReviewGroup = useMutation(api.telegram.setReviewGroup);
  const unlinkMe = useMutation(api.telegram.unlinkMe);
  const [busy, setBusy] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<"person" | "group" | null>(null);
  const groupHearing = useAction(api.telegram.groupHearing);
  const [hearing, setHearing] = useState<Record<string, boolean | null>>({});
  // Asked of Telegram again whenever the team's groups change.
  const groupKey = telegram?.groups.map((group) => group.chatId).join(",") ?? "";
  useEffect(() => {
    if (!groupKey) return;
    let live = true;
    groupHearing({ organizationId: team.id })
      .then((found) => {
        if (live) setHearing(Object.fromEntries(found.map((one) => [one.chatId, one.hears])));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [groupHearing, team.id, groupKey]);

  if (telegram === undefined) return <Skeleton className="h-40 rounded-xl" />;
  if (telegram === null) return null;

  async function open(kind: "person" | "group") {
    // Opened at once, so the browser treats it as the press; Telegram's address follows.
    const tab = window.open("", "_blank");
    setBusy(kind);
    try {
      const url = await startLink({ organizationId: team.id, kind });
      if (tab) tab.location.href = url;
      else window.location.assign(url);
      setWaiting(kind);
    } catch (caught) {
      tab?.close();
      toast.error(errorMessage(caught, "Telegram could not be opened. Try again."));
    } finally {
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

  if (!telegram.ready) {
    return (
      <SettingsSection data-telegram-card className="gap-6">
        <p className="text-muted-foreground text-sm">
          Telegram is not set up on this dashboard yet. Whoever runs the dashboard makes its
          Telegram bot once, then everyone can link their Telegram here.
        </p>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection data-telegram-card className="gap-6">
      <section className="flex flex-col gap-2" aria-label="Your Telegram">
        <p className="text-sm font-medium">Your Telegram</p>
        {telegram.me ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>
              Linked as <span className="font-medium">{telegram.me.telegramName}</span>
              {telegram.me.username && (
                <span className="text-muted-foreground"> (@{telegram.me.username})</span>
              )}
              <span className="text-muted-foreground"> · {day(telegram.me.linkedAt)}</span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() =>
                run(
                  "unlink",
                  () => unlinkMe({ organizationId: team.id }),
                  "Your Telegram is unlinked",
                )
              }
            >
              Unlink
            </Button>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              Telegram opens a chat with @{telegram.botUsername}. Press Start there and you&apos;re
              linked. Then you can write to the agent, and get the alerts you pick in Notifications,
              with Approve and Send back right in the chat.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" disabled={busy !== null} onClick={() => open("person")}>
                {busy === "person" ? "Opening Telegram" : "Link my Telegram"}
              </Button>
              {waiting === "person" && (
                <span className="text-muted-foreground text-sm" role="status">
                  Waiting for you to press Start in Telegram…
                </span>
              )}
            </div>
          </>
        )}
        <p className="text-muted-foreground text-sm">
          {telegram.linkedCount === 1
            ? "1 person on the team has linked their Telegram."
            : `${telegram.linkedCount} people on the team have linked their Telegram.`}
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-label="Your Telegram groups">
        <p className="text-sm font-medium">Groups</p>
        <p className="text-muted-foreground text-sm">
          One group can also hear about reviews: new reviews, client feedback and mentions. Replying
          to one of those posts in Telegram adds your reply to the review.
        </p>
        {telegram.groups.length > 0 ? (
          <ul className="flex flex-col gap-2 text-sm">
            {telegram.groups.map((group) => (
              <li key={group.chatId} className="flex items-center justify-between gap-3">
                <span className="flex flex-col gap-1">
                  <span>
                    <span className="font-medium">{group.title}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · added {day(group.addedAt)}
                      {group.addedBy ? ` by ${group.addedBy}` : ""}
                      {group.reviews ? " · review activity posts here" : ""}
                    </span>
                  </span>
                  {hearing[group.chatId] === false && (
                    <span className="text-amber-700" role="note">
                      Tagging the agent here doesn&apos;t reach it yet, only replies to its messages
                      do. In Telegram, send /setprivacy to @BotFather, pick the bot and choose
                      Disable, then add it to this group again. Making the bot an admin of the group
                      works too.
                    </span>
                  )}
                </span>
                {telegram.canEdit && (
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() =>
                        run(
                          `reviews-${group.chatId}`,
                          () =>
                            setReviewGroup({
                              organizationId: team.id,
                              chatId: group.reviews ? null : group.chatId,
                            }),
                          group.reviews
                            ? `Review activity no longer posts in ${group.title}`
                            : `Review activity now posts in ${group.title}`,
                        )
                      }
                    >
                      {group.reviews ? "Stop review posts" : "Post reviews here"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() =>
                        run(
                          `remove-${group.chatId}`,
                          () => removeGroup({ organizationId: team.id, chatId: group.chatId }),
                          `The agent no longer answers in ${group.title}`,
                        )
                      }
                    >
                      Remove
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            {telegram.canEdit
              ? "Add the agent to your team's Telegram group, so anyone linked can tag it there. Telegram asks which group."
              : "The agent is not in a Telegram group yet. A team owner or admin can add it here."}
          </p>
        )}
        {telegram.canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => open("group")}
            >
              {busy === "group"
                ? "Opening Telegram"
                : telegram.groups.length
                  ? "Add to another group"
                  : "Add to a group"}
            </Button>
            {waiting === "group" && (
              <span className="text-muted-foreground text-sm" role="status">
                Pick the group in Telegram. It shows up here once the agent is in.
              </span>
            )}
          </div>
        )}
      </section>
    </SettingsSection>
  );
}
