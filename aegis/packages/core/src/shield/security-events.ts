import type { Prisma, SecurityEvent, SecurityEventStatus, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import { createIncidentInternal } from "../incidents/service.js";
import type { OrgContext } from "../lib/context.js";
import { notFound, validation } from "../lib/errors.js";
import { pageSchema, skipTake, toPage } from "../lib/pagination.js";
import { assertPermission } from "../orgs/orgs.js";

/**
 * Security events: anything the gateway, Shield, monitoring or integrations consider worth an
 * analyst's attention. Events are triaged or dismissed by analysts, or linked to an incident.
 * Critical events, and bursts of high events from one agent, open an incident automatically
 * (one open incident per agent and type within the window).
 */

export const SECURITY_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const SECURITY_EVENT_STATUSES = ["open", "triaged", "dismissed", "linked"] as const;

const HIGH_BURST_THRESHOLD = 3;
const BURST_WINDOW_MS = 24 * 3600_000;

export const securityEventFilter = pageSchema.extend({
  severity: z.enum(SECURITY_SEVERITIES).optional(),
  status: z.enum(SECURITY_EVENT_STATUSES).optional(),
  type: z.string().max(80).optional(),
  agentId: z.string().uuid().optional(),
  incidentId: z.string().uuid().optional(),
  since: z.coerce.date().optional(),
  q: z.string().max(120).optional(),
});
export type SecurityEventFilter = z.infer<typeof securityEventFilter>;

async function agentsById(db: TenantDb, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map<string, { id: string; slug: string; name: string; status: string }>();
  const rows = await db.agent.findMany({ where: { id: { in: unique } }, select: { id: true, slug: true, name: true, status: true } });
  return new Map(rows.map((r) => [r.id, r]));
}

export async function listSecurityEvents(db: TenantDb, ctx: OrgContext, f: SecurityEventFilter) {
  assertPermission(ctx, "security:read");
  const where: Prisma.SecurityEventWhereInput = {
    orgId: ctx.orgId,
    ...(f.severity ? { severity: f.severity } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.type ? { type: f.type } : {}),
    ...(f.agentId ? { agentId: f.agentId } : {}),
    ...(f.incidentId ? { incidentId: f.incidentId } : {}),
    ...(f.since ? { createdAt: { gte: f.since } } : {}),
    ...(f.q ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { type: { contains: f.q } }] } : {}),
  };
  const [rows, total] = await Promise.all([db.securityEvent.findMany({ where, orderBy: { createdAt: "desc" }, ...skipTake(f), include: { incident: { select: { id: true, number: true, title: true, status: true } } } }), db.securityEvent.count({ where })]);
  const agents = await agentsById(db, rows.map((r) => r.agentId));
  return toPage(rows.map((r) => ({ ...r, agent: r.agentId ? (agents.get(r.agentId) ?? null) : null })), total, f);
}

