"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { STARTERS } from "@ncat-dash/automation-core";
import { useMutation, useQuery } from "convex/react";
import { Hourglass, MoreHorizontal, Plus, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { triggerSummary } from "@/lib/automations";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { RunStatusBadge } from "./run-status";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function AutomationsView() {
  const team = useActiveTeam();
  const router = useRouter();
  const automations = useQuery(api.automations.list, { organizationId: team.id });
  const approvals = useQuery(api.runs.waitingApprovals, { organizationId: team.id });
  const create = useMutation(api.automations.create);
  const setEnabled = useMutation(api.automations.setEnabled);
  const remove = useMutation(api.automations.remove);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(STARTERS[0].name);
  const [starterId, setStarterId] = useState<string | null>(STARTERS[0].id);
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState<{ id: Id<"automations">; name: string } | null>(null);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const id = await create({
        organizationId: team.id,
        name,
        starterId: starterId ?? undefined,
      });
      router.push(`/automations/${id}`);
    } catch (caught) {
      toast.error(errorMessage(caught, "The automation could not be created. Try again."));
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Chains of steps that run on your toolkit by themselves: when a file arrives, on a
            schedule, or when another tool calls them.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus />
          New automation
        </Button>
      </div>

      {approvals && approvals.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border p-4">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Hourglass className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            Waiting for approval
          </h2>
          <ul className="flex flex-col gap-1">
            {approvals.map((approval) => (
              <li key={approval.runStepId} className="flex items-center justify-between gap-3">
                <span className="truncate text-sm">
                  {approval.automationName}
                  {approval.waitingSince && (
                    <span className="text-muted-foreground">
                      {" "}
                      since {when.format(approval.waitingSince)}
                    </span>
                  )}
                </span>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/automations/${approval.automationId}/runs/${approval.runId}`}>
                    Review
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {automations === undefined ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : automations.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
          <div className="bg-muted flex size-10 items-center justify-center rounded-lg">
            <Workflow className="size-5" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="font-medium">No automations yet</h2>
            <p className="text-muted-foreground max-w-sm text-sm">
              Build one from the steps you have already tried, then switch it on and leave it
              running.
            </p>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus />
            New automation
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Starts</TableHead>
                <TableHead>Steps</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>On</TableHead>
                <TableHead>
                  <span className="sr-only">More</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {automations.map((automation) => (
                <TableRow key={automation._id}>
                  <TableCell className="font-medium">
                    <Link href={`/automations/${automation._id}`} className="hover:underline">
                      {automation.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {triggerSummary(automation.trigger)}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {automation.stepCount}
                  </TableCell>
                  <TableCell>
                    {automation.lastRun ? (
                      <Link
                        href={`/automations/${automation._id}/runs/${automation.lastRun._id}`}
                        className="inline-flex items-center gap-2"
                      >
                        <RunStatusBadge status={automation.lastRun.status} />
                        <span className="text-muted-foreground text-sm">
                          {when.format(automation.lastRun.startedAt)}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-muted-foreground text-sm">Never</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`${automation.name} is ${automation.enabled ? "on" : "off"}`}
                      checked={automation.enabled}
                      onCheckedChange={async (enabled) => {
                        try {
                          await setEnabled({ automationId: automation._id, enabled });
                        } catch (caught) {
                          toast.error(errorMessage(caught, "It could not be switched on."));
                        }
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal />
                          <span className="sr-only">More for {automation.name}</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/automations/${automation._id}`}>Open</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() =>
                            setRemoving({ id: automation._id, name: automation.name })
                          }
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <form onSubmit={onCreate} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>New automation</DialogTitle>
              <DialogDescription>
                Start from a ready-made one or from an empty canvas. Everything can be changed
                afterwards.
              </DialogDescription>
            </DialogHeader>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Start from</legend>
              {[
                ...STARTERS,
                {
                  id: null,
                  name: "Empty canvas",
                  description: "For builders: add your own steps one at a time.",
                },
              ].map((option) => (
                <label
                  key={option.id ?? "blank"}
                  className="has-checked:border-ring has-checked:bg-muted/50 has-focus-visible:ring-ring/50 flex cursor-pointer gap-3 rounded-lg border p-3 has-focus-visible:ring-3"
                >
                  <input
                    type="radio"
                    name="starter"
                    className="accent-primary mt-1"
                    checked={starterId === option.id}
                    onChange={() => {
                      setStarterId(option.id);
                      if (!name || STARTERS.some((starter) => starter.name === name)) {
                        setName(option.id ? option.name : "");
                      }
                    }}
                  />
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium">{option.name}</span>
                    <span className="text-muted-foreground text-sm">{option.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Field>
              <FieldLabel htmlFor="automation-name">Name</FieldLabel>
              <Input
                id="automation-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Caption new uploads"
                maxLength={80}
                required
                autoComplete="off"
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(next) => !next && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {removing?.name}?</DialogTitle>
            <DialogDescription>
              It stops running and cannot be brought back. Files it has already made are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (removing) await remove({ automationId: removing.id });
                setRemoving(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
