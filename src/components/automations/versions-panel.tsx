"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  type AutomationDraft,
  type AutomationEdge,
  type AutomationNode,
  automationFileName,
  exportAutomation,
} from "@ncat-dash/automation-core";
import { Background, Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { useMutation, useQuery } from "convex/react";
import { Download, History, RotateCcw } from "lucide-react";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Trigger } from "@/lib/automations";
import { errorMessage } from "@/lib/catalog";
import { downloadJson } from "@/lib/download";
import { cn } from "@/lib/utils";

import {
  canvasEdge,
  edgeTypes,
  FIT_VIEW,
  type FlowNode,
  flowEdge,
  nodeTypes,
  TRIGGER_ID,
  triggerEdges,
  triggerPosition,
} from "./flow-nodes";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

type Listed = NonNullable<ReturnType<typeof useVersions>>["versions"][number];

function useVersions(automationId: Id<"automations">) {
  return useQuery(api.versions.list, { automationId });
}

/** How a version became the live one, in a few words. */
function howItCame(version: Listed): string {
  if (version.restoredFrom !== null) return `Brought back from version ${version.restoredFrom}`;
  switch (version.source) {
    case "created":
      return "Made";
    case "imported":
      return "Imported from a file";
    case "published":
      return "Published";
    default:
      return "Saved";
  }
}

/** A version's steps on a still canvas: nothing can be moved, joined or changed. */
function VersionCanvas({ version }: { version: AutomationDraft }) {
  const { resolvedTheme } = useTheme();
  const flow = useMemo(() => {
    const nodes: FlowNode[] = [
      {
        id: TRIGGER_ID,
        type: "trigger",
        position: triggerPosition(version.nodes),
        data: { trigger: version.trigger as Trigger },
      },
      ...version.nodes.map(({ position, ...node }) => ({
        id: node.id,
        type: "step" as const,
        position,
        data: { node },
      })),
    ];
    const edges = [
      ...triggerEdges(
        version.nodes.map((node) => node.id),
        version.edges,
      ),
      ...version.edges.map((edge) => flowEdge(canvasEdge(edge))),
    ];
    return { nodes, edges };
  }, [version]);
  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        minZoom={0.25}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        forceColorMode={resolvedTheme === "dark" ? "dark" : "light"}
        fitView
        fitViewOptions={FIT_VIEW}
      >
        <Background gap={20} />
        <Controls showInteractive={false} fitViewOptions={FIT_VIEW} />
      </ReactFlow>
    </ReactFlowProvider>
  );
}

/**
 * Every version the automation has had as its live version, newest first. Choosing one
 * shows its steps; bringing it back makes it the draft, so nothing that runs changes until
 * someone publishes it.
 */
export function VersionsPanel({
  automationId,
  draftShown = false,
  beforeRestore,
  onRestored,
}: {
  automationId: Id<"automations">;
  /** The draft bar sits above, so the panel is that much shorter. */
  draftShown?: boolean;
  /** Called first, so the editor can set aside work that is not saved yet. */
  beforeRestore?: () => void;
  /** Called once a version is back, with whether it became the draft. */
  onRestored?: (draft: boolean) => void;
}) {
  const listed = useVersions(automationId);
  const [chosenId, setChosenId] = useState<Id<"automationVersions"> | null>(null);
  const chosen =
    listed?.versions.find((version) => version._id === chosenId) ?? listed?.versions[0];
  const full = useQuery(api.versions.get, chosen ? { versionId: chosen._id } : "skip");
  const restore = useMutation(api.versions.restore);
  const [busy, setBusy] = useState(false);

  if (listed === undefined) return <Skeleton className="h-80 rounded-xl" />;
  if (listed === null) {
    return <p className="text-muted-foreground text-sm">This automation no longer exists.</p>;
  }
  if (!chosen) {
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-sm">
        No versions are kept yet. Each time this automation is saved while it is off, or a draft is
        published, the version that runs is kept here.
      </p>
    );
  }

  const content = full && full._id === chosen._id ? (full as unknown as AutomationDraft) : null;
  // The live version can only be "brought back" to throw a draft away.
  const canRestore = !chosen.live || listed.hasDraft;

  async function onRestore() {
    if (!chosen) return;
    setBusy(true);
    try {
      beforeRestore?.();
      const { draft } = await restore({ versionId: chosen._id });
      toast.success(
        draft
          ? `Version ${chosen.number} is the draft now. Publish it to make it the one that runs.`
          : "Draft discarded. The canvas shows the live version.",
      );
      onRestored?.(draft);
    } catch (caught) {
      toast.error(errorMessage(caught, "This version could not be brought back."));
    } finally {
      setBusy(false);
    }
  }

  function onExport() {
    if (!content) return;
    const { file, notes } = exportAutomation(content);
    downloadJson(automationFileName(content.name), file);
    toast.success(`Version ${chosen!.number} saved as a file`, { description: notes[0] });
  }

  return (
    <div
      className={cn(
        "grid overflow-hidden rounded-xl border lg:min-h-[32rem] lg:grid-cols-[20rem_minmax(0,1fr)]",
        draftShown ? "lg:h-[calc(100vh-17.5rem)]" : "lg:h-[calc(100vh-13.5rem)]",
      )}
    >
      <ol
        aria-label="Versions"
        className="flex max-h-80 flex-col overflow-y-auto border-b lg:max-h-none lg:border-r lg:border-b-0"
      >
        {listed.versions.map((version) => {
          const selected = version._id === chosen._id;
          return (
            <li key={version._id}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => setChosenId(version._id)}
                className={cn(
                  "hover:bg-muted/60 flex w-full flex-col gap-1 border-b px-4 py-3 text-left outline-none focus-visible:bg-muted",
                  selected && "bg-muted",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium">Version {version.number}</span>
                  {version.live && <Badge variant="secondary">Live</Badge>}
                </span>
                <span className="text-muted-foreground text-xs">
                  {howItCame(version)} by {version.byName}, {when.format(version.at)}
                </span>
                {version.changes.length > 0 && (
                  <span className="text-muted-foreground line-clamp-2 text-xs">
                    {version.changes.join(". ")}.
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <section aria-label={`Version ${chosen.number}`} className="flex min-h-80 flex-col">
        <div className="flex flex-wrap items-start gap-3 border-b px-4 py-3">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <History className="text-muted-foreground size-4" aria-hidden="true" />
              Version {chosen.number}
              {content && <span className="text-muted-foreground font-normal">{content.name}</span>}
            </h2>
            <p className="text-muted-foreground text-xs">
              {chosen.live
                ? listed.hasDraft
                  ? "This is the version that runs. Your draft has changes it does not."
                  : "This is the version that runs."
                : "Bringing it back makes it the draft. What runs stays the same until you publish."}
            </p>
          </div>
          <Button variant="ghost" size="sm" disabled={!content} onClick={onExport}>
            <Download />
            Export
          </Button>
          {canRestore && (
            <Button size="sm" disabled={busy} onClick={onRestore}>
              <RotateCcw />
              {chosen.live ? "Discard draft" : "Bring back as draft"}
            </Button>
          )}
        </div>
        {chosen.changes.length > 0 && (
          <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 border-b px-4 py-2 text-xs">
            {chosen.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        )}
        <div className="bg-muted/30 relative min-h-72 flex-1">
          {content ? (
            <VersionCanvas
              version={{
                ...content,
                nodes: content.nodes as AutomationNode[],
                edges: content.edges as AutomationEdge[],
              }}
            />
          ) : (
            <Skeleton className="absolute inset-4 rounded-lg" />
          )}
        </div>
      </section>
    </div>
  );
}
