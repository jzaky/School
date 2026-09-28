// Dry run of a workflow graph for a chosen set of outcomes. Pure: never touches the database.
// Mirrors the engine's traversal: branching nodes follow the chosen handle, other nodes follow every outgoing edge.
import type { NodeConfig, WorkflowGraph } from "./graph";
import { BRANCH_HANDLES } from "./validate";

export type SimChoices = Record<string, string>;

export type SimStep = { nodeId: string; handle: string | null; waits: boolean };

export type SimResult = {
  steps: SimStep[];
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  outcome: NodeConfig["outcome"] | null;
  /** True when the walk stopped because the graph loops or leads nowhere. */
  stuck: boolean;
};

/** The default outcome for a branching node: the happy path. */
export function defaultChoice(type: string): string | null {
  const h = BRANCH_HANDLES[type as keyof typeof BRANCH_HANDLES];
  return h ? h[0] : null;
}

export function simulate(graph: WorkflowGraph, choices: SimChoices = {}): SimResult {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const start = graph.nodes.find((n) => n.type === "start");
  const res: SimResult = { steps: [], nodeIds: new Set(), edgeIds: new Set(), outcome: null, stuck: false };
  if (!start) return { ...res, stuck: true };
  const queue = [start.id];
  let guard = 0;
  while (queue.length && guard++ < 500) {
    const id = queue.shift()!;
    const node = nodes.get(id);
    if (!node || res.nodeIds.has(id)) continue;
    res.nodeIds.add(id);
    const handle = BRANCH_HANDLES[node.type] ? (choices[id] ?? defaultChoice(node.type)) : null;
    const waits = node.type === "approval" || node.type === "wait" || (node.type === "task" && Boolean(node.data.blocking));
    res.steps.push({ nodeId: id, handle, waits });
    if (node.type === "end") {
      // A rejected end anywhere wins, matching how the engine closes the request.
      if (!res.outcome || node.data.outcome === "REJECTED") res.outcome = node.data.outcome ?? "COMPLETED";
      continue;
    }
    const outs = graph.edges.filter((e) => e.source === id && (!handle || !e.sourceHandle || e.sourceHandle === handle));
    if (!outs.length) res.stuck = true;
    for (const e of outs) {
      if (!nodes.has(e.target)) continue;
      res.edgeIds.add(e.id);
      // Each step runs once per request, as in the engine. Loops are reported by validation.
      if (!res.nodeIds.has(e.target) && !queue.includes(e.target)) queue.push(e.target);
    }
  }
  if (!res.outcome) res.stuck = true;
  return res;
}
