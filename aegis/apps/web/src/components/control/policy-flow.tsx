"use client";
import * as React from "react";
import { ReactFlow, Background, Controls, type Node, type Edge, Position, Handle, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { PolicyDocument } from "@aegis/core/policy/schema";
import { EFFECT_LABEL } from "./policy-templates";
import { useThemeTokens } from "@/lib/theme";

// Fixed effect colours readable on both themes; the canvas, edges and labels follow the theme.
const EFFECT_COLOR: Record<string, string> = { deny: "#d9363e", require_approval: "#d48806", allow: "#22a35a", default: "#64748b" };
const COLUMNS: { effect: string; title: string; x: number }[] = [
  { effect: "deny", title: "1. Deny rules (these always win)", x: 0 },
  { effect: "require_approval", title: "2. Approval rules", x: 280 },
  { effect: "allow", title: "3. Allow rules", x: 560 },
];

interface RuleNodeData extends Record<string, unknown> {
  label: string;
  effect: string;
  description: string;
  order: number;
  conditions: number;
}

function countComparisons(c: unknown): number {
  if (!c || typeof c !== "object") return 0;
  const o = c as Record<string, unknown>;
  if ("attr" in o) return 1;
  if ("always" in o) return 0;
  if (Array.isArray(o.all)) return o.all.reduce<number>((n, x) => n + countComparisons(x), 0);
  if (Array.isArray(o.any)) return o.any.reduce<number>((n, x) => n + countComparisons(x), 0);
  if ("not" in o) return countComparisons(o.not);
  return 0;
}

function RuleNode({ data }: NodeProps<Node<RuleNodeData>>) {
  const color = EFFECT_COLOR[data.effect] ?? EFFECT_COLOR.default;
  return (
    <div className="w-[230px] rounded-md border bg-bg-elev px-2.5 py-2 text-start shadow-md" style={{ borderColor: color }}>
      <Handle type="target" position={Position.Top} style={{ background: color, border: "none" }} />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-xs text-fg">{data.label}</span>
        <span className="shrink-0 text-[10px] tabular text-fg-dim">#{data.order}</span>
      </div>
      <div className="mt-1 text-[11px] font-medium" style={{ color }}>
        {EFFECT_LABEL[data.effect] ?? data.effect}
      </div>
      {data.description ? <div className="mt-0.5 line-clamp-2 text-[11px] text-fg-muted">{data.description}</div> : null}
      <div className="mt-1 text-[10px] text-fg-dim">{data.conditions === 0 ? "always" : `${data.conditions} comparison${data.conditions === 1 ? "" : "s"}`}</div>
      <Handle type="source" position={Position.Bottom} style={{ background: color, border: "none" }} />
    </div>
  );
}

function HeaderNode({ data }: NodeProps<Node<{ label: string; color: string }>>) {
  return (
    <div className="w-[230px] rounded-md border border-dashed px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ borderColor: data.color, color: data.color }}>
      {data.label}
    </div>
  );
}

const nodeTypes = { rule: RuleNode, header: HeaderNode };

/** Rules as nodes grouped by effect, in evaluation order, with the combining order annotated. Read-only. */
export function PolicyFlow({ doc }: { doc: PolicyDocument | null }) {
  const t = useThemeTokens();
  const dark = t.bg.toLowerCase() === "#0b0f17";
  const { nodes, edges } = React.useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    for (const col of COLUMNS) nodes.push({ id: `h-${col.effect}`, type: "header", position: { x: col.x, y: 0 }, data: { label: col.title, color: EFFECT_COLOR[col.effect]! }, draggable: false, selectable: false });
    const rowY: Record<string, number> = { deny: 50, require_approval: 50, allow: 50 };
    const rules = doc?.rules ?? [];
    let prevId: string | null = null;
    rules.forEach((r, i) => {
      const col = COLUMNS.find((c) => c.effect === r.effect) ?? COLUMNS[2]!;
      const id = `r-${r.id}`;
      nodes.push({ id, type: "rule", position: { x: col.x, y: rowY[r.effect] ?? 50 }, data: { label: r.id, effect: r.effect, description: r.description, order: i + 1, conditions: countComparisons(r.when) } satisfies RuleNodeData });
      rowY[r.effect] = (rowY[r.effect] ?? 50) + 120;
      if (prevId) edges.push({ id: `e-${prevId}-${id}`, source: prevId, target: id, animated: false, style: { stroke: t["line-strong"] }, label: i === 1 ? "evaluation order" : undefined, labelStyle: { fill: t["fg-muted"], fontSize: 10 }, labelBgStyle: { fill: t.bg } });
      prevId = id;
    });
    const maxY = Math.max(rowY.deny ?? 50, rowY.require_approval ?? 50, rowY.allow ?? 50);
    nodes.push({ id: "default-deny", type: "rule", position: { x: 280, y: maxY + 20 }, data: { label: "default", effect: "default", description: "No matching rule: the request is denied.", order: rules.length + 1, conditions: 0 } satisfies RuleNodeData, draggable: false });
    if (prevId) edges.push({ id: `e-${prevId}-default`, source: prevId, target: "default-deny", style: { stroke: t["line-strong"], strokeDasharray: "4 4" }, label: "otherwise", labelStyle: { fill: t["fg-muted"], fontSize: 10 }, labelBgStyle: { fill: t.bg } });
    return { nodes, edges };
  }, [doc, t]);

  return (
    <div className="h-[520px] w-full overflow-hidden rounded-md border border-line bg-bg" role="img" aria-label={`Policy rule graph with ${doc?.rules.length ?? 0} rules grouped by effect`}>
      <ReactFlow key={nodes.length} nodes={nodes} edges={edges} nodeTypes={nodeTypes} colorMode={dark ? "dark" : "light"} fitView fitViewOptions={{ padding: 0.2 }} nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.3} maxZoom={1.5}>
        <Background gap={16} color={t["bg-elev-2"]} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <p className="sr-only">How rules combine: a deny rule beats an approval rule, and an approval rule beats an allow rule. When no rule matches, the request is denied.</p>
    </div>
  );
}
