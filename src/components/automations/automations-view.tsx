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
import type { FunctionReturnType } from "convex/server";
import { ChevronLeft, FileUp, FolderOpen, Hourglass, Plus, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
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
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FolderRow,
  ItemBadge,
  ItemList,
  ItemRow,
  MetaLine,
  Pager,
  usePages,
} from "@/components/ui/item-list";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { triggerSummary } from "@/lib/automations";
import { errorMessage } from "@/lib/catalog";
import { downloadJson } from "@/lib/download";
import { useActiveTeam } from "@/lib/team-context";
import { dayOf, exactly, timeAgo } from "@/lib/when";

import { FlowStrip } from "./flow-strip";
import { RunStatusBadge } from "./run-status";
import { TemplateGallery } from "./template-gallery";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

type Automation = FunctionReturnType<typeof api.automations.list>[number];
type Client = FunctionReturnType<typeof api.clients.list>[number];

export function AutomationsView() {
  const team = useActiveTeam();
  const router = useRouter();
  const automations = useQuery(api.automations.list, { organizationId: team.id });
  const approvals = useQuery(api.runs.waitingApprovals, { organizationId: team.id });
  const create = useMutation(api.automations.create);
  const setEnabled = useMutation(api.automations.setEnabled);
  const remove = useMutation(api.automations.remove);
  const importFile = useMutation(api.automations.importFile);
  const clients = useQuery(api.clients.list, { organizationId: team.id });
  const moveTo = useMutation(api.clients.setForAutomation);
  const picker = useRef<HTMLInputElement>(null);
  // A client's automations sit in its folder; ?folder= is the one open.
  const folderId = useSearchParams().get("folder");
  const folder = clients?.find((client) => client._id === folderId) ?? null;

  const { folders, here } = useMemo(() => {
    const all = automations ?? [];
    const known = new Set((clients ?? []).map((client) => client._id as string));
    const inFolder = (automation: Automation) =>
      automation.clientId !== null && known.has(automation.clientId);
    const folders = (clients ?? [])
      .map((client) => {
        const inside = all.filter((automation) => automation.clientId === client._id);
        return {
          _id: client._id,
          name: client.name,
          count: inside.length,
          createdAt: client.createdAt,
          updatedAt: Math.max(client.createdAt, ...inside.map((each) => each.updatedAt)),
        };
      })
      .filter((each) => each.count > 0);
    const here = folderId
      ? all.filter((automation) => automation.clientId === folderId)
      : all.filter((automation) => !inFolder(automation));
    return { folders, here };
  }, [automations, clients, folderId]);
  const { shown, pager } = usePages(here, "automations");

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
      router.push(`/automations/${id}`, { transitionTypes: ["nav-forward"] });
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
      router.push(`/automations/${automationId}`, { transitionTypes: ["nav-forward"] });
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
          <Button asChild size="sm">
            <Link href="/automations/new" transitionTypes={["nav-forward"]}>
              <Plus />
              New automation
            </Link>
          </Button>
        </div>
      </div>

      {approvals && approvals.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl bg-surface p-4">
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
                  <Link
                    href={`/automations/${approval.automationId}/runs/${approval.runId}`}
                    transitionTypes={["nav-forward"]}
                  >
                    Review
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {folder && (
        <nav aria-label="Folder" className="flex items-center gap-1.5 text-sm">
          <Link
            href="/automations"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            All automations
          </Link>
          <span aria-hidden="true" className="text-muted-foreground">
            /
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium">
            <FolderOpen className="text-muted-foreground size-4" aria-hidden="true" />
            {folder.name}
          </span>
        </nav>
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
          <TemplateGallery disabled={pending} onPick={onPick} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {folderId && !folder ? (
            <p className="text-muted-foreground bg-surface rounded-xl px-5 py-8 text-sm">
              This folder is no longer here.{" "}
              <Link href="/automations" className="text-foreground underline">
                See all automations
              </Link>
            </p>
          ) : folder && here.length === 0 ? (
            <p className="text-muted-foreground bg-surface rounded-xl px-5 py-8 text-sm">
              Nothing is in this folder now. Move an automation here from its menu.
            </p>
          ) : (
            <ItemList label={folder ? `Automations for ${folder.name}` : "Automations"}>
              {!folder &&
                folders.map((each) => (
                  <FolderRow
                    key={each._id}
                    data-client={each._id}
                    name={each.name}
                    href={`/automations?folder=${each._id}`}
                    openLabel={`${each.name} folder`}
                    meta={
                      <MetaLine>
                        {each.count === 1 ? "1 automation" : `${each.count} automations`}
                        <span title={exactly(each.updatedAt)}>
                          Last updated {timeAgo(each.updatedAt)}
                        </span>
                        <span title={exactly(each.createdAt)}>Created {dayOf(each.createdAt)}</span>
                      </MetaLine>
                    }
                    menuLabel={`More for the ${each.name} folder`}
                    menu={
                      <>
                        <DropdownMenuItem asChild>
                          <Link href={`/automations?folder=${each._id}`}>Open</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/clients/${each._id}`}>Client page</Link>
                        </DropdownMenuItem>
                      </>
                    }
                  />
                ))}
              {shown.map((automation) => (
                <AutomationRow
                  key={automation._id}
                  automation={automation}
                  clients={clients ?? []}
                  onSwitch={async (enabled) => {
                    try {
                      await setEnabled({ automationId: automation._id, enabled });
                    } catch (caught) {
                      toast.error(errorMessage(caught, "It could not be switched on."));
                    }
                  }}
                  onMove={async (clientId) => {
                    try {
                      await moveTo({ automationId: automation._id, clientId });
                      const where = clients?.find((client) => client._id === clientId)?.name;
                      toast.success(where ? `Moved to ${where}` : "Moved out of the folder");
                    } catch (caught) {
                      toast.error(errorMessage(caught, "It could not be moved."));
                    }
                  }}
                  onRemove={() => setRemoving({ id: automation._id, name: automation.name })}
                />
              ))}
            </ItemList>
          )}
          <Pager {...pager} noun="automations" />
        </div>
      )}

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

function AutomationRow({
  automation,
  clients,
  onSwitch,
  onMove,
  onRemove,
}: {
  automation: Automation;
  clients: Client[];
  onSwitch: (enabled: boolean) => void;
  onMove: (clientId: Id<"clients"> | null) => void;
  onRemove: () => void;
}) {
  const others = automation.moreTriggers.length;
  return (
    <ItemRow
      data-automation={automation._id}
      name={automation.name}
      href={`/automations/${automation._id}`}
      meta={
        <MetaLine>
          <span title={exactly(automation.updatedAt)}>
            Last updated {timeAgo(automation.updatedAt)}
          </span>
          <span title={exactly(automation.createdAt)}>Created {dayOf(automation.createdAt)}</span>
          <span>
            {triggerSummary(automation.trigger)}
            {others > 0 && `, or ${others === 1 ? "one other way" : `${others} other ways`}`}
          </span>
          <FlowStrip
            size="sm"
            maxColumns={5}
            trigger={automation.trigger}
            nodes={automation.nodes as AutomationNode[]}
            edges={automation.edges}
          />
        </MetaLine>
      }
      badges={
        <>
          {automation.hasDraft && (
            <ItemBadge dot="amber" title="Has changes that are not published yet">
              Draft
            </ItemBadge>
          )}
          {automation.lastRun && (
            <Link
              href={`/automations/${automation._id}/runs/${automation.lastRun._id}`}
              title={`Last run ${when.format(automation.lastRun.startedAt)}`}
              className="rounded-4xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <RunStatusBadge status={automation.lastRun.status} />
              <span className="sr-only">, last run {timeAgo(automation.lastRun.startedAt)}</span>
            </Link>
          )}
          <span className="bg-background inline-flex h-7 items-center gap-2 rounded-lg px-2.5 text-xs font-medium shadow-xs">
            <Switch
              size="sm"
              aria-label={`${automation.name} is ${automation.enabled ? "on" : "off"}`}
              checked={automation.enabled}
              onCheckedChange={onSwitch}
            />
            <span aria-hidden="true">{automation.enabled ? "On" : "Off"}</span>
          </span>
        </>
      }
      menuLabel={`More for ${automation.name}`}
      menu={
        <>
          <DropdownMenuItem asChild>
            <Link href={`/automations/${automation._id}`}>Open</Link>
          </DropdownMenuItem>
          {clients.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to folder</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={automation.clientId ?? ""}
                  onValueChange={(value) => onMove(value ? (value as Id<"clients">) : null)}
                >
                  <DropdownMenuRadioItem value="">No folder</DropdownMenuRadioItem>
                  {clients.map((client) => (
                    <DropdownMenuRadioItem key={client._id} value={client._id}>
                      {client.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
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
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onRemove}>
            Delete
          </DropdownMenuItem>
        </>
      }
    />
  );
}
