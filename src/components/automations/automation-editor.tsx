"use client";

import "@xyflow/react/style.css";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { type AutomationEdge, type AutomationNode, graphProblem } from "@ncat-dash/automation-core";
import { stepsByCategory } from "@ncat-dash/step-catalog";
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Play, Save, Search, UserCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { UploadPicker } from "@/components/steps/step-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { newNodeId, type Trigger } from "@/lib/automations";
import { CATEGORY_LABELS, CATEGORY_ORDER, errorMessage } from "@/lib/catalog";

import {
  CATEGORY_ICONS,
  type FlowNode,
  nodeTypes,
  type StepFlowNode,
  TRIGGER_ID,
  triggerEdges,
  triggerPosition,
} from "./flow-nodes";
import { NodePanel } from "./node-panel";
import { RunsList } from "./runs-list";
import { TriggerPanel } from "./trigger-panel";

type Loaded = NonNullable<ReturnType<typeof useQuery<typeof api.automations.get>>>;

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
  const [fileUrl, setFileUrl] = useState("");

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
  const [savedJson, setSavedJson] = useState(() =>
    JSON.stringify({
      name: automation.name,
      trigger: automation.trigger,
      nodes: automation.nodes,
      edges: automation.edges,
    }),
  );
  const dirty = JSON.stringify(draft) !== savedJson;

  const shownEdges = useMemo(
    () => [
      ...triggerEdges(
        stepNodes.map((node) => node.id),
        edges,
      ),
      ...edges,
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

  function addNode(kind: "step" | "approval", stepId?: string) {
    const id = newNodeId(stepNodes, stepId ?? "approval");
    const after = selected?.type === "step" ? selected : undefined;
    const lowest = stepNodes.reduce<StepFlowNode | undefined>(
      (low, node) => (!low || node.position.y > low.position.y ? node : low),
      undefined,
    );
    const anchor = after ?? lowest;
    const position = anchor
      ? { x: anchor.position.x, y: anchor.position.y + 130 }
      : { x: 0, y: 130 };
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      {
        id,
        type: "step" as const,
        position,
        selected: true,
        data: { node: { id, kind, stepId, input: {} } },
      },
    ]);
    if (after) {
      setEdges((current) => [
        ...current,
        { id: `${after.id}>${id}`, source: after.id, target: id },
      ]);
    }
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
      setSavedJson(JSON.stringify(draft));
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

  const onRun = () =>
    withBusy(async () => {
      if (!(await persist())) return;
      try {
        const runId = await runNow({
          automationId: automation._id,
          fileUrl: fileUrl.trim() || undefined,
        });
        router.push(`/automations/${automation._id}/runs/${runId}`);
      } catch (caught) {
        toast.error(errorMessage(caught, "The run could not be started."));
      }
    });

  const grouped = stepsByCategory();
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

      <Tabs defaultValue="build" className="flex-1">
        <TabsList>
          <TabsTrigger value="build">Build</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>

        <TabsContent value="build">
          <div className="grid h-[calc(100vh-13.5rem)] min-h-[32rem] overflow-hidden rounded-xl border lg:grid-cols-[15rem_minmax(0,1fr)_20rem]">
            <aside className="hidden flex-col border-r lg:flex" aria-label="Steps you can add">
              <div className="relative border-b p-2">
                <Search
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2"
                  aria-hidden="true"
                />
                <Input
                  aria-label="Search steps"
                  placeholder="Search steps"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="pl-8"
                />
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {CATEGORY_ORDER.map((category) => {
                  const Icon = CATEGORY_ICONS[category];
                  const matches = (grouped[category] ?? []).filter(
                    (step) =>
                      !query ||
                      step.title.toLowerCase().includes(query) ||
                      step.description.toLowerCase().includes(query),
                  );
                  if (matches.length === 0) return null;
                  return (
                    <div key={category} className="mb-3">
                      <h3 className="text-muted-foreground px-2 py-1 text-xs font-medium">
                        {CATEGORY_LABELS[category]}
                      </h3>
                      {matches.map((step) => (
                        <button
                          key={step.id}
                          type="button"
                          title={step.description}
                          onClick={() => addNode("step", step.id)}
                          className="hover:bg-muted focus-visible:ring-ring/50 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-3"
                        >
                          <Icon
                            className="text-muted-foreground size-4 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="truncate">{step.title}</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
                {(!query || "approval".includes(query)) && (
                  <div className="mb-3">
                    <h3 className="text-muted-foreground px-2 py-1 text-xs font-medium">People</h3>
                    <button
                      type="button"
                      title="Stops the run until someone on the team approves."
                      onClick={() => addNode("approval")}
                      className="hover:bg-muted focus-visible:ring-ring/50 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-3"
                    >
                      <UserCheck
                        className="text-muted-foreground size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="truncate">Approval</span>
                    </button>
                  </div>
                )}
              </div>
            </aside>

            <div className="bg-muted/30 relative min-h-64" data-testid="canvas">
              <ReactFlow
                nodes={nodes}
                edges={shownEdges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                forceColorMode={resolvedTheme === "dark" ? "dark" : "light"}
                fitView
                fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={20} />
                <Controls showInteractive={false} fitViewOptions={{ maxZoom: 1, padding: 0.3 }} />
              </ReactFlow>
              {stepNodes.length === 0 && (
                <p className="text-muted-foreground pointer-events-none absolute inset-x-0 bottom-6 text-center text-sm">
                  Pick a step on the left to add it.
                </p>
              )}
            </div>

            <aside className="overflow-y-auto border-t p-4 lg:border-t-0 lg:border-l">
              {selected?.type === "step" ? (
                <>
                  <h2 className="mb-4 text-sm font-semibold">Step settings</h2>
                  <NodePanel
                    key={selected.id}
                    node={selected.data.node}
                    others={stepNodes
                      .filter((node) => node.id !== selected.id && node.data.node.kind === "step")
                      .map((node) => node.data.node)}
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
                    onRemove={() => {
                      setNodes((current) => current.filter((node) => node.id !== selected.id));
                      setEdges((current) =>
                        current.filter(
                          (edge) => edge.source !== selected.id && edge.target !== selected.id,
                        ),
                      );
                    }}
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
                  <p className="text-muted-foreground mt-6 text-sm">
                    Select a step on the canvas to change its settings. Drag from the dot under one
                    step to the dot above another to connect them.
                  </p>
                </>
              )}
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="runs">
          <RunsList automationId={automation._id} />
        </TabsContent>
      </Tabs>

      <Dialog open={runOpen} onOpenChange={setRunOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run now</DialogTitle>
            <DialogDescription>
              Starts one run straight away{dirty ? ", after saving your changes" : ""}.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="run-file">
                File to work on
                <span className="text-muted-foreground font-normal">optional</span>
              </FieldLabel>
              <UploadPicker onPick={setFileUrl} />
            </div>
            <Input
              id="run-file"
              type="url"
              inputMode="url"
              placeholder="https://"
              value={fileUrl}
              onChange={(event) => setFileUrl(event.target.value)}
              autoComplete="off"
            />
            <FieldDescription>
              Handed to the first step, the way a trigger would hand over a new file.
            </FieldDescription>
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={onRun}>
              <Play />
              {busy ? "Starting" : "Start run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
