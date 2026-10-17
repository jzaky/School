import type { TenantDb } from "@aegis/db";
import { z } from "zod";
import { verifyChain } from "../evidence/ledger.js";

/**
 * Deterministic, explainable monitoring rules. Each rule type is a small SQL-backed check with
 * explicit thresholds and windows. Results are facts about records (counts, sums, lists), never
 * predictions. The console shows the definition next to every alert so a reader can reproduce it.
 */
export const ruleDefinitionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("repeated_denials"), threshold: z.number().int().min(1).default(5), windowMinutes: z.number().int().min(5).default(1440) }),
  z.object({ type: z.literal("permission_escalation"), threshold: z.number().int().min(1).default(3), windowMinutes: z.number().int().min(5).default(1440) }),
  z.object({ type: z.literal("unusual_tool_usage"), baselineDays: z.number().int().min(1).default(30) }),
  z.object({ type: z.literal("transaction_volume"), toolKey: z.string().default("initiate-transfer"), amountThreshold: z.number().min(0).default(1_000_000), windowMinutes: z.number().int().min(5).default(1440) }),
  z.object({ type: z.literal("integration_failures"), threshold: z.number().int().min(1).default(3), windowMinutes: z.number().int().min(5).default(60) }),
  z.object({ type: z.literal("policy_evaluation_failures"), threshold: z.number().int().min(1).default(1), windowMinutes: z.number().int().min(5).default(60) }),
  z.object({ type: z.literal("missing_evidence"), olderThanMinutes: z.number().int().min(1).default(10) }),
  z.object({ type: z.literal("unresolved_execution"), olderThanMinutes: z.number().int().min(1).default(5) }),
  z.object({ type: z.literal("abnormal_activity"), multiplier: z.number().min(1.1).default(3), baselineDays: z.number().int().min(1).default(7), minimumRequests: z.number().int().min(1).default(20) }),
  z.object({ type: z.literal("approval_backlog"), expiringWithinMinutes: z.number().int().min(1).default(60) }),
  z.object({ type: z.literal("chain_integrity") }),
  z.object({ type: z.literal("credential_rotation_due"), withinDays: z.number().int().min(0).default(7) }),
]);
export type RuleDefinition = z.infer<typeof ruleDefinitionSchema>;

export interface RuleFinding {
  /** Stable key so the same situation produces one alert, not one per run. */
  dedupeKey: string;
  title: string;
  agentId: string | null;
  detail: Record<string, unknown>;
}

export const DEFAULT_RULES: { key: string; name: string; description: string; severity: string; definition: RuleDefinition }[] = [
  { key: "RM-001", name: "Repeated denied actions", description: "An agent was denied 5 or more times in 24 hours", severity: "medium", definition: { type: "repeated_denials", threshold: 5, windowMinutes: 1440 } },
  { key: "RM-002", name: "Permission escalation attempts", description: "An agent tried tools, resources or classifications it was never granted, 3 or more times in 24 hours", severity: "high", definition: { type: "permission_escalation", threshold: 3, windowMinutes: 1440 } },
  { key: "RM-003", name: "Unusual tool usage", description: "An agent used a tool it had not used in the previous 30 days", severity: "low", definition: { type: "unusual_tool_usage", baselineDays: 30 } },
  { key: "RM-004", name: "Unexpected transaction volume", description: "Executed transfers by one agent exceeded AED 1,000,000 in 24 hours", severity: "high", definition: { type: "transaction_volume", toolKey: "initiate-transfer", amountThreshold: 1_000_000, windowMinutes: 1440 } },
  { key: "RM-005", name: "Integration failures", description: "3 or more failed executions against one integration in 60 minutes", severity: "medium", definition: { type: "integration_failures", threshold: 3, windowMinutes: 60 } },
  { key: "RM-006", name: "Policy evaluation failures", description: "Any decision that ended in an evaluation error (denied fail-closed)", severity: "high", definition: { type: "policy_evaluation_failures", threshold: 1, windowMinutes: 60 } },
  { key: "RM-007", name: "Missing evidence or receipts", description: "Allowed or approved requests older than 10 minutes without an execution receipt", severity: "high", definition: { type: "missing_evidence", olderThanMinutes: 10 } },
  { key: "RM-008", name: "Abnormal agent activity", description: "Requests in the last hour exceed 3 times the 7-day hourly average (minimum 20)", severity: "medium", definition: { type: "abnormal_activity", multiplier: 3, baselineDays: 7, minimumRequests: 20 } },
  { key: "RM-009", name: "Approvals about to expire", description: "Pending approvals expiring within 60 minutes", severity: "low", definition: { type: "approval_backlog", expiringWithinMinutes: 60 } },
  { key: "RM-010", name: "Evidence chain integrity", description: "The evidence hash chain or a signed checkpoint failed verification", severity: "critical", definition: { type: "chain_integrity" } },
  { key: "RM-012", name: "Unresolved execution outcomes", description: "Requests whose downstream outcome is still unconfirmed after 5 minutes, or marked unknown after reconciliation gave up", severity: "high", definition: { type: "unresolved_execution", olderThanMinutes: 5 } },
  { key: "RM-011", name: "Credential rotation due", description: "Integration credentials due for rotation within 7 days or overdue", severity: "low", definition: { type: "credential_rotation_due", withinDays: 7 } },
];

