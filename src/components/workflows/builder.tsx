"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
} from "@xyflow/react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  History,
  LayoutGrid,
  Loader2,
  MousePointerClick,
  PauseCircle,
  RotateCcw,
  Rocket,
  Save,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pill } from "@/components/app/badges";
import { NODE_TYPES, type NodeConfig, type NodeType, type WorkflowGraph } from "@/server/workflows/graph";
import { BRANCH_HANDLES, graphSignature, validateGraph, type ValidationIssue } from "@/server/workflows/validate";
import { simulate, type SimChoices } from "@/server/workflows/simulate";
import { layoutGraph } from "@/server/workflows/layout";
import { defaultNodeConfig, EDGE_LABELS } from "@/server/workflows/defaults";
import { discardWorkflowDraftAction, draftWorkflowWithAiAction, publishWorkflowAction, saveWorkflowDraftAction } from "@/server/admin/workflow-actions";
import { CanvasContext, NODE_META, NodeCard, labelOf, type WfNode } from "./node-card";
import { NodeInspector } from "./inspector";
import type { BuilderOptions, BuilderVersion, BuilderWorkflow } from "./types";

const nodeTypes = Object.fromEntries(NODE_TYPES.map((t) => [t, NodeCard]));
const PALETTE = NODE_TYPES.filter((t) => t !== "start");

type EdgeData = { label?: { en: string; ar: string } };
type WfEdge = Edge<EdgeData>;

function toFlow(g: WorkflowGraph): { nodes: WfNode[]; edges: WfEdge[] } {
  return {
    nodes: g.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data, deletable: n.type !== "start" })),
    edges: g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, data: { label: e.label } })),
  };
}

function fromFlow(nodes: WfNode[], edges: WfEdge[]): WorkflowGraph {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.type as NodeType, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, ...(e.data?.label ? { label: e.data.label } : {}) })),
  };
}

const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function WorkflowBuilder(props: {
  workflow: BuilderWorkflow;
  versions: BuilderVersion[];
  initialGraph: WorkflowGraph;
  publishedGraph: WorkflowGraph | null;
  options: BuilderOptions;
  aiEnabled: boolean;
}) {
  return (
    <ReactFlowProvider>
      <Builder {...props} />
    </ReactFlowProvider>
  );
}

