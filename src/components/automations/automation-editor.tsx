"use client";

import "@xyflow/react/style.css";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  actionTypesByGroup,
  applyOperations,
  type AutomationDraft,
  type AutomationEdge,
  automationFileName,
  type AutomationNode,
  type Brand,
  canonical,
  canRedo,
  canFailOver,
  canUndo,
  copySteps,
  exportAutomation,
  FAILURE_WAY,
  newNodeId,
  type Operation,
  OperationError,
  record,
  redo,
  startHistory,
  stepsBefore,
  triggerTypeOf,
  undo,
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
  type NodeChange,
  NodeChangeset,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Download,
  LayoutGrid,
  Play,
  Plus,
  Redo2,
  Save,
  Search,
  StickyNote,
  Undo2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { nodeTitle, type Trigger } from "@/lib/automations";
import { errorMessage } from "@/lib/catalog";
import { downloadJson } from "@/lib/download";
import { copiedSteps, holdSteps } from "@/lib/step-clipboard";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import {
  AddAfterContext,
  BrandContext,
  canvasEdge,
  edgeTypes,
  FIT_VIEW,
  flowEdge,
  type FlowNode,
  InsertOnEdgeContext,
  lastNodeIds,
  nodeTypes,
  openWaysOf,
  savedEdge,
  type StepFlowNode,
  GROUP_ICONS,
  TRIGGER_ID,
  triggerEdges,
  triggerPosition,
} from "./flow-nodes";
import { isNoteId, notePlace, useCanvasNotes } from "./canvas-notes";
import { DraftBar } from "./draft-bar";
import { LiveRunBadge, useLiveRun } from "./live-run";
import { NodePanel } from "./node-panel";
import { type NoteFlowNode, noteNodeTypes } from "./note-node";
import { StepTest } from "./step-test";
import { STEP_ICONS } from "./step-icons";
import { RunDialog } from "./run-dialog";
import { RunsList } from "./runs-list";
import { VersionsPanel } from "./versions-panel";
import { TriggerPanel } from "./trigger-panel";

const EMPTY_BRAND: Brand = {};
const EMPTY_MUSIC: { name: string; file: string }[] = [];
const FIT = { ...FIT_VIEW, duration: 200 };

/** Steps and the team's notes, side by side on one canvas. */
const canvasNodeTypes = { ...nodeTypes, ...noteNodeTypes };

type Loaded = NonNullable<ReturnType<typeof useQuery<typeof api.automations.get>>>;

