"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Check, Copy } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

/** Where agents reach the dashboard's MCP server. */
export function mcpUrl(): string {
  return `${process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? ""}/mcp`;
}

function day(at: number) {
  return new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error("Copy it by hand: the browser did not allow it.");
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function Line({ text, label }: { text: string; label: string }) {
  return (
    <div className="bg-muted/60 flex items-center gap-2 rounded-lg py-1.5 pr-1.5 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-xs" title={text}>
        {text}
      </code>
      <CopyButton text={text} label={label} />
    </div>
  );
}

/**
 * Keys that let Claude and other AI agents start the team's automations through the
 * dashboard's MCP server. Laid out like Linear's API settings: the address and how to
 * connect, then the keys, each named for where it is used.
 */
export function AgentAccessCard() {
  const team = useActiveTeam();
  const access = useQuery(api.mcpKeys.list, { organizationId: team.id });
  const create = useMutation(api.mcpKeys.create);
  const remove = useMutation(api.mcpKeys.remove);
  const [name, setName] = useState("");
  const [made, setMade] = useState<{ name: string; key: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (access === undefined) return <Skeleton className="h-60 rounded-xl" />;
  const url = mcpUrl();

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    try {
      const { key } = await create({ organizationId: team.id, name });
      setMade({ name: name.trim(), key });
      setName("");
    } catch (caught) {
      toast.error(errorMessage(caught, "The key could not be made. Try again."));
    } finally {
      setBusy(null);
    }
  }

  async function onRemove(keyId: Id<"mcpKeys">, keyName: string) {
    setBusy(keyId);
    try {
      await remove({ organizationId: team.id, keyId });
      toast.success(`${keyName} removed. Anything using it is turned away from now on.`);
    } catch (caught) {
      toast.error(errorMessage(caught, "The key could not be removed. Try again."));
    } finally {
      setBusy(null);
    }
  }

  const command = `claude mcp add --transport http content-automations ${url} --header "Authorization: Bearer ${made?.key ?? "<your key>"}"`;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Connect an AI agent</h2>
          </CardTitle>
          <CardDescription>
            Claude Code, Cursor and other agents that speak MCP can list your automations and
            uploads, start an automation on a file, and see how its runs went. They cannot change
            your automations.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">MCP server address</span>
            <Line text={url} label="Copy the MCP server address" />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Add it to Claude Code</span>
            <Line text={command} label="Copy the Claude Code command" />
            <p className="text-muted-foreground text-sm">
              Other agents take the same address with the header{" "}
              <code className="font-mono text-xs">Authorization: Bearer &lt;your key&gt;</code>.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Keys</h2>
          </CardTitle>
          <CardDescription>
            Each key acts for the whole team. Make one for each place you connect, so you can
            remove one without the others.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {!access.canEdit ? (
            <p className="text-muted-foreground text-sm">
              Only a team owner or admin can make or remove keys.
            </p>
          ) : (
            <>
              {made && (
                <div
                  role="status"
                  className="flex flex-col gap-2 rounded-lg bg-emerald-50 p-3"
                >
                  <p className="text-sm font-medium">
                    {made.name}: copy this key now. It is not shown again.
                  </p>
                  <Line text={made.key} label="Copy the new key" />
                </div>
              )}
              <form onSubmit={onCreate}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="mcp-key-name">Name</FieldLabel>
                    <div className="flex gap-2">
                      <Input
                        id="mcp-key-name"
                        placeholder="Claude Code on Maya's laptop"
                        className="max-w-sm"
                        value={name}
                        maxLength={60}
                        onChange={(event) => setName(event.target.value)}
                        required
                      />
                      <Button type="submit" disabled={busy === "create" || !name.trim()}>
                        {busy === "create" ? "Making" : "Make a key"}
                      </Button>
                    </div>
                    <FieldDescription>Where the key will be used, to tell keys apart.</FieldDescription>
                  </Field>
                </FieldGroup>
              </form>
              {access.keys.length > 0 && (
                <ul className="flex flex-col divide-y text-sm" aria-label="Your team's keys">
                  {access.keys.map((key) => (
                    <li key={key.keyId} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0">
                        <span className="font-medium">{key.name}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · ends in {key.hint} · made {day(key.createdAt)} ·{" "}
                          {key.lastUsedAt ? `last used ${day(key.lastUsedAt)}` : "never used"}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === key.keyId}
                        onClick={() => onRemove(key.keyId, key.name)}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
