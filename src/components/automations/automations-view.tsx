"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { AutomationNode, Starter } from "@ncat-dash/automation-core";
import { useMutation, useQuery } from "convex/react";
import { Hourglass, MoreHorizontal, Plus, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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

import { FlowStrip } from "./flow-strip";
import { RunStatusBadge } from "./run-status";
import { TemplateGallery } from "./template-gallery";

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
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState<{ id: Id<"automations">; name: string } | null>(null);

  async function onPick(starter: Starter | null) {
    setPending(true);
    try {
      const id = await create({
        organizationId: team.id,
        name: starter?.name ?? "New automation",
        starterId: starter?.id,
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
        <div className="grid gap-5">
          <div className="flex items-center gap-3">
            <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
              <Workflow className="size-5" aria-hidden="true" />
            </div>
            <div className="grid gap-0.5">
              <h2 className="font-medium">Start from a template</h2>
              <p className="text-muted-foreground text-sm">
                Pick one to open it on the canvas. Change it there, switch it on, and it runs by
                itself.
              </p>
            </div>
          </div>
          <TemplateGallery recipes={false} disabled={pending} onPick={onPick} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Starts</TableHead>
                <TableHead>Flow</TableHead>
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
                    {automation.hasDraft && (
                      <Badge
                        variant="outline"
                        className="ml-2"
                        title="Has changes that are not published yet"
                      >
                        Draft
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {triggerSummary(automation.trigger)}
                  </TableCell>
                  <TableCell>
                    <FlowStrip
                      size="sm"
                      trigger={automation.trigger}
                      nodes={automation.nodes as AutomationNode[]}
                      edges={automation.edges}
                    />
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>New automation</DialogTitle>
            <DialogDescription>
              Pick a template to open it on the canvas. Everything can be changed there.
            </DialogDescription>
          </DialogHeader>
          <TemplateGallery disabled={pending} onPick={onPick} />
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
