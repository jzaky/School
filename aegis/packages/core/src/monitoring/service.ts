import type { Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { notFound, validation } from "../lib/errors.js";
import { notifyUsers, userIdsWithPermission } from "../notify/notifications.js";
import { assertPermission } from "../orgs/orgs.js";
import { DEFAULT_RULES, evaluateRule, ruleDefinitionSchema, type RuleDefinition } from "./rules.js";
import { applyAutoResponses, type NewAlert } from "../governance/continuous.js";

export async function ensureDefaultMonitoringRules(db: TenantDb, ctx: OrgContext) {
  for (const r of DEFAULT_RULES) {
    await db.monitoringRule.upsert({ where: { orgId_key: { orgId: ctx.orgId, key: r.key } }, create: { orgId: ctx.orgId, key: r.key, name: r.name, description: r.description, severity: r.severity, definition: r.definition as Prisma.InputJsonValue, enabled: true }, update: {} });
  }
}

export async function listMonitoringRules(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "monitoring:read");
  const rules = await db.monitoringRule.findMany({ where: { orgId: ctx.orgId }, orderBy: { key: "asc" } });
  const counts = await db.alert.groupBy({ by: ["ruleId", "status"], where: { orgId: ctx.orgId }, _count: { _all: true } });
  return rules.map((r) => ({ ...r, openAlerts: counts.filter((c) => c.ruleId === r.id && c.status === "open").reduce((a, c) => a + c._count._all, 0), totalAlerts: counts.filter((c) => c.ruleId === r.id).reduce((a, c) => a + c._count._all, 0) }));
}

export const ruleInputSchema = z.object({ key: z.string().regex(/^[A-Z]{2,4}-\d{3}$/, "Use a key like RM-012"), name: z.string().min(3).max(120), description: z.string().max(500).default(""), severity: z.enum(["low", "medium", "high", "critical"]), definition: ruleDefinitionSchema, enabled: z.boolean().default(true) });

