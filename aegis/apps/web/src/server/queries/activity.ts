import "server-only";
import type { TenantDb } from "@aegis/db";
import type { Prisma } from "@aegis/db";
import { keyParams, outcomeGroup, type OutcomeGroup } from "@/lib/describe-request";

export const OUTCOME_FILTERS = ["allowed", "approval", "blocked", "unresolved"] as const;
export type OutcomeFilter = (typeof OUTCOME_FILTERS)[number];

export interface ActivityRow {
  id: string;
  status: string;
  group: OutcomeGroup;
  hasApproval: boolean;
  approvalId: string | null;
  agentId: string;
  agentName: string;
  toolKey: string;
  action: string;
  params: unknown;
  amount: number | null;
  currency: string | null;
  justification: string;
  reference: string | null;
  createdAt: string;
}

function outcomeWhere(f: OutcomeFilter | null): Prisma.ActionRequestWhereInput {
  switch (f) {
    case "allowed":
      return { status: { in: ["allowed", "executed", "executing"] }, approvals: { none: {} } };
    case "approval":
      return { OR: [{ status: { in: ["pending_approval", "approved"] } }, { status: { in: ["executed", "executing"] }, approvals: { some: {} } }] };
    case "blocked":
      return { status: { in: ["denied", "rejected", "expired"] } };
    case "unresolved":
      return { status: { in: ["failed", "unknown", "evaluating"] } };
    default:
      return {};
  }
}

/** Recent action requests across agents, readable by a non-specialist, with optional outcome and agent filters. */
export async function loadActivity(db: TenantDb, orgId: string, f: { outcome: OutcomeFilter | null; agentId: string | null; limit: number }) {
  const where: Prisma.ActionRequestWhereInput = { orgId, ...outcomeWhere(f.outcome), ...(f.agentId ? { agentId: f.agentId } : {}) };
  const [rows, total, agents] = await Promise.all([
    db.actionRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: f.limit, select: { id: true, status: true, toolKey: true, action: true, params: true, justification: true, createdAt: true, agent: { select: { id: true, name: true } }, approvals: { select: { id: true }, take: 1 }, receipts: { orderBy: { createdAt: "desc" }, take: 1, select: { downstreamReference: true } } } }),
    db.actionRequest.count({ where }),
    db.agent.findMany({ where: { isLab: false, orgId, status: { not: "archived" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const now = Date.now();
  const items: ActivityRow[] = rows.map((r) => {
    const kp = keyParams(r.params);
    const hasApproval = r.approvals.length > 0;
    return { id: r.id, status: r.status, group: outcomeGroup(r.status, hasApproval, r.createdAt, now), hasApproval, approvalId: r.approvals[0]?.id ?? null, agentId: r.agent.id, agentName: r.agent.name, toolKey: r.toolKey, action: r.action, params: r.params, amount: kp.amount, currency: kp.currency, justification: r.justification, reference: r.receipts[0]?.downstreamReference ?? null, createdAt: r.createdAt.toISOString() };
  });
  return { items, total, agents };
}
