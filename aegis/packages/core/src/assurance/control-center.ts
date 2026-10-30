import type { TenantDb } from "@aegis/db";
import { hasPermission, type Permission } from "../identity/permissions.js";
import type { OrgContext } from "../lib/context.js";
import { assertPermission } from "../orgs/orgs.js";
import { modelGateCheck } from "../governance/models.js";
import { datasetFindings, deletionOverdue } from "../governance/data.js";
import { policyEnforcement } from "../policy/insights.js";
import { gatewayPausedState } from "../gateway/gateway.js";

/**
 * The Control Center (docs/CONTROL_CENTER.md): one view across every AEGIS module. Each tile is
 * computed from stored records, says where its number comes from, and links to the page that shows
 * the underlying rows. Tiles the viewer has no permission for are left out, not shown as zero.
 */

export type TileTone = "allow" | "deny" | "approval" | "info" | "neutral";

export interface Tile {
  key: string;
  group: "Control" | "Security" | "Governance" | "Assurance" | "Integrations";
  label: string;
  value: number | string;
  detail: string;
  tone: TileTone;
  /** Where the number comes from, in plain words. */
  source: string;
  href: string;
}

function can(ctx: OrgContext, p: Permission) {
  return ctx.actor.type === "system" || hasPermission(ctx.actor.permissions, p);
}

const DAY = 86_400_000;