const minutesAgo = (now: Date, m: number) => new Date(now.getTime() - m * 60_000);
const bucket = (now: Date, minutes: number) => Math.floor(now.getTime() / (minutes * 60_000));

export async function evaluateRule(db: TenantDb, orgId: string, def: RuleDefinition, now = new Date()): Promise<RuleFinding[]> {
  switch (def.type) {
    case "repeated_denials": {
      const rows = await db.actionRequest.groupBy({ by: ["agentId"], where: { orgId, status: "denied", createdAt: { gte: minutesAgo(now, def.windowMinutes) } }, _count: { _all: true } });
      const hits = rows.filter((r) => r._count._all >= def.threshold);
      return await withAgentNames(db, hits.map((r) => ({ dedupeKey: `repeated_denials:${r.agentId}:${bucket(now, def.windowMinutes)}`, agentId: r.agentId, title: `{agent} denied ${r._count._all} times in ${def.windowMinutes / 60}h`, detail: { count: r._count._all, threshold: def.threshold, windowMinutes: def.windowMinutes } })));
    }
    case "permission_escalation": {
      const rows = await db.$queryRaw<{ agent_id: string; n: bigint; codes: string[] }[]>`
        SELECT r.agent_id, count(*)::bigint AS n, array_agg(DISTINCT f->>'code') AS codes
        FROM authorization_decisions d
        JOIN action_requests r ON r.id = d.action_request_id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.explanation->'failures', '[]'::jsonb)) f
        WHERE d.org_id = ${orgId}::uuid AND d.created_at >= ${minutesAgo(now, def.windowMinutes)}
          AND f->>'code' IN ('tool_not_granted','resource_not_permitted','classification_exceeded','action_not_permitted','destination_not_allowed')
        GROUP BY r.agent_id`;
      const hits = rows.filter((r) => Number(r.n) >= def.threshold);
      return await withAgentNames(db, hits.map((r) => ({ dedupeKey: `permission_escalation:${r.agent_id}:${bucket(now, def.windowMinutes)}`, agentId: r.agent_id, title: `{agent} attempted ${Number(r.n)} actions outside its grants`, detail: { count: Number(r.n), codes: r.codes, threshold: def.threshold, windowMinutes: def.windowMinutes } })));
    }
    case "unusual_tool_usage": {
      const rows = await db.$queryRaw<{ agent_id: string; tool_key: string }[]>`
        SELECT DISTINCT r.agent_id, r.tool_key FROM action_requests r
        WHERE r.org_id = ${orgId}::uuid AND r.created_at >= ${minutesAgo(now, 1440)}
          AND NOT EXISTS (SELECT 1 FROM action_requests p WHERE p.org_id = r.org_id AND p.agent_id = r.agent_id AND p.tool_key = r.tool_key AND p.created_at < ${minutesAgo(now, 1440)} AND p.created_at >= ${minutesAgo(now, 1440 * def.baselineDays)})
          AND EXISTS (SELECT 1 FROM action_requests q WHERE q.org_id = r.org_id AND q.agent_id = r.agent_id AND q.created_at < ${minutesAgo(now, 1440)})`;
      return await withAgentNames(db, rows.map((r) => ({ dedupeKey: `unusual_tool:${r.agent_id}:${r.tool_key}:${bucket(now, 1440)}`, agentId: r.agent_id, title: `{agent} used ${r.tool_key} for the first time in ${def.baselineDays} days`, detail: { tool: r.tool_key, baselineDays: def.baselineDays } })));
    }
    case "transaction_volume": {
      const rows = await db.$queryRaw<{ agent_id: string; total: number; n: bigint }[]>`
        SELECT r.agent_id, sum((r.params->>'amount')::numeric)::float8 AS total, count(*)::bigint AS n
        FROM action_requests r WHERE r.org_id = ${orgId}::uuid AND r.tool_key = ${def.toolKey} AND r.status = 'executed'
          AND r.created_at >= ${minutesAgo(now, def.windowMinutes)} AND (r.params->>'amount') ~ '^[0-9.]+$'
        GROUP BY r.agent_id`;
      const hits = rows.filter((r) => r.total >= def.amountThreshold);
      return await withAgentNames(db, hits.map((r) => ({ dedupeKey: `transaction_volume:${r.agent_id}:${def.toolKey}:${bucket(now, def.windowMinutes)}`, agentId: r.agent_id, title: `{agent} executed ${def.toolKey} totalling ${Math.round(r.total).toLocaleString("en-US")} in ${def.windowMinutes / 60}h`, detail: { total: r.total, count: Number(r.n), threshold: def.amountThreshold, tool: def.toolKey } })));
    }
    case "integration_failures": {
      const rows = await db.executionReceipt.groupBy({ by: ["downstreamSystem"], where: { orgId, status: "failed", createdAt: { gte: minutesAgo(now, def.windowMinutes) } }, _count: { _all: true } });
      return rows.filter((r) => r._count._all >= def.threshold).map((r) => ({ dedupeKey: `integration_failures:${r.downstreamSystem}:${bucket(now, def.windowMinutes)}`, agentId: null, title: `${r._count._all} failed executions against ${r.downstreamSystem}`, detail: { integration: r.downstreamSystem, count: r._count._all, threshold: def.threshold } }));
    }
    case "policy_evaluation_failures": {
      const rows = await db.authorizationDecision.findMany({ where: { orgId, result: "error", createdAt: { gte: minutesAgo(now, def.windowMinutes) } }, include: { request: { select: { agentId: true } } } });
      if (rows.length < def.threshold) return [];
      return [{ dedupeKey: `policy_eval_failures:${bucket(now, def.windowMinutes)}`, agentId: rows.length === 1 ? rows[0]!.request.agentId : null, title: `${rows.length} policy evaluation failure(s) (denied fail-closed)`, detail: { count: rows.length, requestIds: rows.slice(0, 10).map((r) => r.actionRequestId) } }];
    }
    case "unresolved_execution": {
      const rows = await db.actionRequest.findMany({ where: { orgId, OR: [{ status: "unknown" }, { status: "executing", updatedAt: { lt: minutesAgo(now, def.olderThanMinutes) } }] }, select: { id: true, agentId: true, toolKey: true, status: true }, take: 50 });
      if (rows.length === 0) return [];
      return [{ dedupeKey: `unresolved_execution:${bucket(now, 60)}`, agentId: rows.length === 1 ? rows[0]!.agentId : null, title: `${rows.length} request(s) with an unconfirmed downstream outcome`, detail: { requestIds: rows.slice(0, 10).map((r) => r.id), statuses: rows.map((r) => r.status), instructions: "Open each request and use reconcile or settle; never re-run the action blindly." } }];
    }
    case "missing_evidence": {
      const stale = await db.actionRequest.findMany({ where: { orgId, status: { in: ["allowed", "approved"] }, updatedAt: { lt: minutesAgo(now, def.olderThanMinutes) }, receipts: { none: {} } }, select: { id: true, agentId: true, toolKey: true } });
      const noEvidence = await db.$queryRaw<{ id: string; agent_id: string }[]>`
        SELECT r.id, r.agent_id FROM action_requests r WHERE r.org_id = ${orgId}::uuid AND r.created_at >= ${minutesAgo(now, 1440)}
          AND NOT EXISTS (SELECT 1 FROM evidence_events e WHERE e.org_id = r.org_id AND e.correlation_id = r.correlation_id) LIMIT 50`;
      const out: RuleFinding[] = [];
      if (stale.length) out.push({ dedupeKey: `missing_receipt:${bucket(now, 60)}`, agentId: stale.length === 1 ? stale[0]!.agentId : null, title: `${stale.length} allowed request(s) without an execution receipt`, detail: { requestIds: stale.slice(0, 10).map((s) => s.id), olderThanMinutes: def.olderThanMinutes } });
      if (noEvidence.length) out.push({ dedupeKey: `missing_evidence:${bucket(now, 60)}`, agentId: null, title: `${noEvidence.length} request(s) have no evidence events`, detail: { requestIds: noEvidence.slice(0, 10).map((s) => s.id) } });
      return out;
    }
    case "abnormal_activity": {
      const rows = await db.$queryRaw<{ agent_id: string; last_hour: bigint; baseline_hourly: number }[]>`
        WITH last_hour AS (SELECT agent_id, count(*)::bigint AS n FROM action_requests WHERE org_id = ${orgId}::uuid AND created_at >= ${minutesAgo(now, 60)} GROUP BY agent_id),
        base AS (SELECT agent_id, count(*)::float8 / (${def.baselineDays} * 24) AS hourly FROM action_requests WHERE org_id = ${orgId}::uuid AND created_at >= ${minutesAgo(now, 1440 * def.baselineDays)} AND created_at < ${minutesAgo(now, 60)} GROUP BY agent_id)
        SELECT l.agent_id, l.n AS last_hour, COALESCE(b.hourly, 0) AS baseline_hourly FROM last_hour l LEFT JOIN base b ON b.agent_id = l.agent_id`;
      const hits = rows.filter((r) => Number(r.last_hour) >= def.minimumRequests && Number(r.last_hour) > def.multiplier * Math.max(r.baseline_hourly, 1));
      return await withAgentNames(db, hits.map((r) => ({ dedupeKey: `abnormal_activity:${r.agent_id}:${bucket(now, 60)}`, agentId: r.agent_id, title: `{agent} made ${Number(r.last_hour)} requests in the last hour (baseline ${r.baseline_hourly.toFixed(1)}/h)`, detail: { lastHour: Number(r.last_hour), baselineHourly: r.baseline_hourly, multiplier: def.multiplier } })));
    }
    case "approval_backlog": {
      const rows = await db.approvalRequest.findMany({ where: { orgId, status: { in: ["pending", "escalated", "more_info"] }, expiresAt: { gt: now, lt: new Date(now.getTime() + def.expiringWithinMinutes * 60_000) } }, include: { request: { select: { agentId: true, toolKey: true } } } });
      return rows.map((a) => ({ dedupeKey: `approval_expiring:${a.id}`, agentId: a.request.agentId, title: `Approval for ${a.request.toolKey} expires at ${a.expiresAt.toISOString().slice(11, 16)} UTC`, detail: { approvalRequestId: a.id, expiresAt: a.expiresAt, link: `/approvals/${a.id}` } }));
    }
    case "chain_integrity": {
      const v = await verifyChain(db, orgId);
      if (v.valid) return [];
      return [{ dedupeKey: `chain_integrity:${v.firstBadSeq ?? "cp"}`, agentId: null, title: `Evidence chain verification failed${v.firstBadSeq ? ` at sequence ${v.firstBadSeq}` : ""}`, detail: { reason: v.reason, firstBadSeq: v.firstBadSeq, checked: v.checked } }];
    }
    case "credential_rotation_due": {
      const rows = await db.credential.findMany({ where: { orgId, revokedAt: null, rotationDueAt: { lt: new Date(now.getTime() + def.withinDays * 86400_000) } }, include: { integration: { select: { key: true } } } });
      return rows.map((c) => ({ dedupeKey: `credential_due:${c.id}:${c.version}`, agentId: null, title: `Credential ${c.name} for ${c.integration.key} ${c.rotationDueAt && c.rotationDueAt < now ? "is overdue" : "is due"} for rotation`, detail: { credentialId: c.id, integration: c.integration.key, rotationDueAt: c.rotationDueAt } }));
    }
  }
}

async function withAgentNames(db: TenantDb, findings: RuleFinding[]): Promise<RuleFinding[]> {
  const ids = [...new Set(findings.map((f) => f.agentId).filter((x): x is string => !!x))];
  if (!ids.length) return findings;
  const agents = await db.agent.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, slug: true } });
  const byId = new Map(agents.map((a) => [a.id, a]));
  return findings.map((f) => ({ ...f, title: f.title.replace("{agent}", byId.get(f.agentId ?? "")?.name ?? "Unknown agent"), detail: { ...f.detail, agent: byId.get(f.agentId ?? "")?.slug ?? null } }));
}
