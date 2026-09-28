// Workflow graph validation, shared by the builder (live panel) and the publish action (server check).
// Pure module: no database or server-only imports, so the client bundle can use it.
import { NODE_TYPES, type Assignee, type NodeConfig, type NodeType, type WorkflowCondition, type WorkflowEdge, type WorkflowGraph, type WorkflowNode } from "./graph";

export type IssueCode =
  | "no_start"
  | "multiple_start"
  | "no_end"
  | "end_unreachable"
  | "unreachable"
  | "dead_end"
  | "start_incoming"
  | "end_outgoing"
  | "dangling_edge"
  | "duplicate_edge"
  | "self_loop"
  | "cycle"
  | "bad_handle"
  | "missing_label"
  | "missing_assignee"
  | "missing_title"
  | "missing_template"
  | "missing_recipients"
  | "missing_condition"
  | "missing_value"
  | "missing_hours"
  | "missing_case_type"
  | "missing_appointment_type"
  | "missing_document_template"
  | "missing_status"
  | "missing_outcome"
  | "no_approvers"
  | "approver_incomplete"
  | "missing_branch_true"
  | "missing_branch_false"
  | "missing_branch_approved"
  | "missing_branch_rejected"
  | "sg_no_case"
  | "sg_case_not_restricted"
  | "sg_routing"
  | "sg_family_notified";

export type ValidationIssue = { code: IssueCode; nodeId?: string; edgeId?: string };

export type ValidateOptions = {
  /** The workflow serves a SAFEGUARDING service: routing must stay with the DSL. */
  safeguarding?: boolean;
};

/** Handles each branching node type must provide. Other node types use a single unnamed handle. */
export const BRANCH_HANDLES: Partial<Record<NodeType, [string, string]>> = {
  condition: ["true", "false"],
  approval: ["approved", "rejected"],
};

/** Roles that may receive or own safeguarding work. `case_assignee` inherits the DSL from the case. */
export const SG_ROLES = ["dsl", "deputy_dsl"];

const OPS_WITHOUT_VALUE = new Set(["empty", "not_empty"]);

export function assigneeComplete(a: Assignee | undefined | null): boolean {
  if (!a || typeof a !== "object" || !("kind" in a)) return false;
  switch (a.kind) {
    case "role":
      return Boolean(a.role);
    case "member":
      return Boolean(a.membershipId);
    case "persona":
      return Boolean(a.persona);
    default:
      return true;
  }
}

/** True when an assignee keeps safeguarding work with the DSL team. */
export function sgAssigneeOk(a: Assignee | undefined | null): boolean {
  if (!a) return false;
  if (a.kind === "case_assignee") return true;
  return a.kind === "role" && SG_ROLES.includes(a.role);
}

function hasText(t: { en?: string; ar?: string } | undefined | null) {
  return Boolean(t && t.en?.trim() && t.ar?.trim());
}

function conditionComplete(c: WorkflowCondition | undefined): "ok" | "missing_condition" | "missing_value" {
  if (!c) return "missing_condition";
  if ("all" in c) return c.all.length ? (c.all.map(conditionComplete).find((x) => x !== "ok") ?? "ok") : "missing_condition";
  if ("any" in c) return c.any.length ? (c.any.map(conditionComplete).find((x) => x !== "ok") ?? "ok") : "missing_condition";
  if (!c.field?.trim() || !c.op) return "missing_condition";
  if (!OPS_WITHOUT_VALUE.has(c.op) && (c.value === undefined || c.value === null || c.value === "")) return "missing_value";
  return "ok";
}

