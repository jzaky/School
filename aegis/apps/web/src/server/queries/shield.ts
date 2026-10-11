import "server-only";
import type { TenantDb } from "@aegis/db";
import { hasPermission } from "@aegis/core";
import { rawPrisma } from "@aegis/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

/** Flattens Next's searchParams into single string values, dropping empties. */
export function flatParams(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(raw)
      .map(([k, v]) => [k, Array.isArray(v) ? v[0] : v] as [string, string | undefined])
      .filter((e): e is [string, string] => e[1] !== undefined && e[1] !== ""),
  );
}

export interface AgentPick {
  id: string;
  slug: string;
  name: string;
  status: string;
}

export async function agentPicks(db: TenantDb, orgId: string): Promise<AgentPick[]> {
  return db.agent.findMany({ where: { orgId }, orderBy: { name: "asc" }, select: { id: true, slug: true, name: true, status: true } });
}

export async function agentNames(db: TenantDb, ids: (string | null | undefined)[]): Promise<Map<string, AgentPick>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  const rows = await db.agent.findMany({ where: { id: { in: unique } }, select: { id: true, slug: true, name: true, status: true } });
  return new Map(rows.map((r) => [r.id, r]));
}

export interface ToolPick {
  key: string;
  name: string;
  riskLevel: string;
}

export async function toolPicks(db: TenantDb, orgId: string): Promise<ToolPick[]> {
  return db.tool.findMany({ where: { orgId }, orderBy: { key: "asc" }, select: { key: true, name: true, riskLevel: true } });
}

export async function resourcePicks(db: TenantDb, orgId: string): Promise<{ key: string; name: string; classification: string }[]> {
  return db.resource.findMany({ where: { orgId }, orderBy: { key: "asc" }, select: { key: true, name: true, classification: true } });
}

export interface IncidentPick {
  id: string;
  number: number;
  title: string;
  status: string;
  severity: string;
}

/** Incidents that can still receive linked events. */
export async function openIncidentPicks(db: TenantDb, orgId: string): Promise<IncidentPick[]> {
  return db.incident.findMany({ where: { orgId, status: { not: "resolved" } }, orderBy: { number: "desc" }, select: { id: true, number: true, title: true, status: true, severity: true } });
}

export interface EventPick {
  id: string;
  type: string;
  severity: string;
  title: string;
  status: string;
  createdAt: Date;
}

/** Security events not yet attached to an incident (open or triaged). */
export async function linkableEventPicks(db: TenantDb, orgId: string, limit = 200): Promise<EventPick[]> {
  return db.securityEvent.findMany({ where: { orgId, incidentId: null, status: { in: ["open", "triaged"] } }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, type: true, severity: true, title: true, status: true, createdAt: true } });
}

export interface AnalystPick {
  userId: string;
  name: string;
  email: string;
  roleName: string;
}

/** Active members whose role carries a permission (assignees, owners). */
export async function membersWithPermission(db: TenantDb, orgId: string, permission: string): Promise<AnalystPick[]> {
  const rows = await db.membership.findMany({ where: { orgId, status: "active" }, include: { role: true } });
  const eligible = rows.filter((m) => hasPermission(m.role.permissions, permission as never));
  if (eligible.length === 0) return [];
  const users = await rawPrisma().user.findMany({ where: { id: { in: eligible.map((m) => m.userId) } }, select: { id: true, name: true, email: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return eligible.map((m) => ({ userId: m.userId, name: byId.get(m.userId)?.name ?? "Unknown user", email: byId.get(m.userId)?.email ?? "", roleName: m.role.name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Mean time to resolve in hours over resolved incidents, or null when none resolved. */
export async function meanTimeToResolveHours(db: TenantDb, orgId: string): Promise<{ hours: number; sample: number } | null> {
  const rows = await db.incident.findMany({ where: { orgId, status: "resolved", resolvedAt: { not: null } }, select: { createdAt: true, resolvedAt: true } });
  if (rows.length === 0) return null;
  const total = rows.reduce((acc, r) => acc + ((r.resolvedAt?.getTime() ?? 0) - r.createdAt.getTime()), 0);
  return { hours: Math.round((total / rows.length / 3600_000) * 10) / 10, sample: rows.length };
}
