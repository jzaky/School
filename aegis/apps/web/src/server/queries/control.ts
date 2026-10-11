import "server-only";
import type { TenantDb } from "@aegis/db";
import { hasPermission } from "@aegis/core";
import { rawPrisma } from "@aegis/db";

export interface AgentOption {
  id: string;
  slug: string;
  name: string;
  status: string;
  teamId: string | null;
  tools: { toolId: string; key: string; name: string }[];
}

/** Agents with their active tool grants, for pickers (assignments, simulation, emergency controls). */
export async function agentOptions(db: TenantDb, orgId: string): Promise<AgentOption[]> {
  const rows = await db.agent.findMany({ where: { orgId }, orderBy: { name: "asc" }, select: { id: true, slug: true, name: true, status: true, teamId: true, tools: { where: { revokedAt: null }, select: { toolId: true, tool: { select: { key: true, name: true } } } } } });
  return rows.map((a) => ({ id: a.id, slug: a.slug, name: a.name, status: a.status, teamId: a.teamId, tools: a.tools.map((t) => ({ toolId: t.toolId, key: t.tool.key, name: t.tool.name })) }));
}

export interface ToolOption {
  id: string;
  key: string;
  name: string;
  integration: string | null;
  riskLevel: string;
}

export async function toolOptions(db: TenantDb, orgId: string): Promise<ToolOption[]> {
  const rows = await db.tool.findMany({ where: { orgId }, orderBy: { key: "asc" }, select: { id: true, key: true, name: true, riskLevel: true, integration: { select: { name: true } } } });
  return rows.map((t) => ({ id: t.id, key: t.key, name: t.name, riskLevel: t.riskLevel, integration: t.integration?.name ?? null }));
}

export async function teamOptions(db: TenantDb, orgId: string) {
  return db.team.findMany({ where: { orgId }, orderBy: { name: "asc" }, select: { id: true, key: true, name: true } });
}

export interface ApproverOption {
  userId: string;
  name: string;
  email: string;
  roleName: string;
}

/** Active members whose role carries approvals:decide (escalation and reassignment targets). */
export async function approverOptions(db: TenantDb, orgId: string): Promise<ApproverOption[]> {
  const rows = await db.membership.findMany({ where: { orgId, status: "active" }, include: { role: true } });
  const eligible = rows.filter((m) => hasPermission(m.role.permissions, "approvals:decide"));
  if (eligible.length === 0) return [];
  const users = await rawPrisma().user.findMany({ where: { id: { in: eligible.map((m) => m.userId) } }, select: { id: true, name: true, email: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return eligible.map((m) => ({ userId: m.userId, name: byId.get(m.userId)?.name ?? "Unknown user", email: byId.get(m.userId)?.email ?? "", roleName: m.role.name })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function pendingApprovalsCount(db: TenantDb, orgId: string): Promise<number> {
  return db.approvalRequest.count({ where: { orgId, status: { in: ["pending", "more_info", "escalated"] } } });
}

export type ActivityFamily = "gateway" | "approval" | "policy" | "agent" | "monitoring" | "security";

export function activityFamily(type: string): ActivityFamily {
  if (type.startsWith("gateway.")) return "gateway";
  if (type.startsWith("approval.")) return "approval";
  if (type.startsWith("policy.")) return "policy";
  if (type.startsWith("agent.") || type.startsWith("tool.")) return "agent";
  if (type.startsWith("monitoring.") || type.startsWith("evidence.") || type.startsWith("report.")) return "monitoring";
  return "security";
}

/** Console link for an evidence subject, when the console has a page for it. */
export function subjectHref(subjectType: string | null | undefined, subjectId: string | null | undefined): string | null {
  if (!subjectId) return null;
  switch (subjectType) {
    case "agent":
      return `/agents/${subjectId}`;
    case "action_request":
      return `/gateway/${subjectId}`;
    case "approval_request":
      return `/approvals/${subjectId}`;
    case "policy":
      return `/policies/${subjectId}`;
    case "integration":
      return `/integrations/${subjectId}`;
    case "alert":
      return `/alerts?focus=${subjectId}`;
    default:
      return null;
  }
}

/** Params that approvers care about, pulled from tool parameters when present. */
export function keyParams(params: unknown): { amount: number | null; currency: string | null; destination: string | null; orderId: string | null; toAccount: string | null } {
  const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
  const amount = typeof p.amount === "number" ? p.amount : typeof p.amount === "string" && p.amount.trim() !== "" && Number.isFinite(Number(p.amount)) ? Number(p.amount) : null;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);
  return { amount, currency: str("currency"), destination: str("destination") ?? str("to") ?? str("url"), orderId: str("orderId"), toAccount: str("toAccount") };
}