export async function controlCenter(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "org:read");
  const now = ctx.now ?? new Date();
  const orgId = ctx.orgId;
  const tiles: Tile[] = [];
  let decisionsByDay: { day: string; allow: number; deny: number; require_approval: number; error: number }[] = [];

  if (can(ctx, "gateway:read")) {
    const since = new Date(now.getTime() - 14 * DAY);
    const rows = await db.authorizationDecision.findMany({ where: { orgId, createdAt: { gte: since }, request: { agent: { isLab: false } } }, select: { result: true, createdAt: true } });
    const days = new Map<string, { allow: number; deny: number; require_approval: number; error: number }>();
    for (let i = 13; i >= 0; i--) days.set(new Date(now.getTime() - i * DAY).toISOString().slice(0, 10), { allow: 0, deny: 0, require_approval: 0, error: 0 });
    for (const r of rows) {
      const d = days.get(r.createdAt.toISOString().slice(0, 10));
      if (!d) continue;
      const k = r.result === "allow" || r.result === "restrict" ? "allow" : r.result === "require_approval" || r.result === "request_more_information" || r.result === "quarantine" ? "require_approval" : r.result === "error" ? "error" : "deny";
      d[k] += 1;
    }
    decisionsByDay = [...days.entries()].map(([day, v]) => ({ day, ...v }));
    const total = rows.length;
    const refused = rows.filter((r) => r.result === "deny" || r.result === "error").length;
    tiles.push({ key: "decisions", group: "Control", label: "Decisions, 14 days", value: total, detail: `${refused} refused (${total ? Math.round((refused / total) * 100) : 0}%)`, tone: "info", source: "Authorization decisions recorded by the gateway, excluding Attack Simulation Lab agents", href: "/activity" });
    const pending = await db.approvalRequest.count({ where: { orgId, status: { in: ["pending", "more_info", "escalated"] }, expiresAt: { gt: now }, request: { agent: { isLab: false } } } });
    tiles.push({ key: "approvals", group: "Control", label: "Approvals waiting", value: pending, detail: "Not yet decided or expired", tone: pending ? "approval" : "allow", source: "Open approval requests", href: "/approvals" });
  }
  if (can(ctx, "agents:read")) {
    const agents = await db.agent.findMany({ where: { orgId, isLab: false, status: "active" }, select: { autonomyLevel: true, modelRecordId: true } });
    const byLevel = [0, 1, 2, 3, 4].map((l) => agents.filter((a) => a.autonomyLevel === l).length);
    tiles.push({ key: "autonomy", group: "Control", label: "Active agents", value: agents.length, detail: `By autonomy level 0 to 4: ${byLevel.join(", ")}`, tone: "info", source: "Active agents and their managed autonomy level", href: "/agents/autonomy" });
    const models = await db.aiModel.findMany({ where: { orgId }, select: { key: true, stage: true, reviewDueAt: true } });
    const attention = models.filter((m) => modelGateCheck(m, now).status !== "ok").length;
    const unlinked = agents.filter((a) => !a.modelRecordId).length;
    tiles.push({ key: "models", group: "Governance", label: "Models needing attention", value: attention, detail: `${models.length} registered; ${unlinked} active agent${unlinked === 1 ? "" : "s"} not linked to one`, tone: attention || unlinked ? "approval" : "allow", source: "Model registry stages and review dates", href: "/governance/models" });
  }
  if (can(ctx, "policies:read")) {
    const e = await policyEnforcement(db, ctx);
    const states = [...e.values()];
    const enforced = states.filter((s) => s.state === "enforced").length;
    const notEnforced = states.filter((s) => s.state !== "enforced" && s.state !== "no_active_version").length;
    tiles.push({ key: "policy-coverage", group: "Control", label: "Policies enforced", value: `${enforced} of ${states.length}`, detail: notEnforced ? `${notEnforced} active but not reaching any agent` : "Every active policy reaches an agent", tone: notEnforced ? "approval" : "allow", source: "Active versions, assignments, covered agents and their tools", href: "/policies" });
    const exceptions = await db.policyException.count({ where: { orgId, status: "approved", expiresAt: { gt: now } } });
    tiles.push({ key: "exceptions", group: "Control", label: "Active policy exceptions", value: exceptions, detail: "Approved and not yet expired", tone: exceptions ? "approval" : "neutral", source: "Policy exceptions", href: "/policies?tab=exceptions" });
  }
  if (can(ctx, "security:read")) {
    const events = await db.securityEvent.groupBy({ by: ["severity"], where: { orgId, status: "open", NOT: { title: { startsWith: "[lab]" } } }, _count: { _all: true } });
    const sev = Object.fromEntries(events.map((e) => [e.severity, e._count._all]));
    const open = events.reduce((n, e) => n + e._count._all, 0);
    tiles.push({ key: "security-events", group: "Security", label: "Open security events", value: open, detail: `Critical ${sev.critical ?? 0}, high ${sev.high ?? 0}, medium ${sev.medium ?? 0}, low ${sev.low ?? 0}`, tone: (sev.critical ?? 0) + (sev.high ?? 0) ? "deny" : open ? "approval" : "allow", source: "Security events not yet triaged, dismissed or linked, excluding lab traffic", href: "/security/events" });
    const incidents = await db.incident.count({ where: { orgId, status: { not: "resolved" } } });
    tiles.push({ key: "incidents", group: "Security", label: "Open incidents", value: incidents, detail: "Open, investigating or contained", tone: incidents ? "deny" : "allow", source: "Incidents", href: "/security/incidents" });
    const run = await db.attackSimulationRun.findFirst({ where: { orgId, status: "completed" }, orderBy: { startedAt: "desc" } });
    const counts = ((run?.summary ?? {}) as { counts?: Record<string, number> }).counts ?? {};
    tiles.push({ key: "lab", group: "Security", label: "Lab gaps (latest run)", value: run ? (counts.gap ?? 0) : "No run", detail: run ? `${counts.defended ?? 0} defended on ${run.startedAt.toISOString().slice(0, 10)}` : "Run the Attack Simulation Lab", tone: !run ? "neutral" : (counts.gap ?? 0) ? "deny" : "allow", source: "The most recent completed Attack Simulation Lab run", href: run ? `/security/lab/${run.id}` : "/security/lab" });
    const datasets = await db.dataset.findMany({ where: { orgId }, select: { ownerId: true, retentionDays: true, lawfulBasis: true, categories: true, region: true, resourceId: true, classification: true } });
    const gaps = datasets.filter((d) => datasetFindings(d).length).length;
    const deletions = await db.dataDeletionRequest.findMany({ where: { orgId, status: { in: ["requested", "approved"] } }, select: { status: true, dueAt: true } });
    const overdue = deletions.filter((d) => deletionOverdue(d, now)).length;
    tiles.push({ key: "data", group: "Governance", label: "Datasets with gaps", value: `${gaps} of ${datasets.length}`, detail: `${deletions.length} deletion request${deletions.length === 1 ? "" : "s"} open, ${overdue} overdue`, tone: overdue ? "deny" : gaps ? "approval" : "allow", source: "Data inventory findings and deletion requests", href: "/governance/data" });
  }
  if (can(ctx, "audit:read")) {
    const changes = await db.regulatoryChange.findMany({ where: { orgId, status: { in: ["new", "assessing", "action_required"] } }, select: { effectiveAt: true } });
    const soon = changes.filter((c) => c.effectiveAt && c.effectiveAt >= now && c.effectiveAt.getTime() <= now.getTime() + 90 * DAY).length;
    const inForce = changes.filter((c) => c.effectiveAt && c.effectiveAt < now).length;
    tiles.push({ key: "regulatory", group: "Governance", label: "Open regulatory changes", value: changes.length, detail: `${soon} effective within 90 days; ${inForce} already in force`, tone: inForce ? "deny" : soon ? "approval" : "neutral", source: "Regulatory change register", href: "/governance/regulatory" });
  }
  if (can(ctx, "evidence:read")) {
    const [last, count] = await Promise.all([db.evidenceCheckpoint.findFirst({ where: { orgId }, orderBy: { throughSeq: "desc" } }), db.evidenceEvent.count({ where: { orgId } })]);
    tiles.push({ key: "evidence", group: "Assurance", label: "Evidence record", value: count, detail: last ? `Signed checkpoint through event ${last.throughSeq.toString()} at ${last.signedAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : "No signed checkpoint yet", tone: last ? "allow" : "approval", source: "Hash-chained evidence events and signed checkpoints", href: "/evidence" });
  }
  if (can(ctx, "integrations:read")) {
    const [destinations, failed] = await Promise.all([db.eventDestination.findMany({ where: { orgId }, select: { enabled: true, verifiedAt: true } }), db.eventDelivery.count({ where: { orgId, status: "failed", createdAt: { gte: new Date(now.getTime() - 7 * DAY) } } })]);
    const enabled = destinations.filter((d) => d.enabled).length;
    tiles.push({ key: "destinations", group: "Integrations", label: "Event destinations", value: `${enabled} sending`, detail: `${destinations.filter((d) => d.verifiedAt).length} verified with a test event; ${failed} failed deliveries in 7 days`, tone: failed ? "deny" : enabled ? "allow" : "neutral", source: "Event destinations and their delivery log", href: "/integrations/destinations" });
  }
  return { tiles, decisionsByDay, generatedAt: now };
}

export interface HealthCheck {
  key: string;
  label: string;
  status: "ok" | "warning" | "failing" | "unknown";
  detail: string;
  href?: string;
}

/**
 * Organization-level health, from records the platform already keeps. It reflects what this
 * organization can see: platform-wide jobs and infrastructure belong to the platform admin view.
 */
export async function organizationHealth(db: TenantDb, ctx: OrgContext): Promise<HealthCheck[]> {
  assertPermission(ctx, "org:read");
  const now = ctx.now ?? new Date();
  const orgId = ctx.orgId;
  const checks: HealthCheck[] = [];
  const started = Date.now();
  await db.$queryRaw`SELECT 1`;
  checks.push({ key: "database", label: "Database", status: "ok", detail: `Answered in ${Date.now() - started} ms` });

  // The worker signs a checkpoint every few minutes; evidence older than ten minutes without one means it is not running.
  const last = await db.evidenceCheckpoint.findFirst({ where: { orgId }, orderBy: { throughSeq: "desc" } });
  const uncovered = await db.evidenceEvent.findFirst({ where: { orgId, ...(last ? { seq: { gt: last.throughSeq } } : {}) }, orderBy: { seq: "asc" }, select: { occurredAt: true } });
  const lagMin = uncovered ? Math.round((now.getTime() - uncovered.occurredAt.getTime()) / 60_000) : 0;
  checks.push({ key: "worker", label: "Background worker", status: !uncovered ? "ok" : lagMin > 10 ? "failing" : "ok", detail: !uncovered ? "Every evidence event is covered by a signed checkpoint" : lagMin > 10 ? `Evidence from ${lagMin} minutes ago has no signed checkpoint: the worker is probably not running` : `Newest evidence is ${lagMin} minutes old and will be checkpointed shortly`, href: "/evidence" });

  const jobs = await db.job.groupBy({ by: ["status"], where: { orgId }, _count: { _all: true } });
  const j = Object.fromEntries(jobs.map((x) => [x.status, x._count._all]));
  const overdue = await db.job.count({ where: { orgId, status: "pending", runAt: { lt: new Date(now.getTime() - 10 * 60_000) } } });
  const failedRecent = await db.job.count({ where: { orgId, status: "failed", updatedAt: { gte: new Date(now.getTime() - DAY) } } });
  checks.push({ key: "jobs", label: "Organization jobs", status: failedRecent ? "warning" : overdue ? "warning" : "ok", detail: `${j.pending ?? 0} waiting (${overdue} more than 10 minutes overdue), ${j.running ?? 0} running, ${failedRecent} failed in 24 hours` });

  if (hasPermission(ctx.actor.permissions, "integrations:read") || ctx.actor.type === "system") {
    const integrations = await db.integration.findMany({ where: { orgId, status: "active" }, select: { name: true, lastHealthOk: true, lastHealthAt: true } });
    const failing = integrations.filter((i) => i.lastHealthOk === false);
    const untested = integrations.filter((i) => i.lastHealthAt === null).length;
    checks.push({ key: "integrations", label: "Integrations", status: failing.length ? "failing" : untested ? "unknown" : "ok", detail: failing.length ? `Last connection test failed: ${failing.map((f) => f.name).join(", ")}` : `${integrations.length} active, ${untested} never tested`, href: "/integrations" });
    const destinations = await db.eventDestination.findMany({ where: { orgId, enabled: true }, select: { name: true, lastError: true } });
    const pendingOld = await db.eventDelivery.count({ where: { orgId, status: "pending", createdAt: { lt: new Date(now.getTime() - 30 * 60_000) } } });
    const erroring = destinations.filter((d) => d.lastError);
    checks.push({ key: "destinations", label: "Event delivery", status: erroring.length ? "warning" : pendingOld ? "warning" : destinations.length ? "ok" : "unknown", detail: destinations.length ? `${destinations.length} sending; ${erroring.length} with a recent error; ${pendingOld} deliveries waiting over 30 minutes` : "No destination is sending", href: "/integrations/destinations" });
  }
  const gw = await gatewayPausedState(db, orgId);
  checks.push({ key: "gateway", label: "Action Gateway", status: gw.paused ? "warning" : "ok", detail: gw.paused ? `Paused: ${gw.reason ?? "no reason recorded"}` : "Accepting requests", href: "/gateway" });
  return checks;
}