function nodeConfigIssues(node: WorkflowNode): IssueCode[] {
  const d: NodeConfig = node.data ?? ({} as NodeConfig);
  const out: IssueCode[] = [];
  if (!hasText(d.label)) out.push("missing_label");
  switch (node.type) {
    case "approval":
      if (!d.approvers?.length) out.push("no_approvers");
      else if (d.approvers.some((ap) => !assigneeComplete(ap.assignee) || !hasText(ap.label))) out.push("approver_incomplete");
      break;
    case "task":
      if (!assigneeComplete(d.assignee)) out.push("missing_assignee");
      if (!hasText(d.title)) out.push("missing_title");
      break;
    case "schedule_meeting":
      if (!assigneeComplete(d.assignee)) out.push("missing_assignee");
      if (!d.appointmentTypeKey) out.push("missing_appointment_type");
      break;
    case "assign":
      if (!assigneeComplete(d.assignee)) out.push("missing_assignee");
      break;
    case "create_case":
      if (!d.caseType) out.push("missing_case_type");
      if (!assigneeComplete(d.assignee)) out.push("missing_assignee");
      break;
    case "notify":
      if (!d.template) out.push("missing_template");
      if (!d.recipients?.length || d.recipients.some((r) => !assigneeComplete(r))) out.push("missing_recipients");
      break;
    case "condition": {
      const c = conditionComplete(d.condition);
      if (c !== "ok") out.push(c);
      break;
    }
    case "wait":
      if (!(typeof d.hours === "number" && d.hours > 0)) out.push("missing_hours");
      break;
    case "generate_document":
      if (!d.templateKey) out.push("missing_document_template");
      break;
    case "update_status":
      if (!d.status) out.push("missing_status");
      break;
    case "end":
      if (!d.outcome) out.push("missing_outcome");
      break;
  }
  return out;
}