/** True when the keyboard is in something that has its own undo, such as a text box. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
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
  const publish = useMutation(api.automations.publish);
  const discardDraft = useMutation(api.automations.discardDraft);

  const [name, setName] = useState(automation.name);
  const [trigger, setTrigger] = useState<Trigger>(automation.trigger);
  const notes = useCanvasNotes(automation._id);
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
    (automation.edges as AutomationEdge[]).map(canvasEdge),
  );
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [runOpen, setRunOpen] = useState(false);

  const stepNodes = nodes.filter((node): node is StepFlowNode => node.type === "step");
  // How many steps are chosen: with more than one, a new step joins them.
  const joining = stepNodes.filter((node) => node.selected).length;
  const selected = nodes.find((node) => node.selected);

  // What would be saved, in the shape the server stores.
  const draft = useMemo(() => {
    const savedNodes: AutomationNode[] = nodes
      .filter((node): node is StepFlowNode => node.type === "step")
      .map((node) => ({
        ...node.data.node,
        position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
      }));
    const savedEdges: AutomationEdge[] = edges.map(savedEdge);
    return { name, trigger, nodes: savedNodes, edges: savedEdges };
  }, [name, trigger, nodes, edges]);
  /** Puts a whole automation on the canvas, keeping what is selected and where the trigger sits. */
  const [revision, setRevision] = useState(0);
  function show(next: AutomationDraft) {
    const chosen = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
    setName(next.name);
    setTrigger(next.trigger);
    setNodes((current) => [
      ...current
        .filter((node) => node.type === "trigger")
        .map((node) => ({ ...node, data: { trigger: next.trigger } })),
      ...next.nodes.map((node) => ({ ...toFlowNode(node), selected: chosen.has(node.id) })),
    ]);
    setEdges(next.edges.map(canvasEdge));
    // The settings panel keeps what is being typed; a new revision makes it read again.
    setRevision((current) => current + 1);
  }

  // Every state the canvas has been in, for undo and redo.
  const [history, setHistory] = useState(() => startHistory(draft));
  useEffect(() => {
    const timer = setTimeout(() => setHistory((current) => record(current, draft, Date.now())));
    return () => clearTimeout(timer);
  }, [draft]);

  function step(move: typeof undo) {
    const next = move(history);
    if (next === history) return;
    setHistory(next);
    show(next.present);
  }
  const onUndo = () => step(undo);
  const onRedo = () => step(redo);

  // The automation as the server has it. It changes under an open editor when the agent
  // or a teammate edits it.
  const incomingDraft: AutomationDraft = {
    name: automation.name,
    trigger: automation.trigger,
    nodes: automation.nodes as AutomationNode[],
    edges: automation.edges,
  };
  const incoming = canonical(incomingDraft);
  const [savedJson, setSavedJson] = useState(incoming);
  const dirty = canonical(draft) !== savedJson;
  const [seen, setSeen] = useState(incoming);
  if (incoming !== seen) {
    setSeen(incoming);
    // Show the change straight away, unless the person has unsaved work of their own.
    if (!dirty && incoming !== savedJson) {
      show(incomingDraft);
      // Its own step in the history, so it can be undone by itself.
      setHistory((current) => record(current, incomingDraft, 0, { merge: false }));
      setSavedJson(incoming);
    }
  }

  // The version triggers run. It differs from the canvas while there is a draft.
  const live = (automation.live as AutomationDraft | null) ?? null;
  const hasDraft = live !== null;
  // Saving goes to a draft while the automation is on, or once it has one.
  const drafting = hasDraft || automation.enabled;
  const draftShown = hasDraft || (automation.enabled && dirty);

  const [tab, setTab] = useState("editor");
  const running = useLiveRun(automation._id);
  // The last test of each step since the editor opened, so its result stays in the panel.
  const [tests, setTests] = useState<Record<string, Id<"runs">>>({});
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Keep the whole automation in view when it opens and whenever a step is added or removed.
  const { fitView, screenToFlowPosition } = useReactFlow();
  const nodeCount = nodes.length + notes.noteNodes.length;
  const panelShown = nodes.some((node) => node.selected);
  useEffect(() => {
    if (tab !== "editor") return;
    // Twice: once straight away, once after the settings panel has taken its space.
    const timers = [60, 350].map((delay) => setTimeout(() => void fitView(FIT), delay));
    return () => timers.forEach(clearTimeout);
  }, [fitView, nodeCount, tab, panelShown]);

  // Each step nothing follows offers a "+" to carry on from it, and so does each way out
  // of an If that nothing hangs off yet.
  const shownNodes = useMemo(() => {
    const last = lastNodeIds(
      stepNodes.map((node) => node.id),
      edges,
    );
    const open = openWaysOf(draft.nodes, draft.edges);
    return nodes.map((node) => {
      if (node.type !== "step") return node;
      // While a run goes, each step it has reached shows how it is doing.
      const now = running.steps.get(node.id);
      return {
        ...node,
        data: {
          ...node.data,
          last: last.has(node.id),
          openWays: open.get(node.id),
          status: now?.status,
          jobCount: now?.jobCount,
          note: now?.note,
          failWay: draft.edges.some(
            (edge) => edge.source === node.id && edge.branch === FAILURE_WAY,
          )
            ? ("used" as const)
            : node.selected
              ? ("offered" as const)
              : undefined,
        },
      };
    });
  }, [nodes, stepNodes, edges, draft, running.steps]);

  // The line a new step is being put on, when it was started from a plus on a line.
  const [insertOn, setInsertOn] = useState<{ source: string; target: string } | null>(null);

  // The way out of an If a new step is being hung on, when it was started from that way's plus.
  const [onWay, setOnWay] = useState<string | undefined>(undefined);

  function openPalette() {
    setInsertOn(null);
    setOnWay(undefined);
    setPaletteOpen(true);
  }

  function addAfter(nodeId: string, way?: string) {
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === nodeId })));
    openPalette();
    setOnWay(way);
  }

  function insertOnEdge(source: string, target: string) {
    setInsertOn({ source, target });
    setPaletteOpen(true);
  }

  // Letting go of a connection over empty canvas offers a step to put there.
  const onConnectEnd: OnConnectEnd = (_event, connection) => {
    if (connection.isValid || connection.fromHandle?.type !== "source") return;
    const from = connection.fromNode?.id;
    if (from && from !== TRIGGER_ID) addAfter(from, connection.fromHandle?.id ?? undefined);
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
    // A change to the steps themselves (adding, pasting, removing) is undone on its own,
    // even straight after another; typing in a setting is undone a run of keys at a time.
    setHistory((current) => record(current, next, Date.now(), { merge: false }));
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
    setEdges(next.edges.map(canvasEdge));
    return next;
  }

  /** Removes steps and joins what fed each one to what it fed, so the flow stays in one piece. */
  function removeSteps(ids: string[]) {
    change([{ op: "remove", ids }]);
  }

  const chosenSteps = () =>
    nodes.filter((node) => node.selected && node.type === "step").map((node) => node.id);

  /** Makes a paste or duplicate, then selects what it made. */
  function addCopy(op: Operation, said: string) {
    const before = new Set(draft.nodes.map((node) => node.id));
    const next = change([op]);
    if (!next) return;
    const made = new Set(next.nodes.filter((node) => !before.has(node.id)).map((node) => node.id));
    setNodes((current) => current.map((node) => ({ ...node, selected: made.has(node.id) })));
    toast.success(said);
  }

  function copySelected() {
    const ids = chosenSteps();
    if (ids.length === 0) return;
    holdSteps(copySteps(draft, ids));
    toast.success(ids.length === 1 ? "Copied the step." : `Copied ${ids.length} steps.`);
  }

  function pasteHere() {
    const steps = copiedSteps();
    if (!steps || steps.nodes.length === 0) {
      toast.error("Copy a step first. Select it and press Ctrl+C.");
      return;
    }
    const ids = chosenSteps();
    // One step chosen: the copy carries on from it. Otherwise it starts from the start.
    const after = ids.length === 1 ? ids[0] : undefined;
    addCopy(
      { op: "paste", steps, after },
      after
        ? `Pasted after ${nodeTitle(draft.nodes.find((node) => node.id === after)!)}.`
        : "Pasted.",
    );
  }

  function duplicateSelected(ids = chosenSteps()) {
    if (ids.length === 0) return;
    addCopy(
      { op: "duplicate", ids },
      ids.length === 1 ? "Duplicated the step." : `Duplicated ${ids.length} steps.`,
    );
  }

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || isTyping(event.target)) return;
    // Leave copying text the person has highlighted on the page alone.
    if (window.getSelection()?.toString()) return;
    const key = event.key.toLowerCase();
    if (tab !== "editor" && key !== "z" && key !== "y") return;
    if (key === "c") copySelected();
    else if (key === "v") pasteHere();
    else if (key === "d") duplicateSelected();
    else if (key === "z" || key === "y") {
      if (key === "y" || event.shiftKey) onRedo();
      else onUndo();
    } else return;
    event.preventDefault();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

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
      ...edges.map((edge) => ({
        ...flowEdge(edge),
        // The line into the step a run is on moves.
        animated: running.steps.get(edge.target)?.status === "running",
      })),
    ],
    [stepNodes, edges, running.steps],
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
    // With several steps chosen, the new step joins them: it runs once all have finished.
    const chosen = chosenSteps();
    const join = !onWay && chosen.length > 1 ? chosen.filter((other) => other !== after) : [];
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
          : {
              op: "add",
              type,
              id,
              after,
              ...(after && onWay ? { branch: onWay } : {}),
              ...(join.length > 0 ? { join } : {}),
            },
      ],
      { select: id },
    );
    setInsertOn(null);
    setOnWay(undefined);
  }

  // Drawing a line goes the same way as the agent's "connect", so a line out of an If
  // carries the way it left by.
  function onConnect(connection: Connection) {
    if (connection.source === TRIGGER_ID || connection.target === TRIGGER_ID) return;
    change([
      {
        op: "connect",
        source: connection.source,
        target: connection.target,
        ...(connection.sourceHandle ? { branch: connection.sourceHandle } : {}),
      },
    ]);
  }

  /** Saves the automation on the canvas to the person's computer as a file. */
  function onExport() {
    const { file, notes } = exportAutomation(draft);
    downloadJson(automationFileName(draft.name), file);
    toast.success("Saved as a file", { description: notes[0] });
  }

  async function persist(quiet = false): Promise<boolean> {
    if (!dirty) return true;
    try {
      const result = await save({ automationId: automation._id, ...draft });
      setSavedJson(canonical(draft));
      if (quiet) return true;
      if (result.draft) {
        toast.success(
          automation.enabled
            ? "Draft saved. The live version keeps running until you publish."
            : "Draft saved.",
        );
      } else if (automation.enabled && !result.enabled) {
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

  const onPublish = () =>
    withBusy(async () => {
      if (!(await persist(true))) return;
      try {
        await publish({ automationId: automation._id });
        toast.success(automation.enabled ? "Published. This version is live now." : "Published.");
      } catch (caught) {
        toast.error(errorMessage(caught, "The draft could not be published."));
      }
    });

  const onDiscard = () =>
    withBusy(async () => {
      // Unsaved work goes too: back to what was last saved, then the saved draft is dropped
      // and the live version arrives from the server. Undo brings the changes back.
      if (dirty) show(JSON.parse(savedJson) as AutomationDraft);
      try {
        await discardDraft({ automationId: automation._id });
        toast.success("Draft discarded. The canvas shows the live version.");
      } catch (caught) {
        toast.error(errorMessage(caught, "The draft could not be discarded."));
      }
    });

  const onToggle = (enabled: boolean) =>
    withBusy(async () => {
      if (!(await persist(true))) return;
      try {
        await setEnabled({ automationId: automation._id, enabled });
      } catch (caught) {
        toast.error(errorMessage(caught, "The automation could not be switched on."));
      }
    });

  async function onRun(fileUrl?: string) {
    if (!(await persist(true))) return;
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
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              disabled={!canUndo(history)}
              title="Undo (Ctrl+Z)"
              onClick={onUndo}
            >
              <Undo2 />
              <span className="sr-only">Undo</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!canRedo(history)}
              title="Redo (Ctrl+Shift+Z)"
              onClick={onRedo}
            >
              <Redo2 />
              <span className="sr-only">Redo</span>
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="automation-on"
              checked={automation.enabled}
              disabled={busy}
              onCheckedChange={onToggle}
            />
            <Label htmlFor="automation-on">{automation.enabled ? "On" : "Off"}</Label>
          </div>
          <Button variant="ghost" size="sm" onClick={onExport}>
            <Download />
            Export
          </Button>
          <Button variant="outline" size="sm" disabled={busy || !dirty} onClick={onSave}>
            <Save />
            {dirty ? (drafting ? "Save draft" : "Save") : hasDraft ? "Draft saved" : "Saved"}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => setRunOpen(true)}>
            <Play />
            Run now
          </Button>
        </div>
      </div>

      {draftShown && (
        <DraftBar
          enabled={automation.enabled}
          live={live ?? (JSON.parse(savedJson) as AutomationDraft)}
          draft={draft}
          busy={busy}
          restoredFrom={automation.restoredFrom}
          onPublish={onPublish}
          onDiscard={onDiscard}
        />
      )}

      <Tabs value={tab} onValueChange={setTab} className="flex-1">
        <TabsList>
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>

        <TabsContent value="editor">
          <div
            className={cn(
              "relative grid overflow-hidden rounded-xl border lg:min-h-[32rem] lg:grid-rows-[minmax(0,1fr)]",
              // The draft bar takes a row of its own above the canvas.
              draftShown ? "lg:h-[calc(100vh-17.5rem)]" : "lg:h-[calc(100vh-13.5rem)]",
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
              <LiveRunBadge
                automationId={automation._id}
                latest={running.latest}
                active={running.active}
              />
              {!paletteOpen && (
                <div className="absolute top-3 left-3 z-10 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-card shadow-xs"
                    onClick={openPalette}
                  >
                    <Plus />
                    {joining > 1 ? `Add a step after these ${joining}` : "Add step"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-card shadow-xs"
                    onClick={(event) => {
                      const canvas = event.currentTarget
                        .closest("[data-testid=canvas]")
                        ?.getBoundingClientRect();
                      if (!canvas) return;
                      const middle = screenToFlowPosition({
                        x: canvas.left + canvas.width / 2,
                        y: canvas.top + canvas.height / 2,
                      });
                      void notes.addNote(notePlace(middle, [...notes.noteNodes, ...nodes]));
                    }}
                  >
                    <StickyNote />
                    Add note
                  </Button>
                </div>
              )}
              <BrandContext value={brand}>
                <AddAfterContext value={addAfter}>
                  <InsertOnEdgeContext value={insertOnEdge}>
                    <ReactFlow
                      nodes={[...notes.noteNodes, ...shownNodes]}
                      edges={shownEdges}
                      nodeTypes={canvasNodeTypes}
                      edgeTypes={edgeTypes}
                      minZoom={0.25}
                      onNodesChange={(changes) => {
                        // Notes are kept apart from the steps: they are saved as they change.
                        const all = changes.toArray();
                        const forNotes = all.filter((change) => isNoteId(change.id));
                        const forSteps = all.filter((change) => !isNoteId(change.id));
                        if (forNotes.length > 0) {
                          notes.onNoteChanges(forNotes as NodeChange<NoteFlowNode>[]);
                        }
                        if (forSteps.length > 0) {
                          onNodesChange(new NodeChangeset(forSteps as NodeChange<FlowNode>[]));
                        }
                      }}
                      onNodeDragStop={(_event, _node, moved) => {
                        for (const node of moved) {
                          if (isNoteId(node.id)) notes.onNoteDragStop(node.id, node.position);
                        }
                      }}
                      onEdgesChange={onEdgesChange}
                      onConnect={onConnect}
                      onConnectEnd={onConnectEnd}
                      onBeforeDelete={async ({ nodes: doomed, edges: cut }) => {
                        // Deleting steps with the keyboard goes the same way as Remove step.
                        if (doomed.length === 0) return { nodes: doomed, edges: cut };
                        const doomedNotes = doomed.filter((node) => isNoteId(node.id));
                        if (doomedNotes.length > 0) {
                          void notes.removeNotes(doomedNotes.map((node) => node.id));
                        }
                        const doomedSteps = doomed.filter((node) => !isNoteId(node.id));
                        if (doomedSteps.length > 0) removeSteps(doomedSteps.map((node) => node.id));
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
                      key={`${selected.id}:${revision}`}
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
                      onDuplicate={() => duplicateSelected([selected.id])}
                      waitsFor={draft.edges
                        .filter((edge) => edge.target === selected.id)
                        .flatMap((edge) => {
                          const source = draft.nodes.find((n) => n.id === edge.source);
                          return source ? [nodeTitle(source)] : [];
                        })}
                      {...(canFailOver(selected.data.node.kind)
                        ? {
                            failSteps: draft.edges
                              .filter(
                                (edge) =>
                                  edge.source === selected.id && edge.branch === FAILURE_WAY,
                              )
                              .flatMap((edge) => {
                                const target = draft.nodes.find((n) => n.id === edge.target);
                                return target ? [nodeTitle(target)] : [];
                              }),
                            onAddOnFailure: () => addAfter(selected.id, FAILURE_WAY),
                          }
                        : {})}
                    />
                    {(selected.data.node.kind === "step" ||
                      selected.data.node.kind === "clips") && (
                      <StepTest
                        key={selected.id}
                        automationId={automation._id}
                        node={selected.data.node}
                        runId={tests[selected.id]}
                        onStarted={(runId) =>
                          setTests((current) => ({ ...current, [selected.id]: runId }))
                        }
                      />
                    )}
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

        <TabsContent value="versions">
          <VersionsPanel
            automationId={automation._id}
            draftShown={draftShown}
            // Unsaved work goes, as when a draft is discarded. Undo brings it back.
            beforeRestore={() => {
              if (dirty) show(JSON.parse(savedJson) as AutomationDraft);
            }}
            onRestored={() => setTab("editor")}
          />
        </TabsContent>
      </Tabs>

      <RunDialog
        open={runOpen}
        onOpenChange={setRunOpen}
        startsOnUpload={automation.enabled && !dirty && !hasDraft && trigger.kind === "upload"}
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