function Builder({
  workflow,
  versions,
  initialGraph,
  publishedGraph,
  options,
  aiEnabled,
}: {
  workflow: BuilderWorkflow;
  versions: BuilderVersion[];
  initialGraph: WorkflowGraph;
  publishedGraph: WorkflowGraph | null;
  options: BuilderOptions;
  aiEnabled: boolean;
}) {
  const t = useTranslations("adminWorkflows");
  const locale = useLocale();
  const router = useRouter();
  const rf = useReactFlow<WfNode, WfEdge>();
  const wrapRef = useRef<HTMLDivElement>(null);
  const init = useMemo(() => toFlow(initialGraph), [initialGraph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<WfNode>(init.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WfEdge>(init.edges);
  const [savedSig, setSavedSig] = useState(() => graphSignature(initialGraph));
  const [publishedSig, setPublishedSig] = useState(() => graphSignature(publishedGraph));
  const [tab, setTab] = useState<"inspect" | "validate" | "simulate">("inspect");
  const [choices, setChoices] = useState<SimChoices>({});
  const [aiInteraction, setAiInteraction] = useState<{ id: string; provider: string } | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);
  const [saving, startSave] = useTransition();
  const [publishing, startPublish] = useTransition();
  const [drafting, startDraft] = useTransition();
  const [reverting, startRevert] = useTransition();
  const Back = locale === "ar" ? ArrowRight : ArrowLeft;

  const graph = useMemo(() => fromFlow(nodes, edges), [nodes, edges]);
  const sig = useMemo(() => graphSignature(graph), [graph]);
  const dirty = sig !== savedSig;
  const differsFromPublished = sig !== publishedSig;
  const issues = useMemo(() => validateGraph(graph, { safeguarding: workflow.safeguarding }), [graph, workflow.safeguarding]);
  const issueNodes = useMemo(() => new Set(issues.map((i) => i.nodeId).filter(Boolean) as string[]), [issues]);
  const sim = useMemo(() => (tab === "simulate" ? simulate(graph, choices) : null), [tab, graph, choices]);
  const selectedNode = nodes.find((n) => n.selected) ?? null;
  const selectedEdge = selectedNode ? null : (edges.find((e) => e.selected) ?? null);
  const nodeById = useCallback((id: string) => nodes.find((n) => n.id === id), [nodes]);
  const nodeName = useCallback((id?: string) => (id ? labelOf(nodeById(id)?.data.label, locale) || id : ""), [nodeById, locale]);
  const currentVersion = versions.find((v) => v.current);
  const staleRuns = versions.reduce((s, v) => s + v.activeRuns, 0);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const canvasState = useMemo(() => ({ locale, options, issueNodes, sim: sim ? { nodeIds: sim.nodeIds } : null }), [locale, options, issueNodes, sim]);

  const displayEdges = useMemo(
    () =>
      edges.map((e) => {
        const onPath = sim ? sim.edgeIds.has(e.id) : null;
        const tone = e.sourceHandle === "rejected" || e.sourceHandle === "false" ? "var(--danger)" : e.sourceHandle ? "var(--success)" : "var(--muted-foreground)";
        return {
          ...e,
          type: "smoothstep",
          label: e.sourceHandle ? t(`handles.${e.sourceHandle}`) : undefined,
          labelStyle: { fontSize: 11, fontWeight: 600, fill: tone },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 6,
          labelBgStyle: { fill: "var(--card)" },
          markerEnd: { type: MarkerType.ArrowClosed, color: onPath ? "var(--success)" : tone, width: 16, height: 16 },
          animated: onPath === true,
          style: {
            stroke: onPath ? "var(--success)" : e.selected ? "var(--brand)" : tone,
            strokeWidth: onPath || e.selected ? 2.5 : 1.5,
            opacity: onPath === false ? 0.2 : 1,
          },
        } satisfies WfEdge;
      }),
    [edges, sim, t],
  );

  const isValidConnection: IsValidConnection<WfEdge> = useCallback(
    (c) => {
      if (!c.source || !c.target || c.source === c.target) return false;
      const src = nodeById(c.source);
      const tgt = nodeById(c.target);
      if (!src || !tgt || src.type === "end" || tgt.type === "start") return false;
      return !edges.some((e) => e.source === c.source && e.target === c.target && (e.sourceHandle ?? null) === (c.sourceHandle ?? null));
    },
    [edges, nodeById],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const h = c.sourceHandle ?? null;
      setEdges((eds) => addEdge({ ...c, id: uid("e"), sourceHandle: h, data: h && EDGE_LABELS[h] ? { label: EDGE_LABELS[h] } : {} }, eds));
    },
    [setEdges],
  );

  // Selecting a step by mouse or keyboard (Tab then Enter) opens it in the inspector.
  const onSelectionChange = useCallback(({ nodes: ns, edges: es }: { nodes: WfNode[]; edges: WfEdge[] }) => {
    if (ns.length || es.length) setTab("inspect");
  }, []);

  const fit = useCallback(() => requestAnimationFrame(() => rf.fitView({ padding: 0.15, duration: 300 })), [rf]);

  const load = useCallback(
    (g: WorkflowGraph) => {
      const f = toFlow(layoutGraph(g));
      setNodes(f.nodes);
      setEdges(f.edges);
      setChoices({});
      fit();
    },
    [fit, setEdges, setNodes],
  );

  const tidy = () => {
    const g = layoutGraph(graph);
    setNodes((ns) => ns.map((n) => ({ ...n, position: g.nodes.find((x) => x.id === n.id)?.position ?? n.position })));
    fit();
  };

  const selectNode = (id: string) => {
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
    setEdges((es) => es.map((e) => ({ ...e, selected: false })));
    const n = nodeById(id);
    if (n) rf.setCenter(n.position.x + 120, n.position.y + 40, { zoom: Math.max(rf.getZoom(), 0.9), duration: 300 });
  };

  const addNode = (type: NodeType) => {
    const id = uid(type);
    const data = defaultNodeConfig(type, {
      safeguarding: workflow.safeguarding,
      appointmentTypeKey: options.appointmentTypes[0]?.key,
      documentTemplateKey: options.documentTemplates[0]?.key,
    });
    const anchor = selectedNode && selectedNode.type !== "end" && !BRANCH_HANDLES[selectedNode.type as NodeType] ? selectedNode : null;
    if (anchor) {
      // Insert after the selected step: its plain outgoing edges now leave from the new step.
      const nextNodes: WfNode[] = [...nodes.map((n) => ({ ...n, selected: false })), { id, type, position: anchor.position, data, selected: true, deletable: true }];
      const nextEdges: WfEdge[] = [
        ...edges.map((e) => {
          if (e.source !== anchor.id || e.sourceHandle || type === "end") return e;
          // A branching step continues the old path through its first exit (approved or yes).
          const h = BRANCH_HANDLES[type]?.[0] ?? null;
          return { ...e, source: id, sourceHandle: h, data: h ? { label: EDGE_LABELS[h] } : e.data };
        }),
        { id: uid("e"), source: anchor.id, target: id, sourceHandle: null, data: {} },
      ];
      const laid = layoutGraph(fromFlow(nextNodes, nextEdges));
      setNodes(nextNodes.map((n) => ({ ...n, position: laid.nodes.find((x) => x.id === n.id)!.position })));
      setEdges(nextEdges);
      const p = laid.nodes.find((x) => x.id === id)!.position;
      requestAnimationFrame(() => rf.setCenter(p.x + 120, p.y + 40, { zoom: Math.max(rf.getZoom(), 0.9), duration: 300 }));
    } else {
      const rect = wrapRef.current?.getBoundingClientRect();
      const pos = rect ? rf.screenToFlowPosition({ x: rect.left + rect.width / 2 - 120, y: rect.top + rect.height / 2 - 40 }) : { x: 0, y: 0 };
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type, position: pos, data, selected: true, deletable: true }]);
    }
    setTab("inspect");
  };

  const updateNode = (id: string, data: NodeConfig) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data } : n)));
  const deleteNode = (id: string) => void rf.deleteElements({ nodes: [{ id }] });
  const deleteEdge = (id: string) => void rf.deleteElements({ edges: [{ id }] });

  const errorText = (code: string) => (t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic"));

  const save = () =>
    startSave(async () => {
      const res = await saveWorkflowDraftAction({ workflowId: workflow.id, graph, aiInteractionId: aiInteraction?.id });
      if (!res.ok) return void toast.error(errorText(res.error));
      setSavedSig(sig);
      setAiInteraction(null);
      toast.success(t("saved"));
      router.refresh();
    });

  const publish = () =>
    startPublish(async () => {
      const res = await publishWorkflowAction({ workflowId: workflow.id, graph, aiInteractionId: aiInteraction?.id });
      if (!res.ok) {
        toast.error(errorText(res.error));
        if (res.error === "INVALID") setTab("validate");
        return;
      }
      setSavedSig(sig);
      setPublishedSig(sig);
      setAiInteraction(null);
      setPublishOpen(false);
      toast.success(t("publishedToast", { version: res.version }));
      router.refresh();
    });

  const revert = () =>
    startRevert(async () => {
      const res = await discardWorkflowDraftAction({ workflowId: workflow.id });
      if (!res.ok || !publishedGraph) return void toast.error(errorText(res.ok ? "generic" : res.error));
      load(publishedGraph);
      setSavedSig(graphSignature(publishedGraph));
      setAiInteraction(null);
      setRevertOpen(false);
      toast.success(t("reverted"));
      router.refresh();
    });

  const draftAi = () =>
    startDraft(async () => {
      const res = await draftWorkflowWithAiAction({ workflowId: workflow.id, prompt: aiPrompt });
      if (!res.ok) return void toast.error(errorText(res.error));
      load(res.graph);
      setAiInteraction({ id: res.interactionId, provider: res.provider });
      setAiOpen(false);
      setTab("validate");
      toast.success(t("aiLoaded"));
    });

  const issueText = (i: ValidationIssue) => t(`issues.${i.code}`, { step: nodeName(i.nodeId) });
  const publishBlockedReason = issues.length ? t("publishBlocked", { count: issues.length }) : !differsFromPublished && workflow.publishedVersion ? t("nothingToPublish") : null;

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-4 px-4 py-5 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0 space-y-1">
          <Link href="/admin/workflows" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <Back className="size-4" />
            {t("backToList")}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{workflow.name}</h1>
            {workflow.publishedVersion ? <Pill tone="success">{t("liveVersion", { version: workflow.publishedVersion })}</Pill> : <Pill>{t("notPublished")}</Pill>}
            {dirty ? (
              <Pill tone="warning" dot>
                {t("unsaved")}
              </Pill>
            ) : differsFromPublished && workflow.publishedVersion ? (
              <Pill tone="info">{t("unpublishedChanges")}</Pill>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">{workflow.services.length ? t("usedBy", { services: workflow.services.join(locale === "ar" ? "، " : ", ") }) : t("noServicesLong")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" data-testid="wf-history">
                <History className="size-4" />
                {t("history")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              <div className="mb-2 text-sm font-semibold">{t("versions")}</div>
              {versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noVersions")}</p>
              ) : (
                <ul className="max-h-72 space-y-2 overflow-auto">
                  {versions.map((v) => (
                    <li key={v.version} className="flex items-start justify-between gap-2 rounded-lg border p-2.5 text-sm" data-testid="wf-version">
                      <div className="min-w-0">
                        <div className="font-medium">
                          {t("versionN", { version: v.version })} {v.current && <Pill tone="success">{t("live")}</Pill>}
                        </div>
                        <div className="text-xs text-muted-foreground">{v.by ? t("publishedBy", { date: v.publishedAt, name: v.by }) : v.publishedAt}</div>
                      </div>
                      {v.activeRuns > 0 && <Pill tone="info">{t("inFlight", { count: v.activeRuns })}</Pill>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted-foreground">{t("versionsHint")}</p>
            </PopoverContent>
          </Popover>
          {aiEnabled ? (
            <Button variant="outline" size="sm" onClick={() => setAiOpen(true)} data-testid="wf-ai">
              <Sparkles className="size-4" />
              {t("draftWithAi")}
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button variant="outline" size="sm" disabled>
                    <Sparkles className="size-4" />
                    {t("draftWithAi")}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("aiOff")}</TooltipContent>
            </Tooltip>
          )}
          <Button variant="outline" size="sm" onClick={tidy} data-testid="wf-tidy">
            <LayoutGrid className="size-4" />
            {t("tidy")}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button variant="outline" size="sm" onClick={() => setRevertOpen(true)} disabled={!publishedGraph || !differsFromPublished} data-testid="wf-revert">
                  <RotateCcw className="size-4" />
                  {t("revert")}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{!publishedGraph ? t("revertNoVersion") : !differsFromPublished ? t("revertNothing") : t("revertHint")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button variant="outline" size="sm" onClick={save} disabled={!dirty || saving} data-testid="wf-save">
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {t("saveDraft")}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{dirty ? t("saveHint") : t("noChanges")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button size="sm" onClick={() => setPublishOpen(true)} disabled={Boolean(publishBlockedReason) || publishing} data-testid="wf-publish">
                  <Rocket className="size-4" />
                  {t("publish")}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{publishBlockedReason ?? t("publishHint")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {workflow.safeguarding && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft p-3.5 text-sm" role="alert" data-testid="wf-sg-banner">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-danger" />
          <div>
            <div className="font-semibold text-danger">{t("sgTitle")}</div>
            <p className="text-foreground/80">{t("sgBody")}</p>
          </div>
        </div>
      )}
      {aiInteraction && (
        <div className="flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 p-3.5 text-sm" data-testid="wf-ai-banner">
          <Sparkles className="mt-0.5 size-5 shrink-0 text-violet-700" />
          <div className="flex-1">
            <div className="font-semibold text-violet-800">{t("aiBannerTitle")}</div>
            <p className="text-foreground/80">{aiInteraction.provider === "built-in" ? t("aiBannerBuiltIn") : t("aiBannerBody")}</p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => setAiInteraction(null)} aria-label={t("dismiss")}>
            <X className="size-4" />
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)_360px]">
        <section className="rounded-xl border bg-card p-3 shadow-xs" aria-label={t("palette")}>
          <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("palette")}</div>
          <p className="mb-2 px-1 text-xs text-muted-foreground">{selectedNode && selectedNode.type !== "end" && !BRANCH_HANDLES[selectedNode.type as NodeType] ? t("paletteAfter", { step: nodeName(selectedNode.id) }) : t("paletteHint")}</p>
          <div className="flex flex-wrap gap-1.5 lg:flex-col">
            {PALETTE.map((type) => {
              const M = NODE_META[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => addNode(type)}
                  className="flex items-center gap-2 rounded-lg border bg-background px-2 py-1.5 text-start text-sm transition hover:border-brand/40 hover:bg-muted/50 lg:w-full"
                  data-testid={`wf-add-${type}`}
                >
                  <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", M.tone)}>
                    <M.icon className="size-3.5" />
                  </span>
                  <span className="truncate">{t(`types.${type}`)}</span>
                </button>
              );
            })}
          </div>
        </section>

        <div ref={wrapRef} dir="ltr" className="relative h-[62vh] min-h-[460px] overflow-hidden rounded-xl border bg-muted/20 lg:h-[calc(100vh-16rem)]" data-testid="wf-canvas">
          <CanvasContext.Provider value={canvasState}>
            <ReactFlow<WfNode, WfEdge>
              nodes={nodes}
              edges={displayEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onSelectionChange={onSelectionChange}
              deleteKeyCode={["Backspace", "Delete"]}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.2}
              maxZoom={1.6}
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{ type: "smoothstep" }}
            >
              <Background gap={20} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </CanvasContext.Provider>
        </div>

        <aside className="rounded-xl border bg-card shadow-xs lg:h-[calc(100vh-16rem)] lg:overflow-y-auto">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="gap-0">
            <div className="sticky top-0 z-10 border-b bg-card p-2">
              <TabsList className="w-full">
                <TabsTrigger value="inspect" data-testid="wf-tab-inspect">
                  {t("tabInspect")}
                </TabsTrigger>
                <TabsTrigger value="validate" data-testid="wf-tab-validate">
                  {t("tabValidate")}
                  {issues.length > 0 ? (
                    <span className="ms-1 rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">{issues.length}</span>
                  ) : (
                    <CheckCircle2 className="ms-1 size-3.5 text-success" />
                  )}
                </TabsTrigger>
                <TabsTrigger value="simulate" data-testid="wf-tab-simulate">
                  {t("tabSimulate")}
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="inspect" className="p-4">
              {selectedNode ? (
                <NodeInspector
                  key={selectedNode.id}
                  id={selectedNode.id}
                  type={selectedNode.type as NodeType}
                  data={selectedNode.data}
                  onChange={(d) => updateNode(selectedNode.id, d)}
                  onDelete={() => deleteNode(selectedNode.id)}
                  options={options}
                  safeguarding={workflow.safeguarding}
                />
              ) : selectedEdge ? (
                <div className="space-y-3" data-testid="wf-edge-inspector">
                  <div className="text-sm font-semibold">{t("connection")}</div>
                  <p className="text-sm">
                    {t("connectionFromTo", { from: nodeName(selectedEdge.source), to: nodeName(selectedEdge.target) })}
                  </p>
                  {selectedEdge.sourceHandle && <Pill tone={selectedEdge.sourceHandle === "rejected" || selectedEdge.sourceHandle === "false" ? "danger" : "success"}>{t(`handles.${selectedEdge.sourceHandle}`)}</Pill>}
                  <Button variant="outline" size="sm" className="w-full text-danger" onClick={() => deleteEdge(selectedEdge.id)} data-testid="wf-delete-edge">
                    <X className="size-4" />
                    {t("disconnect")}
                  </Button>
                  <p className="text-xs text-muted-foreground">{t("keyboardHint")}</p>
                </div>
              ) : (
                <div className="space-y-4 text-sm">
                  <div className="flex flex-col items-center rounded-xl border border-dashed p-5 text-center">
                    <MousePointerClick className="mb-2 size-6 text-muted-foreground" />
                    <div className="font-medium">{t("selectStep")}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{t("selectStepBody")}</p>
                  </div>
                  <ul className="space-y-1.5 text-xs text-muted-foreground">
                    <li>{t("helpConnect")}</li>
                    <li>{t("helpBranches")}</li>
                    <li>{t("keyboardHint")}</li>
                  </ul>
                  {workflow.description && <p className="rounded-lg bg-muted/40 p-3 text-xs">{workflow.description}</p>}
                </div>
              )}
            </TabsContent>

            <TabsContent value="validate" className="space-y-3 p-4" data-testid="wf-validation">
              {issues.length === 0 ? (
                <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success-soft p-3.5">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
                  <div>
                    <div className="text-sm font-semibold text-success">{t("validTitle")}</div>
                    <p className="text-xs text-foreground/80">{workflow.safeguarding ? t("validBodySg") : t("validBody")}</p>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{t("issuesIntro", { count: issues.length })}</p>
                  <ul className="space-y-2">
                    {issues.map((i, k) => (
                      <li key={k} className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft/50 p-2.5 text-sm" data-testid="wf-issue">
                        <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />
                        <span className="flex-1">{issueText(i)}</span>
                        {i.nodeId && nodeById(i.nodeId) && (
                          <Button variant="ghost" size="xs" onClick={() => (selectNode(i.nodeId!), setTab("inspect"))}>
                            {t("show")}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                <div className="mb-1 font-medium text-foreground">{t("rulesTitle")}</div>
                <ul className="list-disc space-y-0.5 ps-4">
                  <li>{t("rules.start")}</li>
                  <li>{t("rules.end")}</li>
                  <li>{t("rules.edges")}</li>
                  <li>{t("rules.config")}</li>
                  <li>{t("rules.branches")}</li>
                  {workflow.safeguarding && <li className="text-danger">{t("rules.safeguarding")}</li>}
                </ul>
              </div>
            </TabsContent>

            <TabsContent value="simulate" className="space-y-4 p-4" data-testid="wf-simulation">
              <p className="text-xs text-muted-foreground">{t("simIntro")}</p>
              {sim && (
                <>
                  {sim.steps.some((s) => s.handle) && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("simDecisions")}</div>
                      {sim.steps
                        .filter((s) => s.handle)
                        .map((s) => {
                          const n = nodeById(s.nodeId)!;
                          const hs = BRANCH_HANDLES[n.type as NodeType]!;
                          return (
                            <div key={s.nodeId} className="rounded-lg border p-2.5">
                              <div className="mb-1.5 truncate text-sm font-medium" dir="auto">
                                {nodeName(s.nodeId)}
                              </div>
                              <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={nodeName(s.nodeId)}>
                                {hs.map((h, idx) => (
                                  <button
                                    key={h}
                                    type="button"
                                    role="radio"
                                    aria-checked={s.handle === h}
                                    onClick={() => setChoices((c) => ({ ...c, [s.nodeId]: h }))}
                                    className={cn(
                                      "rounded-md border px-2 py-1 text-xs font-medium transition",
                                      s.handle === h ? (idx === 0 ? "border-success bg-success-soft text-success" : "border-danger bg-danger-soft text-danger") : "hover:bg-muted",
                                    )}
                                    data-testid={`wf-sim-${s.nodeId}-${h}`}
                                  >
                                    {t(`simChoice.${h}`)}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("simPath")}</div>
                    <ol className="space-y-1.5" data-testid="wf-sim-path">
                      {sim.steps.map((s, i) => {
                        const n = nodeById(s.nodeId)!;
                        const M = NODE_META[n.type as NodeType];
                        return (
                          <li key={s.nodeId} className="flex items-center gap-2 text-sm">
                            <span className="w-5 text-end text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                            <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", M.tone)}>
                              <M.icon className="size-3.5" />
                            </span>
                            <span className="min-w-0 flex-1 truncate" dir="auto">
                              {nodeName(s.nodeId)}
                            </span>
                            {s.waits && (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <PauseCircle className="size-3.5" />
                                {t(`simWaits.${n.type === "approval" ? "approval" : n.type === "wait" ? "wait" : "task"}`)}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                  <div className="rounded-lg border p-3 text-sm" data-testid="wf-sim-result">
                    {sim.stuck && !sim.outcome ? (
                      <span className="flex items-center gap-2 text-danger">
                        <AlertCircle className="size-4" />
                        {t("simStuck")}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        {t("simOutcome")}
                        <Pill tone={sim.outcome === "COMPLETED" ? "success" : "danger"}>{t(`outcomes.${sim.outcome ?? "COMPLETED"}`)}</Pill>
                      </span>
                    )}
                  </div>
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setChoices({})} disabled={Object.keys(choices).length === 0}>
                    <RotateCcw className="size-4" />
                    {t("simReset")}
                  </Button>
                </>
              )}
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("publishTitle", { version: (versions[0]?.version ?? 0) + 1 })}</DialogTitle>
            <DialogDescription>{t("publishBody")}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              {workflow.services.length ? t("publishServices", { count: workflow.services.length }) : t("publishNoServices")}
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              {staleRuns ? t("publishInFlight", { count: staleRuns, version: currentVersion?.version ?? 1 }) : t("publishNoInFlight")}
            </li>
            {dirty && (
              <li className="flex items-start gap-2">
                <Save className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                {t("publishSavesDraft")}
              </li>
            )}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={publish} disabled={publishing} data-testid="wf-publish-confirm">
              {publishing ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
              {t("publishConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revertOpen} onOpenChange={setRevertOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("revertTitle")}</DialogTitle>
            <DialogDescription>{t("revertBody", { version: workflow.publishedVersion ?? 1 })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevertOpen(false)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={revert} disabled={reverting} data-testid="wf-revert-confirm">
              {reverting && <Loader2 className="size-4 animate-spin" />}
              {t("revertConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("aiTitle")}</DialogTitle>
            <DialogDescription>{t("aiBody")}</DialogDescription>
          </DialogHeader>
          <Textarea rows={5} value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder={t("aiPlaceholder")} data-testid="wf-ai-prompt" />
          <div className="flex flex-wrap gap-1.5">
            {(["aiExample1", "aiExample2", "aiExample3"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setAiPrompt(t(k))} className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted">
                {t(k)}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("aiNote")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={draftAi} disabled={drafting || aiPrompt.trim().length < 8} data-testid="wf-ai-generate">
              {drafting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {t("aiGenerate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