/** Validate a workflow graph. An empty result means it can be published. */
export function validateGraph(graph: WorkflowGraph, opts: ValidateOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const starts = graph.nodes.filter((n) => n.type === "start");
  const ends = graph.nodes.filter((n) => n.type === "end");

  if (starts.length === 0) issues.push({ code: "no_start" });
  if (starts.length > 1) for (const s of starts.slice(1)) issues.push({ code: "multiple_start", nodeId: s.id });
  if (ends.length === 0) issues.push({ code: "no_end" });

  // Edges
  const seen = new Set<string>();
  const validEdges: WorkflowEdge[] = [];
  for (const e of graph.edges) {
    const src = nodes.get(e.source);
    const tgt = nodes.get(e.target);
    if (!src || !tgt) {
      issues.push({ code: "dangling_edge", edgeId: e.id });
      continue;
    }
    if (e.source === e.target) {
      issues.push({ code: "self_loop", edgeId: e.id, nodeId: e.source });
      continue;
    }
    const handles = BRANCH_HANDLES[src.type];
    const h = e.sourceHandle ?? null;
    if (handles ? !h || !handles.includes(h) : h !== null) {
      issues.push({ code: "bad_handle", edgeId: e.id, nodeId: src.id });
      continue;
    }
    const key = `${e.source}:${h ?? ""}->${e.target}`;
    if (seen.has(key)) {
      issues.push({ code: "duplicate_edge", edgeId: e.id, nodeId: src.id });
      continue;
    }
    seen.add(key);
    if (tgt.type === "start") issues.push({ code: "start_incoming", edgeId: e.id, nodeId: tgt.id });
    if (src.type === "end") issues.push({ code: "end_outgoing", edgeId: e.id, nodeId: src.id });
    validEdges.push(e);
  }
  const outs = new Map<string, WorkflowEdge[]>();
  for (const e of validEdges) outs.set(e.source, [...(outs.get(e.source) ?? []), e]);

  // Node config, branches and dead ends
  for (const n of graph.nodes) {
    if (!NODE_TYPES.includes(n.type)) continue;
    for (const code of nodeConfigIssues(n)) issues.push({ code, nodeId: n.id });
    const o = outs.get(n.id) ?? [];
    const handles = BRANCH_HANDLES[n.type];
    if (handles) {
      const [yes, no] = handles;
      if (!o.some((e) => e.sourceHandle === yes)) issues.push({ code: n.type === "condition" ? "missing_branch_true" : "missing_branch_approved", nodeId: n.id });
      if (!o.some((e) => e.sourceHandle === no)) issues.push({ code: n.type === "condition" ? "missing_branch_false" : "missing_branch_rejected", nodeId: n.id });
    } else if (n.type !== "end" && o.length === 0) {
      issues.push({ code: "dead_end", nodeId: n.id });
    }
  }

  // Reachability from the start node
  if (starts.length >= 1) {
    const reach = new Set<string>([starts[0].id]);
    const queue = [starts[0].id];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of outs.get(id) ?? []) {
        if (reach.has(e.target)) continue;
        reach.add(e.target);
        queue.push(e.target);
      }
    }
    if (ends.length && !ends.some((e) => reach.has(e.id))) issues.push({ code: "end_unreachable" });
    for (const n of graph.nodes) if (!reach.has(n.id) && n.type !== "start") issues.push({ code: "unreachable", nodeId: n.id });
  }

  // Cycles (the engine runs each step once per request, so loops would stall a run)
  const state = new Map<string, 1 | 2>();
  const cyclic = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of outs.get(id) ?? []) {
      const s = state.get(e.target);
      if (s === 1) cyclic.add(e.target);
      else if (!s) visit(e.target);
    }
    state.set(id, 2);
  };
  for (const n of graph.nodes) if (!state.has(n.id)) visit(n.id);
  for (const id of cyclic) issues.push({ code: "cycle", nodeId: id });

  // Safeguarding: routing must stay with the Designated Safeguarding Lead team.
  if (opts.safeguarding) {
    const cases = graph.nodes.filter((n) => n.type === "create_case");
    if (!cases.length) issues.push({ code: "sg_no_case" });
    for (const n of graph.nodes) {
      const d = n.data ?? ({} as NodeConfig);
      if (n.type === "create_case") {
        if (d.sensitivity !== "SAFEGUARDING" || d.caseType !== "SAFEGUARDING") issues.push({ code: "sg_case_not_restricted", nodeId: n.id });
        if (d.assignee && !(d.assignee.kind === "role" && SG_ROLES.includes(d.assignee.role))) issues.push({ code: "sg_routing", nodeId: n.id });
      }
      if ((n.type === "assign" || n.type === "task" || n.type === "schedule_meeting") && d.assignee && !sgAssigneeOk(d.assignee)) {
        issues.push({ code: "sg_routing", nodeId: n.id });
      }
      if (n.type === "approval" && (d.approvers ?? []).some((ap) => !sgAssigneeOk(ap.assignee))) issues.push({ code: "sg_routing", nodeId: n.id });
      if (n.type === "notify") {
        const rs = d.recipients ?? [];
        if (rs.some((r) => r.kind === "guardians" || r.kind === "student")) issues.push({ code: "sg_family_notified", nodeId: n.id });
        else if (rs.some((r) => !sgAssigneeOk(r))) issues.push({ code: "sg_routing", nodeId: n.id });
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Parsing untrusted graphs (client payloads, AI output)
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

/** Turn an untrusted value into a clean WorkflowGraph, dropping UI-only fields. Returns null when the shape is wrong. */
export function parseGraph(input: unknown): WorkflowGraph | null {
  if (!isObj(input) || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) return null;
  if (input.nodes.length > 200 || input.edges.length > 400) return null;
  const nodes: WorkflowNode[] = [];
  const ids = new Set<string>();
  for (const raw of input.nodes) {
    if (!isObj(raw)) return null;
    const id = str(raw.id, 64);
    const type = raw.type as NodeType;
    if (!id || ids.has(id) || !NODE_TYPES.includes(type)) return null;
    ids.add(id);
    const pos = isObj(raw.position) ? raw.position : {};
    const data = isObj(raw.data) ? (JSON.parse(JSON.stringify(raw.data)) as NodeConfig) : ({} as NodeConfig);
    const label = isObj(data.label) ? { en: str(data.label.en), ar: str(data.label.ar) } : { en: "", ar: "" };
    nodes.push({
      id,
      type,
      position: { x: Number(pos.x) || 0, y: Number(pos.y) || 0 },
      data: { ...data, label },
    });
  }
  const edges: WorkflowEdge[] = [];
  const edgeIds = new Set<string>();
  for (const raw of input.edges) {
    if (!isObj(raw)) return null;
    let id = str(raw.id, 64);
    if (!id || edgeIds.has(id)) id = `e_${edgeIds.size + 1}_${str(raw.source, 20)}_${str(raw.target, 20)}`;
    edgeIds.add(id);
    const label = isObj(raw.label) ? { en: str(raw.label.en), ar: str(raw.label.ar) } : undefined;
    edges.push({ id, source: str(raw.source, 64), target: str(raw.target, 64), sourceHandle: str(raw.sourceHandle, 32) || null, ...(label ? { label } : {}) });
  }
  return { nodes, edges };
}

/** Stable JSON form used to compare graphs (ignores positions). */
export function graphSignature(g: WorkflowGraph | null | undefined): string {
  if (!g) return "";
  const nodes = [...g.nodes].sort((a, b) => a.id.localeCompare(b.id)).map((n) => [n.id, n.type, n.data]);
  const edges = [...g.edges].map((e) => [e.source, e.sourceHandle ?? "", e.target]).sort((a, b) => a.join().localeCompare(b.join()));
  return JSON.stringify({ nodes, edges });
}
