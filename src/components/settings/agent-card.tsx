"use client";

import { api } from "@convex/_generated/api";
import { type AgentSettings, PLATFORMS } from "@ncat-dash/automation-core";
import { useMutation } from "convex/react";
import { Check } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

/** "Default" in the model list: the agent server's own model. */
const DEFAULT = "default";

type ModelOption = { id: string; name: string; note: string };

const same = (a: AgentSettings, b: AgentSettings) =>
  a.model === b.model &&
  a.houseRules.trim() === b.houseRules.trim() &&
  a.platforms.length === b.platforms.length &&
  a.platforms.every((name) => b.platforms.includes(name));

/**
 * How the agent works for the team: the model it runs on, house rules it always follows,
 * and the platforms it makes clips for when nobody names any, so it need not ask.
 */
export function AgentCard({
  agent,
  models,
  mostHouseRules,
  canEdit,
}: {
  agent: AgentSettings;
  models: ModelOption[];
  mostHouseRules: number;
  canEdit: boolean;
}) {
  const team = useActiveTeam();
  const setAgent = useMutation(api.teamSettings.setAgent);
  // What this person has changed and not saved yet; null shows what is saved.
  const [draft, setDraft] = useState<AgentSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const shown = draft ?? agent;
  const changed = draft !== null && !same(draft, agent);
  const chosen = models.find((model) => model.id === shown.model);

  const change = (next: Partial<AgentSettings>) => setDraft({ ...shown, ...next });

  function togglePlatform(name: string) {
    const on = shown.platforms.includes(name);
    // Kept in the order the platforms are listed, so the agent is told them the same way.
    change({
      platforms: PLATFORMS.map((platform) => platform.name as string).filter((other) =>
        other === name ? !on : shown.platforms.includes(other),
      ),
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      await setAgent({ organizationId: team.id, agent: draft });
      setDraft(null);
      toast.success("Agent settings saved.");
    } catch (caught) {
      toast.error(errorMessage(caught, "The settings could not be saved. Try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card id="agent" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>
          <h2>Agent</h2>
        </CardTitle>
        <CardDescription>
          How the agent builds automations for your team. It follows these in every chat, for
          everyone on the team.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="agent-model">Model</FieldLabel>
              <Select
                value={shown.model ?? DEFAULT}
                onValueChange={(value) => change({ model: value === DEFAULT ? null : value })}
                disabled={!canEdit}
              >
                <SelectTrigger id="agent-model" className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT}>Default</SelectItem>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                {chosen?.note ?? "The model your agent server is set up with."}
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="agent-rules">House rules</FieldLabel>
              <Textarea
                id="agent-rules"
                rows={4}
                maxLength={mostHouseRules}
                value={shown.houseRules}
                onChange={(event) => change({ houseRules: event.target.value })}
                disabled={!canEdit}
                placeholder={
                  "Captions in our brand colour, never all capitals.\nClips no longer than 45 seconds.\nAlways add an approval step before anything goes out."
                }
              />
              <FieldDescription>
                What the agent should always do or never do, one rule per line. Anyone can still ask
                for something different in a chat.{" "}
                <span className="tabular-nums">
                  {shown.houseRules.length} / {mostHouseRules}
                </span>
              </FieldDescription>
            </Field>

            <FieldSet>
              <FieldLegend variant="label">Default platforms</FieldLegend>
              <FieldDescription>
                When an automation makes clips and nobody says where they are going, the agent makes
                them for these instead of asking. With none ticked, it always asks.
              </FieldDescription>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {PLATFORMS.map((platform) => {
                  const on = shown.platforms.includes(platform.name);
                  return (
                    <button
                      key={platform.name}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      disabled={!canEdit}
                      onClick={() => togglePlatform(platform.name)}
                      className={cn(
                        "bg-surface hover:bg-muted focus-visible:ring-ring/50 flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium outline-none transition-colors focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-60",
                        on && "bg-primary/10 hover:bg-primary/15",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/60",
                        )}
                      >
                        {on && <Check className="size-3" />}
                      </span>
                      <span className="leading-tight">{platform.name}</span>
                    </button>
                  );
                })}
              </div>
            </FieldSet>

            {canEdit ? (
              <Field orientation="horizontal">
                <Button type="submit" disabled={saving || !changed}>
                  {saving ? "Saving" : "Save"}
                </Button>
                {changed && (
                  <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                    Undo changes
                  </Button>
                )}
              </Field>
            ) : (
              <FieldDescription>Only a team owner or admin can change this.</FieldDescription>
            )}
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
