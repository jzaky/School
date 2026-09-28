import type { Ctx } from "@/server/context";
import type { WorkflowGraph, WorkflowNode } from "@/server/workflows/graph";
import { pick, userName } from "@/lib/i18n-data";

export type StageState = "done" | "current" | "upcoming" | "rejected" | "skipped";
export type Stage = {
  id: string;
  label: string;
  state: StageState;
  at?: Date | null;
  who?: string | null;
  comment?: string | null;
  signed?: string | null;
  kind: string;
};

const VISIBLE: WorkflowNode["type"][] = ["approval", "create_case", "generate_document", "schedule_meeting", "end"];

/** Main path through the graph: approved / true branches, or the branch actually taken. */
function mainPath(graph: WorkflowGraph, taken: Map<string, string | null>): WorkflowNode[] {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const start = graph.nodes.find((n) => n.type === "start");
  const out: WorkflowNode[] = [];
  const seen = new Set<string>();
  let cur = start;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    const edges = graph.edges.filter((e) => e.source === cur!.id);
    if (!edges.length) break;
    const handle = taken.get(cur.id);
    const preferred =
      (handle !== undefined && handle !== null ? edges.find((e) => e.sourceHandle === handle) : undefined) ??
      edges.find((e) => e.sourceHandle === "approved" || e.sourceHandle === "true") ??
      edges.find((e) => !e.sourceHandle) ??
      edges[0];
    cur = nodes.get(preferred.target);
  }
  return out;
}

export async function requestStages(ctx: Ctx, request: { id: string; status: string; submittedAt: Date; completedAt: Date | null; requesterId: string }): Promise<Stage[]> {
  const { db, locale } = ctx;
  const run = await db.workflowRun.findFirst({
    where: { requestId: request.id },
    include: { version: true, steps: true },
    orderBy: { startedAt: "asc" },
  });
  const submitted: Stage = { id: "submitted", kind: "submitted", label: locale === "ar" ? "تم تقديم الطلب" : "Request submitted", state: "done", at: request.submittedAt };
  if (!run) {
    const finished = ["COMPLETED", "REJECTED", "CANCELLED"].includes(request.status);
    return [
      submitted,
      { id: "review", kind: "status", label: locale === "ar" ? "المراجعة" : "Review", state: finished ? "done" : "current" },
      {
        id: "end",
        kind: "end",
        label: request.status === "REJECTED" ? (locale === "ar" ? "لم تتم الموافقة" : "Not approved") : locale === "ar" ? "مكتمل" : "Completed",
        state: request.status === "REJECTED" ? "rejected" : finished ? "done" : "upcoming",
        at: request.completedAt,
      },
    ];
  }
  const graph = run.version.graph as unknown as WorkflowGraph;
  const stepByNode = new Map(run.steps.map((s) => [s.nodeId, s]));
  const taken = new Map<string, string | null>(run.steps.map((s) => [s.nodeId, ((s.output ?? {}) as { handle?: string | null }).handle ?? null]));
  const path = mainPath(graph, taken).filter((n) => VISIBLE.includes(n.type));

  const approvals = await db.approvalRequest.findMany({ where: { runId: run.id }, include: { assignees: { orderBy: { order: "asc" } } } });
  const memberIds = approvals.flatMap((a) => a.assignees.map((x) => x.membershipId).filter(Boolean)) as string[];
  const members = memberIds.length ? await db.membership.findMany({ where: { id: { in: memberIds } }, include: { user: true } }) : [];
  const nameOf = (id: string | null) => {
    const m = members.find((x) => x.id === id);
    return m ? userName(m.user, locale) : null;
  };

  const stages: Stage[] = [submitted];
  const rejectedSeen = request.status === "REJECTED";
  let blocked = false;
  for (const node of path) {
    const step = stepByNode.get(node.id);
    const label = pick(locale, node.data.label.en, node.data.label.ar);
    if (node.type === "approval") {
      const ap = approvals.find((a) => a.nodeId === node.id);
      if (ap) {
        for (const a of ap.assignees) {
          if (a.status === "CANCELLED" && !a.decidedAt) continue;
          const state: StageState = a.status === "APPROVED" ? "done" : a.status === "REJECTED" ? "rejected" : a.status === "PENDING" ? "current" : "upcoming";
          stages.push({
            id: a.id,
            kind: "approval",
            label: pick(locale, a.labelEn, a.labelAr),
            state,
            at: a.decidedAt,
            who: nameOf(a.membershipId),
            comment: a.comment,
            signed: a.signatureName,
          });
          if (state === "current" || state === "rejected") blocked = true;
        }
        continue;
      }
      // Not reached yet: show the configured approvers as upcoming.
      for (const [i, cfg] of (node.data.approvers ?? []).entries()) {
        stages.push({ id: `${node.id}-${i}`, kind: "approval", label: pick(locale, cfg.label.en, cfg.label.ar), state: rejectedSeen ? "skipped" : "upcoming" });
      }
      continue;
    }
    if (node.type === "end") {
      const done = request.status === "COMPLETED";
      stages.push({
        id: node.id,
        kind: "end",
        label: request.status === "REJECTED" ? (locale === "ar" ? "لم تتم الموافقة" : "Not approved") : label,
        state: request.status === "REJECTED" ? "rejected" : done ? "done" : blocked ? "upcoming" : "upcoming",
        at: done || request.status === "REJECTED" ? request.completedAt : null,
      });
      continue;
    }
    const state: StageState = step?.status === "COMPLETED" ? "done" : step?.status === "WAITING" || step?.status === "RUNNING" ? "current" : rejectedSeen ? "skipped" : "upcoming";
    stages.push({ id: node.id, kind: node.type, label, state, at: step?.completedAt ?? null });
  }
  if (request.status === "REJECTED") {
    let hit = false;
    for (const s of stages) {
      if (s.state === "rejected") hit = true;
      else if (hit && s.state !== "done") s.state = "skipped";
    }
  }
  return stages;
}
