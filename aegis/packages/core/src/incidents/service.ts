import type { Incident, IncidentStatus, Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { conflict, notFound, validation } from "../lib/errors.js";
import { pageSchema, skipTake, toPage } from "../lib/pagination.js";
import { notifyUsers, userIdsWithPermission } from "../notify/notifications.js";
import { assertPermission } from "../orgs/orgs.js";

/**
 * Security incidents: a numbered case per organization that groups security events, notes and
 * status changes. Every change writes an incident event and an evidence event. Numbers are
 * allocated inside the tenant transaction under an advisory lock; the unique constraint on
 * (org_id, number) is the final guard.
 */

export const INCIDENT_STATUSES = ["open", "investigating", "contained", "resolved"] as const;
export const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"] as const;

const STATUS_RANK: Record<IncidentStatus, number> = { open: 0, investigating: 1, contained: 2, resolved: 3 };

export const createIncidentSchema = z
  .object({
    title: z.string().min(3).max(200),
    severity: z.enum(INCIDENT_SEVERITIES),
    summary: z.string().max(5000).default(""),
    assigneeId: z.string().uuid().nullable().optional(),
    agentIds: z.array(z.string().uuid()).max(50).default([]),
    securityEventIds: z.array(z.string().uuid()).max(100).default([]),
  })
  .strict();
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;

async function nextIncidentNumber(db: TenantDb, orgId: string): Promise<number> {
  await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('incident:' || $1))`, orgId);
  const agg = await db.incident.aggregate({ where: { orgId }, _max: { number: true } });
  return (agg._max.number ?? 0) + 1;
}

/**
 * Creates an incident without a permission check. Used by createIncident (after the check) and by
 * the security event escalation path, which runs under whatever context raised the event.
 */
export async function createIncidentInternal(db: TenantDb, ctx: OrgContext, input: CreateIncidentInput, opts: { source?: string } = {}): Promise<Incident> {
  const now = ctx.now ?? new Date();
  const number = await nextIncidentNumber(db, ctx.orgId);
  let incident: Incident;
  try {
    incident = await db.incident.create({ data: { orgId: ctx.orgId, number, title: input.title.trim(), severity: input.severity, status: "open", summary: input.summary, assigneeId: input.assigneeId ?? null, agentIds: [...new Set(input.agentIds)], createdAt: now, updatedAt: now } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw conflict("Incident number collision; retry");
    throw e;
  }
  await db.incidentEvent.create({ data: { orgId: ctx.orgId, incidentId: incident.id, type: "created", actorId: ctx.actor.type === "user" ? ctx.actor.id : null, note: opts.source ? `Created by ${opts.source}` : "", createdAt: now } });
  for (const id of input.securityEventIds) await linkSecurityEventInternal(db, ctx, incident, id, "linked at creation");
  await appendEvidence(db, ctx, { type: "incident.created", subjectType: "incident", subjectId: incident.id, payload: { number, severity: incident.severity, agentIds: incident.agentIds, securityEventIds: input.securityEventIds, source: opts.source ?? "manual" } });
  const analysts = await userIdsWithPermission(db, ctx, "security:write");
  await notifyUsers(db, ctx, { userIds: analysts, type: "incident.created", title: `Incident #${number}: ${incident.title}`, body: `Severity ${incident.severity}`, link: `/incidents/${incident.id}`, idempotencyKey: `incident.created:${incident.id}` });
  return incident;
}

export async function createIncident(db: TenantDb, ctx: OrgContext, input: CreateIncidentInput): Promise<Incident> {
  assertPermission(ctx, "security:write");
  return createIncidentInternal(db, ctx, input, { source: "manual" });
}

export const incidentListFilter = pageSchema.extend({
  status: z.enum(INCIDENT_STATUSES).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  assigneeId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  q: z.string().max(120).optional(),
});
export type IncidentListFilter = z.infer<typeof incidentListFilter>;