export async function getSecurityEvent(db: TenantDb, ctx: OrgContext, id: string) {
  assertPermission(ctx, "security:read");
  const ev = await db.securityEvent.findUnique({ where: { id }, include: { incident: { select: { id: true, number: true, title: true, status: true, severity: true } } } });
  if (!ev || ev.orgId !== ctx.orgId) throw notFound("Security event");
  const [agent, request, policyVersion] = await Promise.all([
    ev.agentId ? db.agent.findUnique({ where: { id: ev.agentId }, select: { id: true, slug: true, name: true, status: true, riskTier: true, environment: true } }) : null,
    ev.actionRequestId ? db.actionRequest.findUnique({ where: { id: ev.actionRequestId }, include: { decisions: { orderBy: { createdAt: "desc" }, take: 1 }, receipts: { take: 1 } } }) : null,
    ev.policyVersionId ? db.policyVersion.findUnique({ where: { id: ev.policyVersionId }, include: { policy: { select: { id: true, key: true, name: true } } } }) : null,
  ]);
  const decision = request?.decisions[0] ?? null;
  // Policy versions referenced by the decision, when the event itself did not record one.
  const decisionPolicyVersions = decision && decision.policyVersionIds.length > 0 ? await db.policyVersion.findMany({ where: { id: { in: decision.policyVersionIds } }, select: { id: true, version: true, policy: { select: { key: true, name: true } } } }) : [];
  const evidence = request ? await db.evidenceEvent.findMany({ where: { orgId: ctx.orgId, subjectType: "action_request", subjectId: request.id }, orderBy: { seq: "asc" }, select: { id: true, seq: true, type: true, occurredAt: true, hash: true, payload: true } }) : [];
  return {
    ...ev,
    agent,
    request: request ? { id: request.id, toolKey: request.toolKey, action: request.action, resourceKey: request.resourceKey, status: request.status, correlationId: request.correlationId, justification: request.justification, riskIndicators: request.riskIndicators, createdAt: request.createdAt, receipt: request.receipts[0] ?? null } : null,
    decision: decision ? { id: decision.id, result: decision.result, explanation: decision.explanation, matchedRuleIds: decision.matchedRuleIds, policyVersionIds: decision.policyVersionIds, latencyMs: decision.latencyMs } : null,
    policyVersion: policyVersion ? { id: policyVersion.id, version: policyVersion.version, state: policyVersion.state, policy: policyVersion.policy } : null,
    decisionPolicyVersions,
    evidence: evidence.map((e) => ({ ...e, seq: e.seq.toString() })),
  };
}

export const triageSchema = z.object({ status: z.enum(["triaged", "dismissed"]), note: z.string().max(2000).default("") }).strict();
export type TriageInput = z.infer<typeof triageSchema>;

