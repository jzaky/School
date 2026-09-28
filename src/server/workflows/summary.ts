import type { WorkflowGraph } from "./graph";

/** Human-readable list of the main steps of a workflow, for "What happens next". */
export function workflowSummary(graph: WorkflowGraph | null, locale: string): string[] {
  if (!graph) return [];
  const out: string[] = [];
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  let cur = graph.nodes.find((n) => n.type === "start");
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (["approval", "create_case", "generate_document", "schedule_meeting", "task"].includes(cur.type)) {
      out.push(locale === "ar" ? cur.data.label.ar : cur.data.label.en);
    }
    const edges = graph.edges.filter((e) => e.source === cur!.id);
    const e = edges.find((x) => x.sourceHandle === "approved" || x.sourceHandle === "false") ?? edges.find((x) => !x.sourceHandle) ?? edges[0];
    cur = e ? nodes.get(e.target) : undefined;
  }
  return out.slice(0, 6);
}
