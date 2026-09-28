// Simple top-to-bottom layered layout for workflow graphs. Pure, used by the builder and AI drafts.
import type { WorkflowGraph } from "./graph";
import { BRANCH_HANDLES } from "./validate";

export const NODE_W = 240;
export const NODE_H = 100;
const X_GAP = 60;
const Y_GAP = 80;

/** Return a copy of the graph with positions laid out in layers from the start node. */
export function layoutGraph(graph: WorkflowGraph): WorkflowGraph {
  const ids = graph.nodes.map((n) => n.id);
  const outs = new Map<string, string[]>();
  const handleOrder = (h: string | null | undefined, type: string) => {
    const hs = BRANCH_HANDLES[type as keyof typeof BRANCH_HANDLES];
    return hs && h ? hs.indexOf(h) : 0;
  };
  const typeOf = new Map(graph.nodes.map((n) => [n.id, n.type]));
  for (const e of [...graph.edges].sort((a, b) => handleOrder(a.sourceHandle, typeOf.get(a.source) ?? "") - handleOrder(b.sourceHandle, typeOf.get(b.source) ?? ""))) {
    if (!typeOf.has(e.source) || !typeOf.has(e.target) || e.source === e.target) continue;
    outs.set(e.source, [...(outs.get(e.source) ?? []), e.target]);
  }

  // Longest-path layering over the DAG reachable from the roots (back edges ignored).
  const layer = new Map<string, number>();
  const order: string[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const t of outs.get(id) ?? []) if (!state.has(t)) visit(t);
    state.set(id, 2);
    order.push(id);
  };
  const start = graph.nodes.find((n) => n.type === "start");
  if (start) visit(start.id);
  for (const id of ids) if (!state.has(id)) visit(id);
  order.reverse(); // topological order (ignoring back edges)
  const pos = new Map(order.map((id, i) => [id, i]));
  for (const id of order) {
    const l = layer.get(id) ?? 0;
    layer.set(id, l);
    for (const t of outs.get(id) ?? []) {
      if ((pos.get(t) ?? 0) <= (pos.get(id) ?? 0)) continue; // back edge
      layer.set(t, Math.max(layer.get(t) ?? 0, l + 1));
    }
  }
  // End nodes sink to the bottom so outcomes line up.
  const maxLayer = Math.max(0, ...layer.values());
  for (const n of graph.nodes) if (n.type === "end" && (outs.get(n.id) ?? []).length === 0) layer.set(n.id, maxLayer);

  const layers: string[][] = [];
  for (const id of order) (layers[layer.get(id)!] ??= []).push(id);

  // Order each layer by the average slot of its parents (barycentre), keeping branch order.
  const slot = new Map<string, number>();
  const parents = new Map<string, string[]>();
  for (const [s, ts] of outs) for (const t of ts) parents.set(t, [...(parents.get(t) ?? []), s]);
  layers.forEach((ids, li) => {
    if (li > 0) {
      const score = (id: string) => {
        const ps = (parents.get(id) ?? []).filter((p) => slot.has(p));
        if (!ps.length) return Number.MAX_SAFE_INTEGER;
        // Offset by the index among the parent's children so yes/no and approved/rejected stay ordered.
        return ps.reduce((sum, p) => sum + slot.get(p)! + (outs.get(p)!.indexOf(id) - (outs.get(p)!.length - 1) / 2) * (NODE_W / 2), 0) / ps.length;
      };
      ids.sort((a, b) => score(a) - score(b));
    }
    const width = ids.length * NODE_W + (ids.length - 1) * X_GAP;
    ids.forEach((id, i) => slot.set(id, -width / 2 + i * (NODE_W + X_GAP) + NODE_W / 2));
  });

  return {
    ...graph,
    nodes: graph.nodes.map((n) => ({
      ...n,
      position: { x: Math.round((slot.get(n.id) ?? 0) - NODE_W / 2), y: (layer.get(n.id) ?? 0) * (NODE_H + Y_GAP) },
    })),
  };
}