export async function triageSecurityEvent(db: TenantDb, ctx: OrgContext, id: string, input: TriageInput) {
  assertPermission(ctx, "security:write");
  const ev = await db.securityEvent.findUnique({ where: { id } });
  if (!ev || ev.orgId !== ctx.orgId) throw notFound("Security event");
  if (ev.status === "linked") throw validation("Linked events are managed through their incident");
  if (input.status === "dismissed" && input.note.trim().length < 2) throw validation("Dismissing an event requires a note");
  const detail = { ...((ev.detail ?? {}) as Record<string, unknown>), triage: { status: input.status, note: input.note.trim(), by: ctx.actor.id, at: (ctx.now ?? new Date()).toISOString() } };
  const updated = await db.securityEvent.update({ where: { id }, data: { status: input.status as SecurityEventStatus, detail: detail as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: `security_event.${input.status}`, subjectType: "security_event", subjectId: id, payload: { type: ev.type, severity: ev.severity, from: ev.status, note: input.note.trim() } });
  return updated;
}

export interface CreateSecurityEventInput {
  type: string;
  severity: (typeof SECURITY_SEVERITIES)[number];
  title: string;
  agentId?: string | null;
  actionRequestId?: string | null;
  policyVersionId?: string | null;
  detail?: Record<string, unknown>;
  /** Set false to skip automatic incident escalation (seed and tests). */
  escalate?: boolean;
}

/**
 * Creates a security event and escalates when warranted:
 * - severity critical: always linked to an incident
 * - severity high: linked when the same agent has >= 3 high events within 24 hours
 * Dedupe: one non-resolved incident per (agent, type) window; new events join it.
 * Titles must not contain personal data; callers pass class keys and tool keys, never values.
 */
export async function createSecurityEvent(db: TenantDb, ctx: OrgContext, input: CreateSecurityEventInput): Promise<{ event: SecurityEvent; incidentId: string | null; incidentCreated: boolean }> {
  const now = ctx.now ?? new Date();
  const event = await db.securityEvent.create({ data: { orgId: ctx.orgId, type: input.type, severity: input.severity, title: input.title.slice(0, 200), agentId: input.agentId ?? null, actionRequestId: input.actionRequestId ?? null, policyVersionId: input.policyVersionId ?? null, detail: (input.detail ?? {}) as Prisma.InputJsonValue, createdAt: now } });
  await appendEvidence(db, ctx, { type: "security_event.created", subjectType: "security_event", subjectId: event.id, payload: { type: event.type, severity: event.severity, agentId: event.agentId, actionRequestId: event.actionRequestId } });
  if (input.escalate === false) return { event, incidentId: null, incidentCreated: false };

  let shouldEscalate = input.severity === "critical";
  let reason = "critical security event";
  if (!shouldEscalate && input.severity === "high" && input.agentId) {
    const highCount = await db.securityEvent.count({ where: { orgId: ctx.orgId, agentId: input.agentId, severity: "high", createdAt: { gte: new Date(now.getTime() - BURST_WINDOW_MS), lte: now } } });
    if (highCount >= HIGH_BURST_THRESHOLD) {
      shouldEscalate = true;
      reason = `${highCount} high severity events from one agent in 24 hours`;
    }
  }
  if (!shouldEscalate) return { event, incidentId: null, incidentCreated: false };

  // Dedupe: an unresolved incident for the same agent and event type created inside the window.
  const existing = await db.incident.findFirst({
    where: { orgId: ctx.orgId, status: { not: "resolved" }, createdAt: { gte: new Date(now.getTime() - BURST_WINDOW_MS) }, ...(input.agentId ? { agentIds: { has: input.agentId } } : {}), securityEvents: { some: { type: input.type } } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    await db.securityEvent.update({ where: { id: event.id }, data: { incidentId: existing.id, status: "linked" } });
    await db.incidentEvent.create({ data: { orgId: ctx.orgId, incidentId: existing.id, type: "security_event_linked", actorId: null, note: `Auto-linked: ${reason}`, securityEventId: event.id, createdAt: now } });
    await db.incident.update({ where: { id: existing.id }, data: { updatedAt: now } });
    await appendEvidence(db, ctx, { type: "incident.security_event_linked", subjectType: "incident", subjectId: existing.id, payload: { number: existing.number, securityEventId: event.id, eventType: event.type, severity: event.severity, auto: true } });
    return { event: { ...event, incidentId: existing.id, status: "linked" }, incidentId: existing.id, incidentCreated: false };
  }
  const incident = await createIncidentInternal(db, ctx, { title: `Auto-opened: ${input.title.slice(0, 150)}`, severity: input.severity, summary: `Opened automatically: ${reason}.`, agentIds: input.agentId ? [input.agentId] : [], securityEventIds: [event.id], assigneeId: null }, { source: "security event escalation" });
  return { event: { ...event, incidentId: incident.id, status: "linked" }, incidentId: incident.id, incidentCreated: true };
}

export interface SecurityEventWindowStats {
  total: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
}

export async function securityEventStats(db: TenantDb, ctx: OrgContext): Promise<{ windows: Record<"24h" | "7d" | "30d", SecurityEventWindowStats>; open: number; generatedAt: string }> {
  assertPermission(ctx, "security:read");
  const now = ctx.now ?? new Date();
  const windows = { "24h": 86400_000, "7d": 7 * 86400_000, "30d": 30 * 86400_000 } as const;
  const out = {} as Record<"24h" | "7d" | "30d", SecurityEventWindowStats>;
  for (const [label, ms] of Object.entries(windows) as ["24h" | "7d" | "30d", number][]) {
    const since = new Date(now.getTime() - ms);
    const where = { orgId: ctx.orgId, createdAt: { gte: since, lte: now } };
    const [bySev, byType, byStatus] = await Promise.all([
      db.securityEvent.groupBy({ by: ["severity"], where, _count: { _all: true } }),
      db.securityEvent.groupBy({ by: ["type"], where, _count: { _all: true } }),
      db.securityEvent.groupBy({ by: ["status"], where, _count: { _all: true } }),
    ]);
    const sev: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const r of bySev) sev[r.severity] = r._count._all;
    const typ: Record<string, number> = {};
    for (const r of byType) typ[r.type] = r._count._all;
    const st: Record<string, number> = { open: 0, triaged: 0, dismissed: 0, linked: 0 };
    for (const r of byStatus) st[r.status] = r._count._all;
    out[label] = { total: bySev.reduce((a, r) => a + r._count._all, 0), bySeverity: sev, byType: typ, byStatus: st };
  }
  const open = await db.securityEvent.count({ where: { orgId: ctx.orgId, status: "open" } });
  return { windows: out, open, generatedAt: now.toISOString() };
}
