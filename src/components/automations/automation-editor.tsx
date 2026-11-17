"use client";

import "@xyflow/react/style.css";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  actionTypesByGroup,
  applyOperations,
  type AutomationDraft,
  type AutomationEdge,
  type AutomationNode,
  type Brand,
  graphProblem,
  newNodeId,
  type Operation,
  OperationError,
  stepsBefore,
  triggerTypeOf,
  valueSources,
} from "@ncat-dash/automation-core";
import {
  Background,
  type Connection,
  ControlButton,
  Controls,
  MiniMap,
  type OnConnectEnd,
  type Edge,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, LayoutGrid, Play, Plus, Save, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { nodeTitle, type Trigger } from "@/lib/automations";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import {
  AddAfterContext,
  BrandContext,
  edgeTypes,
  FIT_VIEW,
  flowEdge,
  type FlowNode,
  InsertOnEdgeContext,
  lastNodeIds,
  nodeTypes,
  type StepFlowNode,
  GROUP_ICONS,
  TRIGGER_ID,
  triggerEdges,
  triggerPosition,
} from "./flow-nodes";
import { NodePanel } from "./node-panel";
import { STEP_ICONS } from "./step-icons";
import { RunDialog } from "./run-dialog";
import { RunsList } from "./runs-list";
import { TriggerPanel } from "./trigger-panel";

const EMPTY_BRAND: Brand = {};
const EMPTY_MUSIC: { name: string; file: string }[] = [];
const FIT = { ...FIT_VIEW, duration: 200 };

type Loaded = NonNullable<ReturnType<typeof useQuery<typeof api.automations.get>>>;

/** JSON with keys in a fixed order, so two copies of the same automation compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}

function toFlowNode(node: AutomationNode): StepFlowNode {
  const { position, ...content } = node;
  return { id: node.id, type: "step", position, data: { node: content } };
}

export function AutomationEditor({ automationId }: { automationId: Id<"automations"> }) {
  const automation = useQuery(api.automations.get, { automationId });
  if (automation === undefined) return <Skeleton className="h-[70vh] rounded-xl" />;
  if (automation === null) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
        <p className="text-muted-foreground text-sm">This automation no longer exists.</p>
        <Button asChild size="sm" variant="outline">
          <Link href="/automations">Back to automations</Link>
        </Button>
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <Editor key={automation._id} automation={automation} />
    </ReactFlowProvider>
  );
}

function Editor({ automation }: { automation: Loaded }) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const team = useActiveTeam();
  const settings = useQuery(api.teamSettings.get, { organizationId: team.id });
  const brand = settings?.brand ?? EMPTY_BRAND;
  const music = settings?.music ?? EMPTY_MUSIC;
  const save = useMutation(api.automations.save);
  const setEnabled = useMutation(api.automations.setEnabled);
  const runNow = useMutation(api.automations.runNow);

  const [name, setName] = useState(automation.name);
  const [trigger, setTrigger] = useState<Trigger>(automation.trigger);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([
    {
      id: TRIGGER_ID,
      type: "trigger",
      position: triggerPosition(automation.nodes),
      data: { trigger: automation.trigger },
      deletable: false,
    },
    ...(automation.nodes as AutomationNode[]).map(toFlowNode),
  ]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    automation.edges.map((edge) => ({ ...edge })),
  );
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [runOpen, setRunOpen] = useState(false);

  const stepNodes = nodes.filter((node): node is StepFlowNode => node.type === "step");
  const selected = nodes.find((node) => node.selected);

  // What would be saved, in the shape the server stores.
  const draft = useMemo(() => {
    const savedNodes: AutomationNode[] = nodes
      .filter((node): node is StepFlowNode => node.type === "step")
      .map((node) => ({
        ...node.data.node,
        position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
      }));
    const savedEdges: AutomationEdge[] = edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    }));
    return { name, trigger, nodes: savedNodes, edges: savedEdges };
  }, [name, trigger, nodes, edges]);
  // The automation as the server has it. It changes under an open editor when the agent
  // or a teammate edits it.
  const incoming = canonical({
    name: automation.name,
    trigger: automation.trigger,
    nodes: automation.nodes,
    edges: automation.edges,
  });
  const [savedJson, setSavedJson] = useState(incoming);
  const dirty = canonical(draft) !== savedJson;
  const [seen, setSeen] = useState(incoming);
  if (incoming !== seen) {
    setSeen(incoming);
    // Show the change straight away, unless the person has unsaved work of their own.
    if (!dirty && incoming !== savedJson) {
      const chosen = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
      setName(automation.name);
      setTrigger(automation.trigger);
      setNodes([
        {
          id: TRIGGER_ID,
          type: "trigger",
          position: triggerPosition(automation.nodes),
          data: { trigger: automation.trigger },
          deletable: false,
          selected: chosen.has(TRIGGER_ID),
        },
        ...(automation.nodes as AutomationNode[]).map((node) => ({
          ...toFlowNode(node),
          selected: chosen.has(node.id),
        })),
      ]);
      setEdges(automation.edges.map((edge) => ({ ...edge })));
      setSavedJson(incoming);
    }
  }

  const [tab, setTab] = useState("editor");
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Keep the whole automation in view when it opens and whenever a step is added or removed.
  const { fitView } = useReactFlow();
  const nodeCount = nodes.length;
  const panelShown = nodes.some((node) => node.selected);
  useEffect(() => {
    if (tab !== "editor") return;
    // Twice: once straight away, once after the settings panel has taken its space.
    const timers = [60, 350].map((delay) => setTimeout(() => void fitView(FIT), delay));
    return () => timers.forEach(clearTimeout);
  }, [fitView, nodeCount, tab, panelShown]);

  // Each step nothing follows offers a "+" to carry on from it.
  const shownNodes = useMemo(() => {
    const last = lastNodeIds(
      stepNodes.map((node) => node.id),
      edges,
    );
    return nodes.map((node) =>
      node.type === "step" ? { ...node, data: { ...node.data, last: last.has(node.id) } } : node,
    );
  }, [nodes, stepNodes, edges]);

  // The line a new step is being put on, when it was started from a plus on a line.
  const [insertOn, setInsertOn] = useState<{ source: string; target: string } | null>(null);

  function openPalette() {
    setInsertOn(null);
    setPaletteOpen(true);
  }

  function addAfter(nodeId: string) {
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === nodeId })));
    openPalette();
  }

  function insertOnEdge(source: string, target: string) {
    setInsertOn({ source, target });
    setPaletteOpen(true);
  }

  // Letting go of a connection over empty canvas offers a step to put there.
  const onConnectEnd: OnConnectEnd = (_event, connection) => {
    if (connection.isValid || connection.fromHandle?.type !== "source") return;
    const from = connection.fromNode?.id;
    if (from && from !== TRIGGER_ID) addAfter(from);
  };

  /**
   * Makes changes through the same operations the agent uses (automation-core/operations),
   * then shows the result. Returns the new draft, or null when a change could not be made.
   */
  function change(ops: Operation[], options: { select?: string; moveTrigger?: boolean } = {}) {
    let next: AutomationDraft;
    try {
      next = applyOperations(draft, ops);
    } catch (caught) {
      toast.error(caught instanceof OperationError ? caught.message : "That could not be done.");
      return null;
    }
    setNodes((current) => {
      const known = new Map(current.map((node) => [node.id, node]));
      const steps = next.nodes.map((node): FlowNode => {
        const flow = toFlowNode(node);
        const shown = known.get(node.id);
        return {
          ...(shown?.type === "step" ? shown : {}),
          ...flow,
          selected: options.select ? node.id === options.select : (shown?.selected ?? false),
        };
      });
      const start = current
        .filter((node) => node.type === "trigger")
        .map((node) => ({
          ...node,
          selected: options.select ? false : node.selected,
          position: options.moveTrigger ? triggerPosition(next.nodes) : node.position,
        }));
      return [...start, ...steps];
    });
    setEdges(next.edges.map((edge) => ({ ...edge })));
    return next;
  }

  /** Removes steps and joins what fed each one to what it fed, so the flow stays in one piece. */
  function removeSteps(ids: string[]) {
    change([{ op: "remove", ids }]);
  }

  function tidy() {
    change([{ op: "tidy" }], { moveTrigger: true });
    setTimeout(() => void fitView(FIT), 60);
  }

  const shownEdges = useMemo(
    () => [
      ...triggerEdges(
        stepNodes.map((node) => node.id),
        edges,
      ),
      ...edges.map(flowEdge),
    ],
    [stepNodes, edges],
  );

  function changeTrigger(next: Trigger) {
    setTrigger(next);
    setNodes((current) =>
      current.map((node) =>
        node.type === "trigger" ? { ...node, data: { trigger: next } } : node,
      ),
    );
  }

  function addNode(type: string) {
    const id = newNodeId(draft.nodes, type);
    setPaletteOpen(false);
    setSearch("");
    const onLine = insertOn && draft.nodes.some((node) => node.id === insertOn.target);
    const after = selected?.type === "step" ? selected.id : undefined;
    change(
      [
        insertOn && onLine
          ? {
              op: "add",
              type,
              id,
              before: insertOn.target,
              after: insertOn.source === TRIGGER_ID ? undefined : insertOn.source,
            }
          : { op: "add", type, id, after },
      ],
      { select: id },
    );
    setInsertOn(null);
  }

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source === TRIGGER_ID || connection.target === TRIGGER_ID) return;
      const next = [
        ...draft.edges,
        {
          id: `${connection.source}>${connection.target}`,
          source: connection.source,
          target: connection.target,
        },
      ];
      const problem = graphProblem(draft.nodes, next);
      if (problem) {
        toast.error(problem);
        return;
      }
      setEdges((current) => [...current, next[next.length - 1]]);
    },
    [draft, setEdges],
  );

  async function persist(): Promise<boolean> {
    if (!dirty) return true;
    try {
      const result = await save({ automationId: automation._id, ...draft });
      setSavedJson(canonical(draft));
      if (automation.enabled && !result.enabled) {
        toast.warning(`Saved and switched off. ${result.problem ?? ""}`);
      } else {
        toast.success("Saved");
      }
      return true;
    } catch (caught) {
      toast.error(errorMessage(caught, "The automation could not be saved. Try again."));
      return false;
    }
  }

  async function withBusy(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }

  const onSave = () => withBusy(async () => void (await persist()));

  const onToggle = (enabled: boolean) =>
    withBusy(async () => {
      if (!(await persist())) return;
      try {
        await setEnabled({ automationId: automation._id, enabled });
      } catch (caught) {
        toast.error(errorMessage(caught, "The automation could not be switched on."));
      }
    });

  async function onRun(fileUrl?: string) {
    if (!(await persist())) return;
    const runId = await runNow({ automationId: automation._id, fileUrl });
    router.push(`/automations/${automation._id}/runs/${runId}`);
  }

  const query = search.trim().toLowerCase();

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="-ml-2">
          <Link href="/automations">
            <ArrowLeft />
            <span className="sr-only">Back to automations</span>
          </Link>
        </Button>
        <Input
          aria-label="Automation name"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          className="h-9 max-w-xs text-base font-semibold"
        />
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="automation-on"
              checked={automation.enabled}
              disabled={busy}
              onCheckedChange={onToggle}
            />
            <Label htmlFor="automation-on">{automation.enabled ? "On" : "Off"}</Label>
          </div>
          <Button variant="outline" size="sm" disabled={busy || !dirty} onClick={onSave}>
            <Save />
            {dirty ? "Save" : "Saved"}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => setRunOpen(true)}>
            <Play />
            Run now
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex-1">
        <TabsList>
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>

        <TabsContent value="editor">
          <div
            className={cn(
              "relative grid overflow-hidden rounded-xl border lg:h-[calc(100vh-13.5rem)] lg:min-h-[32rem] lg:grid-rows-[minmax(0,1fr)]",
              selected && "lg:grid-cols-[minmax(0,1fr)_20rem]",
            )}
          >
            {paletteOpen && (
              <aside
                className="bg-card absolute inset-y-0 left-0 z-10 flex w-72 min-h-0 flex-col border-r shadow-lg"
                aria-label="Steps you can add"
              >
                <div className="relative flex items-center gap-1 border-b p-2">
                  <Search
                    className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <Input
                    autoFocus
                    aria-label="Search steps"
                    placeholder="Search steps"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="pl-8"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => setPaletteOpen(false)}
                  >
                    <X />
                    <span className="sr-only">Close the list of steps</span>
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {actionTypesByGroup().map(({ group, label, types }) => {
                    const matches = types.filter(
                      (nodeType) =>
                        !query ||
                        nodeType.title.toLowerCase().includes(query) ||
                        nodeType.description.toLowerCase().includes(query),
                    );
                    if (matches.length === 0) return null;
                    const GroupIcon = GROUP_ICONS[group];
                    return (
                      <div key={group} className="mb-3">
                        <h3 className="text-muted-foreground px-2 py-1 text-xs font-medium">
                          {label}
                        </h3>
                        {matches.map((nodeType) => {
                          const Icon = STEP_ICONS[nodeType.type.replace(/^step:/, "")] ?? GroupIcon;
                          return (
                            <button
                              key={nodeType.type}
                              type="button"
                              title={nodeType.description}
                              onClick={() => addNode(nodeType.type)}
                              className="hover:bg-muted focus-visible:ring-ring/50 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-3"
                            >
                              <Icon
                                className="text-muted-foreground size-4 shrink-0"
                                aria-hidden="true"
                              />
                              <span className="truncate">{nodeType.title}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </aside>
            )}

            <div className="bg-muted/30 relative h-96 min-h-0 lg:h-auto" data-testid="canvas">
              {!paletteOpen && (
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-card absolute top-3 left-3 z-10 shadow-xs"
                  onClick={openPalette}
                >
                  <Plus />
                  Add step
                </Button>
              )}
              <BrandContext value={brand}>
                <AddAfterContext value={addAfter}>
                  <InsertOnEdgeContext value={insertOnEdge}>
                    <ReactFlow
                      nodes={shownNodes}
                      edges={shownEdges}
                      nodeTypes={nodeTypes}
                      edgeTypes={edgeTypes}
                      minZoom={0.25}
                      onNodesChange={onNodesChange}
                      onEdgesChange={onEdgesChange}
                      onConnect={onConnect}
                      onConnectEnd={onConnectEnd}
                      onBeforeDelete={async ({ nodes: doomed, edges: cut }) => {
                        // Deleting steps with the keyboard goes the same way as Remove step.
                        if (doomed.length === 0) return { nodes: doomed, edges: cut };
                        removeSteps(doomed.map((node) => node.id));
                        return false;
                      }}
                      forceColorMode={resolvedTheme === "dark" ? "dark" : "light"}
                      fitView
                      fitViewOptions={FIT_VIEW}
                    >
                      <Background gap={20} />
                      <Controls showInteractive={false} fitViewOptions={FIT_VIEW}>
                        <ControlButton onClick={tidy} title="Tidy up" aria-label="Tidy up">
                          <LayoutGrid />
                        </ControlButton>
                      </Controls>
                      {stepNodes.length > 5 && (
                        <MiniMap
                          pannable
                          zoomable
                          position="top-right"
                          className="!bg-card overflow-hidden rounded-lg border shadow-sm"
                          style={{ width: 168, height: 96 }}
                          nodeColor="var(--muted-foreground)"
                          nodeBorderRadius={12}
                          maskColor="color-mix(in oklab, var(--muted) 70%, transparent)"
                        />
                      )}
                    </ReactFlow>
                  </InsertOnEdgeContext>
                </AddAfterContext>
              </BrandContext>
              {stepNodes.length === 0 && (
                <p className="text-muted-foreground pointer-events-none absolute inset-x-0 bottom-6 text-center text-sm">
                  Press Add step to put the first step after the trigger.
                </p>
              )}
            </div>

            {selected && (
              <aside className="min-h-0 overflow-y-auto border-t p-4 lg:border-t-0 lg:border-l">
                {selected.type === "step" ? (
                  <>
                    <NodePanel
                      brand={brand}
                      music={music}
                      key={selected.id}
                      node={selected.data.node}
                      before={stepsBefore(selected.id, draft.edges)
                        .flat()
                        .flatMap((id) => stepNodes.find((node) => node.id === id) ?? [])
                        .map((node) => node.data.node)}
                      startGivesFile={triggerTypeOf(trigger).gives === "file"}
                      filled={Object.fromEntries(
                        valueSources(
                          { ...selected.data.node, position: selected.position },
                          draft.nodes,
                          draft.edges,
                        ).map(({ field, value, from }) => [
                          field,
                          `Automatic. Uses the ${value} from ${nodeTitle(from)}. Fill it in to use your own instead.`,
                        ]),
                      )}
                      onChange={(patch) =>
                        setNodes((current) =>
                          current.map((node) =>
                            node.id === selected.id && node.type === "step"
                              ? {
                                  ...node,
                                  data: { ...node.data, node: { ...node.data.node, ...patch } },
                                }
                              : node,
                          ),
                        )
                      }
                      onRemove={() => removeSteps([selected.id])}
                    />
                  </>
                ) : (
                  <>
                    <h2 className="mb-4 text-sm font-semibold">Trigger</h2>
                    <TriggerPanel
                      trigger={trigger}
                      onChange={changeTrigger}
                      automationId={automation._id}
                      hookToken={automation.hookToken}
                    />
                  </>
                )}
              </aside>
            )}
          </div>
        </TabsContent>

        <TabsContent value="runs">
          <RunsList automationId={automation._id} />
        </TabsContent>
      </Tabs>

      <RunDialog
        open={runOpen}
        onOpenChange={setRunOpen}
        startsOnUpload={automation.enabled && !dirty && trigger.kind === "upload"}
        start={onRun}
        onUploadedOnly={() => {
          setRunOpen(false);
          setTab("runs");
          toast.success("Uploaded. The run starts in a moment.");
        }}
      />
    </>
  );
}
