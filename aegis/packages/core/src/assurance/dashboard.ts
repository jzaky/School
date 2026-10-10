import type { TenantDb } from "@aegis/db";
import { rawPrisma } from "@aegis/db";
import type { OrgContext } from "../lib/context.js";
import { assertPermission } from "../orgs/orgs.js";
import { verifyChain } from "../evidence/ledger.js";
import { jobStats } from "../jobs/queue.js";

/**
 * Governance dashboard numbers. Every figure is a count or aggregate over this tenant's records;
 * nothing is estimated. `window` is in days.
 */
export async function governanceMetrics(db: TenantDb, ctx: OrgContext, windowDays = 30) {
  assertPermission(ctx, "gateway:read");
  const since = new Date(Date.now() - windowDays * 86400_000);
  const [agentsByStatus, requestsByStatus, decisionsByResult, pendingApprovals, openAlerts, openIncidents, securityBySeverity, failedReceipts, evidenceCount, lastEvidence, integrations, policies] = await Promise.all([
    db.agent.groupBy({ by: ["status"], where: { orgId: ctx.orgId }, _count: { _all: true } }),
    db.actionRequest.groupBy({ by: ["status"], where: { orgId: ctx.orgId, createdAt: { gte: since } }, _count: { _all: true } }),
    db.authorizationDecision.groupBy({ by: ["result"], where: { orgId: ctx.orgId, createdAt: { gte: since } }, _count: { _all: true } }),
    db.approvalRequest.count({ where: { orgId: ctx.orgId, status: { in: ["pending", "escalated", "more_info"] } } }),
    db.alert.count({ where: { orgId: ctx.orgId, status: "open" } }),
    db.incident.count({ where: { orgId: ctx.orgId, status: { not: "resolved" } } }),
    db.securityEvent.groupBy({ by: ["severity"], where: { orgId: ctx.orgId, createdAt: { gte: since } }, _count: { _all: true } }),
    db.executionReceipt.count({ where: { orgId: ctx.orgId, status: "failed", createdAt: { gte: since } } }),
    db.evidenceEvent.count({ where: { orgId: ctx.orgId } }),
    db.evidenceEvent.findFirst({ where: { orgId: ctx.orgId }, orderBy: { seq: "desc" }, select: { seq: true, occurredAt: true, hash: true } }),
    db.integration.findMany({ where: { orgId: ctx.orgId }, select: { key: true, name: true, status: true, lastHealthOk: true, lastHealthAt: true } }),
    db.policy.count({ where: { orgId: ctx.orgId, currentVersionId: { not: null } } }),
  ]);
  const count = <T extends { _count: { _all: number } }>(rows: T[], pick: (r: T) => boolean) => rows.filter(pick).reduce((a, r) => a + r._count._all, 0);
  const checkpoint = await db.evidenceCheckpoint.findFirst({ where: { orgId: ctx.orgId }, orderBy: { throughSeq: "desc" } });
  return {
    windowDays,
    agents: {
      registered: count(agentsByStatus, (r) => r.status !== "archived"),
      active: count(agentsByStatus, (r) => r.status === "active"),
      suspended: count(agentsByStatus, (r) => r.status === "suspended"),
      revoked: count(agentsByStatus, (r) => r.status === "revoked"),
      draft: count(agentsByStatus, (r) => r.status === "draft" || r.status === "registered"),
    },
    actions: {
      evaluated: count(decisionsByResult, () => true),
      allowed: count(decisionsByResult, (r) => r.result === "allow"),
      denied: count(decisionsByResult, (r) => r.result === "deny" || r.result === "error"),
      approvalRequired: count(decisionsByResult, (r) => r.result === "require_approval"),
      executed: count(requestsByStatus, (r) => r.status === "executed"),
      failed: count(requestsByStatus, (r) => r.status === "failed"),
      awaitingApproval: pendingApprovals,
      expired: count(requestsByStatus, (r) => r.status === "expired"),
      rejected: count(requestsByStatus, (r) => r.status === "rejected"),
    },
    policyViolations: count(securityBySeverity, () => true),
    highRiskEvents: count(securityBySeverity, (r) => r.severity === "high" || r.severity === "critical"),
    openAlerts,
    openIncidents,
    failedIntegrations: integrations.filter((i) => i.status !== "active" || i.lastHealthOk === false).length,
    failedExecutions: failedReceipts,
    activePolicies: policies,
    evidence: {
      events: evidenceCount,
      lastSeq: lastEvidence?.seq.toString() ?? "0",
      lastAt: lastEvidence?.occurredAt ?? null,
      lastCheckpointSeq: checkpoint?.throughSeq.toString() ?? null,
      lastCheckpointAt: checkpoint?.signedAt ?? null,
    },
    integrations,
  };
}