export async function listIncidents(db: TenantDb, ctx: OrgContext, f: IncidentListFilter) {
  assertPermission(ctx, "security:read");
  const where: Prisma.IncidentWhereInput = {
    orgId: ctx.orgId,
    ...(f.status ? { status: f.status } : {}),
    ...(f.severity ? { severity: f.severity } : {}),
    ...(f.assigneeId ? { assigneeId: f.assigneeId } : {}),
    ...(f.agentId ? { agentIds: { has: f.agentId } } : {}),
    ...(f.q ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { summary: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
  const [items, total] = await Promise.all([
    db.incident.findMany({ where, orderBy: [{ status: "asc" }, { createdAt: "desc" }], ...skipTake(f), include: { _count: { select: { securityEvents: true, events: true } } } }),
    db.incident.count({ where }),
  ]);
  return toPage(items, total, f);
}

export async function getIncident(db: TenantDb, ctx: OrgContext, id: string) {
  assertPermission(ctx, "security:read");
  const incident = await db.incident.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: "asc" } }, securityEvents: { orderBy: { createdAt: "asc" } } } });
  if (!incident || incident.orgId !== ctx.orgId) throw notFound("Incident");
  const agentIds = [...new Set([...incident.agentIds, ...incident.securityEvents.map((e) => e.agentId).filter((x): x is string => !!x)])];
  const agents = agentIds.length ? await db.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, slug: true, name: true, status: true } }) : [];
  const requestIds = incident.securityEvents.map((e) => e.actionRequestId).filter((x): x is string => !!x);
  const requests = requestIds.length ? await db.actionRequest.findMany({ where: { id: { in: requestIds } }, select: { id: true, toolKey: true, action: true, status: true, correlationId: true, createdAt: true, agentId: true } }) : [];
  const evidence = requestIds.length ? await db.evidenceEvent.findMany({ where: { orgId: ctx.orgId, subjectType: "action_request", subjectId: { in: requestIds } }, orderBy: { seq: "asc" }, select: { id: true, seq: true, type: true, subjectId: true, occurredAt: true, hash: true, payload: true } }) : [];
  const incidentEvidence = await db.evidenceEvent.findMany({ where: { orgId: ctx.orgId, subjectType: "incident", subjectId: id }, orderBy: { seq: "asc" }, select: { id: true, seq: true, type: true, occurredAt: true, hash: true } });

  type TimelineItem = { at: Date; kind: "incident_event" | "security_event" | "evidence"; id: string; type: string; title: string; detail: Record<string, unknown> };
  const timeline: TimelineItem[] = [
    ...incident.events.map((e) => ({ at: e.createdAt, kind: "incident_event" as const, id: e.id, type: e.type, title: e.note || e.type.replace(/_/g, " "), detail: { actorId: e.actorId, securityEventId: e.securityEventId } })),
    ...incident.securityEvents.map((e) => ({ at: e.createdAt, kind: "security_event" as const, id: e.id, type: e.type, title: e.title, detail: { severity: e.severity, status: e.status, agentId: e.agentId, actionRequestId: e.actionRequestId } })),
    ...evidence.map((e) => ({ at: e.occurredAt, kind: "evidence" as const, id: e.id, type: e.type, title: e.type.replace(/[._]/g, " "), detail: { seq: e.seq.toString(), actionRequestId: e.subjectId, hash: e.hash } })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return { ...incident, agents, requests, evidence: evidence.map((e) => ({ ...e, seq: e.seq.toString() })), incidentEvidence: incidentEvidence.map((e) => ({ ...e, seq: e.seq.toString() })), timeline };
}

async function loadIncident(db: TenantDb, ctx: OrgContext, id: string): Promise<Incident> {
  const row = await db.incident.findUnique({ where: { id } });
  if (!row || row.orgId !== ctx.orgId) throw notFound("Incident");
  return row;
}

async function recordEvent(db: TenantDb, ctx: OrgContext, incidentId: string, type: string, note = "", securityEventId: string | null = null) {
  const now = ctx.now ?? new Date();
  await db.incidentEvent.create({ data: { orgId: ctx.orgId, incidentId, type, actorId: ctx.actor.type === "user" ? ctx.actor.id : null, note, securityEventId, createdAt: now } });
  await db.incident.update({ where: { id: incidentId }, data: { updatedAt: now } });
}

export async function assignIncident(db: TenantDb, ctx: OrgContext, id: string, assigneeId: string | null, note = "") {
  assertPermission(ctx, "security:write");
  const incident = await loadIncident(db, ctx, id);
  if (assigneeId) {
    const member = await db.membership.findFirst({ where: { orgId: ctx.orgId, userId: assigneeId, status: "active" } });
    if (!member) throw validation("Assignee must be an active member of the organization");
  }
  const updated = await db.incident.update({ where: { id }, data: { assigneeId, updatedAt: ctx.now ?? new Date() } });
  await recordEvent(db, ctx, id, assigneeId ? "assigned" : "unassigned", note);
  await appendEvidence(db, ctx, { type: "incident.assigned", subjectType: "incident", subjectId: id, payload: { number: incident.number, from: incident.assigneeId, to: assigneeId } });
  return updated;
}

export async function addIncidentNote(db: TenantDb, ctx: OrgContext, id: string, note: string) {
  assertPermission(ctx, "security:write");
  const text = note.trim();
  if (text.length < 2) throw validation("Note is too short");
  if (text.length > 5000) throw validation("Note is too long");
  const incident = await loadIncident(db, ctx, id);
  await recordEvent(db, ctx, id, "note", text);
  await appendEvidence(db, ctx, { type: "incident.note_added", subjectType: "incident", subjectId: id, payload: { number: incident.number, length: text.length } });
  return getIncident(db, ctx, id);
}

async function linkSecurityEventInternal(db: TenantDb, ctx: OrgContext, incident: Incident, securityEventId: string, note: string) {
  const ev = await db.securityEvent.findUnique({ where: { id: securityEventId } });
  if (!ev || ev.orgId !== ctx.orgId) throw notFound("Security event");
  if (ev.incidentId === incident.id) return ev;
  if (ev.incidentId && ev.incidentId !== incident.id) throw conflict("Security event is already linked to another incident");
  const updated = await db.securityEvent.update({ where: { id: securityEventId }, data: { incidentId: incident.id, status: "linked" } });
  const agentIds = ev.agentId && !incident.agentIds.includes(ev.agentId) ? [...incident.agentIds, ev.agentId] : incident.agentIds;
  if (agentIds !== incident.agentIds) {
    await db.incident.update({ where: { id: incident.id }, data: { agentIds } });
    incident.agentIds = agentIds;
  }
  await recordEvent(db, ctx, incident.id, "security_event_linked", note, securityEventId);
  return updated;
}

export async function linkSecurityEvent(db: TenantDb, ctx: OrgContext, incidentId: string, securityEventId: string, note = "") {
  assertPermission(ctx, "security:write");
  const incident = await loadIncident(db, ctx, incidentId);
  if (incident.status === "resolved") throw validation("Reopen the incident before linking more events");
  const ev = await linkSecurityEventInternal(db, ctx, incident, securityEventId, note);
  await appendEvidence(db, ctx, { type: "incident.security_event_linked", subjectType: "incident", subjectId: incidentId, payload: { number: incident.number, securityEventId, eventType: ev.type, severity: ev.severity } });
  return ev;
}

export const setIncidentStatusSchema = z.object({ status: z.enum(INCIDENT_STATUSES), note: z.string().max(5000).default(""), summary: z.string().max(5000).optional() }).strict();
export type SetIncidentStatusInput = z.infer<typeof setIncidentStatusSchema>;

/**
 * Forward moves are allowed (open -> investigating -> contained -> resolved, skipping is fine).
 * Resolving requires a summary (existing or supplied). The only backward move is resolved ->
 * investigating (reopen) and it requires a note. Severity is never changed here.
 */
export async function setIncidentStatus(db: TenantDb, ctx: OrgContext, id: string, input: SetIncidentStatusInput) {
  assertPermission(ctx, "security:write");
  const incident = await loadIncident(db, ctx, id);
  const from = incident.status;
  const to = input.status;
  if (from === to) throw validation(`Incident is already ${to}`);
  const forward = STATUS_RANK[to] > STATUS_RANK[from];
  const reopen = from === "resolved" && to === "investigating";
  if (!forward && !reopen) throw validation(`Cannot move an incident from ${from} to ${to}`);
  if (reopen && input.note.trim().length < 2) throw validation("Reopening requires a note");
  const summary = input.summary?.trim() ?? incident.summary;
  if (to === "resolved" && summary.length < 10) throw validation("Resolving requires a summary of at least 10 characters");
  const now = ctx.now ?? new Date();
  const updated = await db.incident.update({ where: { id }, data: { status: to, summary, resolvedAt: to === "resolved" ? now : reopen ? null : incident.resolvedAt, updatedAt: now } });
  await recordEvent(db, ctx, id, reopen ? "reopened" : `status_${to}`, input.note.trim());
  await appendEvidence(db, ctx, { type: "incident.status_changed", subjectType: "incident", subjectId: id, payload: { number: incident.number, from, to, summaryUpdated: input.summary !== undefined } });
  return updated;
}

export async function incidentStats(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "security:read");
  const rows = await db.incident.groupBy({ by: ["status", "severity"], where: { orgId: ctx.orgId }, _count: { _all: true } });
  const byStatus: Record<string, number> = { open: 0, investigating: 0, contained: 0, resolved: 0 };
  const bySeverity: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + r._count._all;
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + r._count._all;
  }
  return { byStatus, bySeverity, openTotal: byStatus.open! + byStatus.investigating! + byStatus.contained! };
}
