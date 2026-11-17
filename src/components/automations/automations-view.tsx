"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  automationFileName,
  type AutomationNode,
  exportAutomation,
  MAX_AUTOMATION_FILE_CHARS,
  parseAutomationFile,
  type Starter,
} from "@ncat-dash/automation-core";
import { useMutation, useQuery } from "convex/react";
import { FileUp, Hourglass, MoreHorizontal, Plus, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
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
import { downloadJson } from "@/lib/download";
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
  const importFile = useMutation(api.automations.importFile);
  const picker = useRef<HTMLInputElement>(null);

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

  /** Reads a file someone exported and opens the automation it holds, switched off. */
  async function onImport(file: File | undefined) {
    if (!file) return;
    setPending(true);
    try {
      if (file.size > MAX_AUTOMATION_FILE_CHARS) {
        toast.error("This file is too large to be an automation.");
        return;
      }
      // Checked here first so a wrong file is turned away straight off; the server checks again.
      const read = parseAutomationFile(await file.text());
      if (!read.ok) {
        toast.error(read.message);
        return;
      }
      const { automationId, notes } = await importFile({
        organizationId: team.id,
        file: JSON.parse(await file.text()),
      });
      toast.success(`Imported ${read.draft.name}. It is switched off until you turn it on.`, {
        description: notes.join(" ") || undefined,
        duration: notes.length > 0 ? 12_000 : undefined,
      });
      router.push(`/automations/${automationId}`);
    } catch (caught) {
      toast.error(errorMessage(caught, "The file could not be imported. Try again."));
    } finally {
      setPending(false);
      if (picker.current) picker.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={picker}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        tabIndex={-1}
        aria-label="Automation file to import"
        onChange={(event) => void onImport(event.target.files?.[0])}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Chains of steps that run on your toolkit by themselves: when a file arrives, on a
            schedule, or when another tool calls them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => picker.current?.click()}
          >
            <FileUp />
            Import
          </Button>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus />
            New automation
          </Button>
        </div>
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
                <span className="min-w-0 truncate text-sm">
                  {approval.automationName}
                  {approval.waitingSince && (
                    <span className="text-muted-foreground">
                      {" "}
                      since {when.format(approval.waitingSince)}
                    </span>
                  )}
                  {approval.forYou && approval.asked.length > 0 && (
                    <span className="ml-2 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                      Asks you
                    </span>
                  )}
                  {approval.decideBy !== null && (
                    <span className="text-muted-foreground block text-xs">
                      {approval.whenTimeUp === "approve" ? "Approves" : "Rejects"} by itself at{" "}
                      {when.format(approval.decideBy)}
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
                          onSelect={() => {
                            const { file, notes } = exportAutomation({
                              name: automation.name,
                              trigger: automation.trigger,
                              nodes: automation.nodes as AutomationNode[],
                              edges: automation.edges,
                            });
                            downloadJson(automationFileName(automation.name), file);
                            toast.success("Saved as a file", { description: notes[0] });
                          }}
                        >
                          Export as a file
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