/** Day-by-day series for charts. */
export async function governanceTimeSeries(db: TenantDb, ctx: OrgContext, days = 30) {
  assertPermission(ctx, "gateway:read");
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await db.$queryRaw<{ day: Date; result: string; n: bigint }[]>`
    SELECT date_trunc('day', d.created_at) AS day, d.result::text AS result, count(*)::bigint AS n
    FROM authorization_decisions d WHERE d.org_id = ${ctx.orgId}::uuid AND d.created_at >= ${since}
    GROUP BY 1, 2 ORDER BY 1`;
  const byDay = new Map<string, { day: string; allow: number; deny: number; require_approval: number; error: number }>();
  for (let i = 0; i <= days; i++) {
    const d = new Date(since.getTime() + i * 86400_000).toISOString().slice(0, 10);
    byDay.set(d, { day: d, allow: 0, deny: 0, require_approval: 0, error: 0 });
  }
  for (const r of rows) {
    const key = new Date(r.day).toISOString().slice(0, 10);
    const entry = byDay.get(key);
    if (entry) (entry as Record<string, number | string>)[r.result] = Number(r.n);
  }
  return [...byDay.values()];
}

export async function topAgentsByDenials(db: TenantDb, ctx: OrgContext, days = 30, limit = 5) {
  assertPermission(ctx, "gateway:read");
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await db.actionRequest.groupBy({ by: ["agentId"], where: { orgId: ctx.orgId, status: "denied", createdAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { agentId: "desc" } }, take: limit });
  const agents = await db.agent.findMany({ where: { id: { in: rows.map((r) => r.agentId) } }, select: { id: true, name: true, slug: true, riskTier: true } });
  const byId = new Map(agents.map((a) => [a.id, a]));
  return rows.map((r) => ({ agent: byId.get(r.agentId) ?? null, denied: r._count._all }));
}

export async function approvalTurnaround(db: TenantDb, ctx: OrgContext, days = 30) {
  assertPermission(ctx, "gateway:read");
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await db.$queryRaw<{ status: string; n: bigint; median_minutes: number | null; p90_minutes: number | null }[]>`
    SELECT status::text, count(*)::bigint AS n,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (decided_at - created_at))/60)::float8 AS median_minutes,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (decided_at - created_at))/60)::float8 AS p90_minutes
    FROM approval_requests WHERE org_id = ${ctx.orgId}::uuid AND created_at >= ${since} AND decided_at IS NOT NULL GROUP BY status`;
  return rows.map((r) => ({ status: r.status, count: Number(r.n), medianMinutes: r.median_minutes, p90Minutes: r.p90_minutes }));
}

/** Service health visible to tenant admins (no infrastructure secrets). */
export async function serviceHealth(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "org:read");
  const started = Date.now();
  let database = "up";
  try {
    await rawPrisma().$queryRaw`SELECT 1`;
  } catch {
    database = "down";
  }
  const jobs = await jobStats().catch(() => ({}) as Record<string, number>);
  const lastRun = await db.monitoringRule.aggregate({ where: { orgId: ctx.orgId }, _max: { lastRunAt: true } });
  const lastCheckpoint = await db.evidenceCheckpoint.findFirst({ where: { orgId: ctx.orgId }, orderBy: { signedAt: "desc" } });
  const chain = await verifyChain(db, ctx.orgId, { limit: 2000 });
  const workerAlive = (lastRun._max.lastRunAt?.getTime() ?? 0) > Date.now() - 5 * 60_000 || Object.keys(jobs).length > 0;
  return {
    database,
    databaseLatencyMs: Date.now() - started,
    worker: workerAlive ? "running" : "idle_or_down",
    workerLastMonitoringRun: lastRun._max.lastRunAt,
    jobs,
    evidence: { chainChecked: chain.checked, chainValid: chain.valid, lastCheckpointAt: lastCheckpoint?.signedAt ?? null, signingKeyConfigured: !!process.env.EVIDENCE_SIGNING_KEY },
  };
}