export async function createMonitoringRule(db: TenantDb, ctx: OrgContext, input: z.infer<typeof ruleInputSchema>) {
  assertPermission(ctx, "monitoring:write");
  const row = await db.monitoringRule.create({ data: { orgId: ctx.orgId, ...input, definition: input.definition as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "monitoring.rule_created", subjectType: "monitoring_rule", subjectId: row.id, payload: { key: row.key, definition: input.definition } });
  return row;
}

export async function updateMonitoringRule(db: TenantDb, ctx: OrgContext, ruleId: string, patch: Partial<Omit<z.infer<typeof ruleInputSchema>, "key">>) {
  assertPermission(ctx, "monitoring:write");
  const existing = await db.monitoringRule.findUnique({ where: { id: ruleId } });
  if (!existing) throw notFound("Monitoring rule");
  if (patch.definition) {
    const current = existing.definition as RuleDefinition;
    if (patch.definition.type !== current.type) throw validation("The rule type cannot change; create a new rule instead");
  }
  const row = await db.monitoringRule.update({ where: { id: ruleId }, data: { ...patch, ...(patch.definition ? { definition: patch.definition as Prisma.InputJsonValue } : {}) } });
  await appendEvidence(db, ctx, { type: "monitoring.rule_updated", subjectType: "monitoring_rule", subjectId: ruleId, payload: { key: row.key, fields: Object.keys(patch), definition: patch.definition ?? undefined } });
  return row;
}

export async function deleteMonitoringRule(db: TenantDb, ctx: OrgContext, ruleId: string) {
  assertPermission(ctx, "monitoring:write");
  const existing = await db.monitoringRule.findUnique({ where: { id: ruleId } });
  if (!existing) throw notFound("Monitoring rule");
  if (DEFAULT_RULES.some((d) => d.key === existing.key)) throw validation("Built-in rules can be disabled but not deleted");
  await db.alert.updateMany({ where: { ruleId }, data: { ruleId: null } });
  await db.monitoringRule.delete({ where: { id: ruleId } });
  await appendEvidence(db, ctx, { type: "monitoring.rule_deleted", subjectType: "monitoring_rule", subjectId: ruleId, payload: { key: existing.key } });
}

/** Runs every enabled rule once. Idempotent: alerts dedupe on (org, dedupeKey). Returns new alert count. */
export async function runMonitoring(db: TenantDb, ctx: OrgContext, now = new Date()): Promise<{ evaluated: number; newAlerts: number; autoResponses: number; errors: string[] }> {
  const rules = await db.monitoringRule.findMany({ where: { orgId: ctx.orgId, enabled: true } });
  let newAlerts = 0;
  const errors: string[] = [];
  const created: NewAlert[] = [];
  // Attack Simulation Lab agents exist only to be refused; their traffic never raises monitoring alerts.
  const labAgents = new Set((await db.agent.findMany({ where: { isLab: true }, select: { id: true } })).map((a) => a.id));
  for (const rule of rules) {
    const parsed = ruleDefinitionSchema.safeParse(rule.definition);
    if (!parsed.success) {
      errors.push(`${rule.key}: invalid definition`);
      continue;
    }
    try {
      const findings = (await evaluateRule(db, ctx.orgId, parsed.data, now)).filter((f) => !f.agentId || !labAgents.has(f.agentId));
      for (const f of findings) {
        const existing = await db.alert.findUnique({ where: { orgId_dedupeKey: { orgId: ctx.orgId, dedupeKey: f.dedupeKey } } });
        if (existing) continue;
        const alert = await db.alert.create({ data: { orgId: ctx.orgId, ruleId: rule.id, severity: rule.severity, title: `${rule.key}: ${f.title}`, detail: { ...f.detail, rule: rule.key, definition: parsed.data } as Prisma.InputJsonValue, agentId: f.agentId, dedupeKey: f.dedupeKey, createdAt: now, updatedAt: now } });
        created.push({ id: alert.id, ruleKey: rule.key, title: alert.title, severity: alert.severity, agentId: alert.agentId, detail: alert.detail as Record<string, unknown> });
        newAlerts++;
        await appendEvidence(db, ctx, { type: "monitoring.alert_raised", subjectType: "alert", subjectId: alert.id, payload: { rule: rule.key, severity: rule.severity, agentId: f.agentId, detail: f.detail } });
      }
      await db.monitoringRule.update({ where: { id: rule.id }, data: { lastRunAt: now } });
    } catch (e) {
      errors.push(`${rule.key}: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  if (created.length) {
    const recipients = await userIdsWithPermission(db, ctx, "monitoring:read");
    for (const a of created.filter((c) => c.severity === "high" || c.severity === "critical")) {
      await notifyUsers(db, ctx, { userIds: recipients, type: "alert.raised", title: a.title, link: `/alerts?focus=${a.id}`, idempotencyKey: `alert.raised:${a.id}` });
    }
  }
  // Continuous governance: the organization may have delegated a containment response per rule (see governance/continuous.ts).
  let autoResponses = 0;
  if (created.length) {
    try {
      autoResponses = (await applyAutoResponses(db, ctx, created, now)).filter((r) => r.outcome === "applied").length;
    } catch (e) {
      errors.push(`auto-responses: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  return { evaluated: rules.length, newAlerts, autoResponses, errors };
}

export const alertFilter = z.object({ status: z.enum(["open", "acknowledged", "resolved", "all"]).default("open"), severity: z.string().optional(), agentId: z.string().uuid().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) });

export async function listAlerts(db: TenantDb, ctx: OrgContext, f: z.infer<typeof alertFilter>) {
  assertPermission(ctx, "monitoring:read");
  const where: Prisma.AlertWhereInput = { orgId: ctx.orgId, ...(f.status === "all" ? {} : { status: f.status }), ...(f.severity ? { severity: f.severity } : {}), ...(f.agentId ? { agentId: f.agentId } : {}) };
  const [items, total] = await Promise.all([db.alert.findMany({ where, orderBy: [{ status: "asc" }, { createdAt: "desc" }], skip: (f.page - 1) * f.pageSize, take: f.pageSize, include: { rule: { select: { key: true, name: true, description: true } } } }), db.alert.count({ where })]);
  const agentIds = [...new Set(items.map((a) => a.agentId).filter((x): x is string => !!x))];
  const agents = agentIds.length ? await db.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true, slug: true } }) : [];
  const byId = new Map(agents.map((a) => [a.id, a]));
  return { items: items.map((a) => ({ ...a, agent: a.agentId ? byId.get(a.agentId) ?? null : null })), total, page: f.page, pageSize: f.pageSize, pageCount: Math.max(1, Math.ceil(total / f.pageSize)) };
}

export async function acknowledgeAlert(db: TenantDb, ctx: OrgContext, alertId: string) {
  assertPermission(ctx, "monitoring:write");
  const a = await db.alert.update({ where: { id: alertId }, data: { status: "acknowledged", acknowledgedBy: ctx.actor.id } });
  await appendEvidence(db, ctx, { type: "monitoring.alert_acknowledged", subjectType: "alert", subjectId: alertId, payload: {} });
  return a;
}

export async function resolveAlert(db: TenantDb, ctx: OrgContext, alertId: string, note: string) {
  assertPermission(ctx, "monitoring:write");
  if (note.trim().length < 3) throw validation("A resolution note is required");
  const a = await db.alert.findUnique({ where: { id: alertId } });
  if (!a) throw notFound("Alert");
  const row = await db.alert.update({ where: { id: alertId }, data: { status: "resolved", resolvedBy: ctx.actor.id, resolvedAt: new Date(), detail: { ...(a.detail as object), resolutionNote: note } as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "monitoring.alert_resolved", subjectType: "alert", subjectId: alertId, payload: { note } });
  return row;
}

export async function alertStats(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "monitoring:read");
  const rows = await db.alert.groupBy({ by: ["severity", "status"], where: { orgId: ctx.orgId }, _count: { _all: true } });
  return rows.map((r) => ({ severity: r.severity, status: r.status, count: r._count._all }));
}
