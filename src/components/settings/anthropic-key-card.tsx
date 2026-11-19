"use client";

import { api } from "@convex/_generated/api";
import { useAction, useMutation } from "convex/react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { SettingRow, SettingsSection } from "./settings-shell";

const CONSOLE = "https://console.anthropic.com/settings/keys";

/**
 * The team's own Anthropic API key. With one, the agent's chats and the Best moments and
 * Chapters steps run on the team's Anthropic account. Shown afterwards only by its end.
 */
export function AnthropicKeyCard({
  anthropicKey,
  canEdit,
}: {
  anthropicKey: { hint: string; setAt: number } | null;
  canEdit: boolean;
}) {
  const team = useActiveTeam();
  const setKey = useAction(api.anthropicKey.set);
  const removeKey = useMutation(api.anthropicKey.remove);
  const [key, setKeyText] = useState("");
  const [busy, setBusy] = useState(false);
  // Replacing a saved key opens the field again.
  const [replacing, setReplacing] = useState(false);
  const editing = canEdit && (anthropicKey === null || replacing);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    try {
      await setKey({ organizationId: team.id, key });
      setKeyText("");
      setReplacing(false);
      toast.success("Your Anthropic key is saved. The agent now runs on it.");
    } catch (caught) {
      toast.error(errorMessage(caught, "The key could not be saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    try {
      await removeKey({ organizationId: team.id });
      toast.success("Your Anthropic key is removed.");
    } catch (caught) {
      toast.error(errorMessage(caught, "The key could not be removed. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const added = anthropicKey
    ? new Date(anthropicKey.setAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <SettingsSection
      id="anthropic-key"
      title="Your own Anthropic key"
      description={
        <>
          The agent and the Best moments and Chapters steps run on your team&apos;s Anthropic
          account, and Anthropic bills you for them directly. Make a key in the{" "}
          <a
            href={CONSOLE}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Anthropic Console
          </a>
          .
        </>
      }
    >
      {anthropicKey && !replacing && (
        <SettingRow
          label={<span className="tabular-nums">Key ending {anthropicKey.hint}</span>}
          description={`Added ${added}. Only its last four characters are ever shown.`}
        >
          {canEdit && (
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setReplacing(true)}>
                Replace
              </Button>
              <Button type="button" variant="ghost" onClick={onRemove} disabled={busy}>
                Remove
              </Button>
            </div>
          )}
        </SettingRow>
      )}

      {editing && (
        <form onSubmit={onSubmit}>
          <SettingRow
            label="API key"
            htmlFor="anthropic-key-input"
            description="Checked with Anthropic before it is saved, then kept encrypted."
          >
            <div className="flex w-full gap-2 sm:w-auto">
              <Input
                id="anthropic-key-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-ant-…"
                value={key}
                onChange={(event) => setKeyText(event.target.value)}
                className="sm:w-72"
              />
              <Button type="submit" disabled={busy || !key.trim()}>
                {busy ? "Checking" : "Save"}
              </Button>
              {replacing && (
                <Button type="button" variant="ghost" onClick={() => setReplacing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </SettingRow>
        </form>
      )}

      {!canEdit && anthropicKey === null && (
        <p className="text-muted-foreground text-sm">
          The agent runs on the dashboard&apos;s own key. Only a team owner or admin can add one.
        </p>
      )}
    </SettingsSection>
  );
}
