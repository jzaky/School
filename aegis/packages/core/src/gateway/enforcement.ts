import type { Prisma, TenantDb } from "@aegis/db";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { forbidden, notFound } from "../lib/errors.js";
import { hasPermission } from "../identity/permissions.js";
import { createSecurityEvent } from "../shield/security-events.js";
import { getDownstreamSystem, readIntegrationCredential, type DownstreamContext } from "./simulators.js";
import type { TenantRunner } from "./gateway.js";

/**
 * Enforcement-path audit. AEGIS can only enforce actions routed through it; this audit looks for the
 * ones that were not. For each integration whose downstream system can list its own recent
 * operations, every operation is matched to an AEGIS request that was authorized and executed:
 *
 * - bypass: the operation carries no AEGIS request id, so it was made around the gateway.
 * - unknownRequest: it carries an id that is not a request of this organization.
 * - unauthorized: it carries the id of a request AEGIS never authorized to execute (denied,
 *   rejected, expired, quarantined, still pending, or never granted).
 * - matched: authorized and executed through a consumed grant.
 *
 * Any bypass, unknown or unauthorized operation raises a security event. Systems that cannot list
 * their operations are reported as "not observable", never as clean.
 */
export interface EnforcementFinding {
  reference: string;
  kind: "bypass" | "unknownRequest" | "unauthorized";
  aegisRequestId: string | null;
  at: string;
  detail: string;
}

export interface EnforcementAuditResult {
  integrationId: string;
  integrationKey: string;
  observable: boolean;
  windowStart: string;
  checkedAt: string;
  operations: number;
  matched: number;
  findings: EnforcementFinding[];
  error: string | null;
}

const EXECUTED = new Set(["executing", "executed", "failed", "unknown"]);

function assertCanAudit(ctx: OrgContext) {
  if (ctx.actor.type === "system") return;
  if (ctx.actor.type !== "user" || !(hasPermission(ctx.actor.permissions, "integrations:write") || hasPermission(ctx.actor.permissions, "security:write"))) throw forbidden("Missing permission integrations:write or security:write");
}

export async function auditEnforcementPath(run: TenantRunner, ctx: OrgContext, integrationId: string, opts: { windowHours?: number } = {}): Promise<EnforcementAuditResult> {
  assertCanAudit(ctx);
  const now = ctx.now ?? new Date();
  const since = new Date(now.getTime() - (opts.windowHours ?? 24) * 3600_000);
  const integ = await run((db) => db.integration.findUnique({ where: { id: integrationId } }));
  if (!integ) throw notFound("Integration");
  const system = getDownstreamSystem(integ.key);
  const base = { integrationId, integrationKey: integ.key, windowStart: since.toISOString(), checkedAt: now.toISOString() };
  let result: EnforcementAuditResult;
  if (!system?.listRecentOperations) {
    result = { ...base, observable: false, operations: 0, matched: 0, findings: [], error: system ? `${integ.key} cannot list its operations; actions taken around AEGIS cannot be detected here` : `no connector registered for ${integ.key}` };
  } else {
    const dctx: DownstreamContext = { orgId: ctx.orgId, integrationId, run, credential: (name = "service-token") => run((db) => readIntegrationCredential(db, integrationId, name)) };
    try {
      const ops = await system.listRecentOperations(dctx, since);
      const ids = [...new Set(ops.map((o) => o.aegisRequestId).filter((x): x is string => !!x))];
      const requests = ids.length ? await run((db) => db.actionRequest.findMany({ where: { orgId: ctx.orgId, id: { in: ids } }, select: { id: true, status: true, toolId: true, grants: { where: { consumedAt: { not: null } }, select: { id: true }, take: 1 } } })) : [];
      const byId = new Map(requests.map((r) => [r.id, r]));
      const findings: EnforcementFinding[] = [];
      let matched = 0;
      for (const op of ops) {
        const at = op.at.toISOString();
        if (!op.aegisRequestId) {
          findings.push({ reference: op.reference, kind: "bypass", aegisRequestId: null, at, detail: "Operation carries no AEGIS request id: it was made without going through the gateway" });
          continue;
        }
        const r = byId.get(op.aegisRequestId);
        if (!r) findings.push({ reference: op.reference, kind: "unknownRequest", aegisRequestId: op.aegisRequestId, at, detail: "Operation names an AEGIS request that does not exist in this organization" });
        else if (!EXECUTED.has(r.status) || r.grants.length === 0) findings.push({ reference: op.reference, kind: "unauthorized", aegisRequestId: r.id, at, detail: `Operation names request ${r.id}, which AEGIS left ${r.status}${r.grants.length === 0 ? " without a consumed grant" : ""}` });
        else matched++;
      }
      result = { ...base, observable: true, operations: ops.length, matched, findings, error: null };
    } catch (e) {
      result = { ...base, observable: false, operations: 0, matched: 0, findings: [], error: `could not read operations: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  await run(async (db) => {
    const summary = { observable: result.observable, operations: result.operations, matched: result.matched, bypass: result.findings.filter((f) => f.kind === "bypass").length, unknownRequest: result.findings.filter((f) => f.kind === "unknownRequest").length, unauthorized: result.findings.filter((f) => f.kind === "unauthorized").length, windowStart: result.windowStart, error: result.error, findings: result.findings.slice(0, 50) };
    await db.integration.update({ where: { id: integrationId }, data: { lastEnforcementAuditAt: now, enforcementSummary: summary as unknown as Prisma.InputJsonValue } });
    await appendEvidence(db, ctx, { type: "integration.enforcement_audited", subjectType: "integration", subjectId: integrationId, payload: { ...summary, findings: undefined } });
    if (result.findings.length) {
      const unauthorized = result.findings.some((f) => f.kind !== "bypass");
      await createSecurityEvent(db, ctx, { type: "enforcement.bypass_detected", severity: unauthorized ? "critical" : "high", title: `Actions outside AEGIS on ${integ.key}: ${result.findings.length}`, detail: { integrationKey: integ.key, findings: result.findings.slice(0, 20).map((f) => ({ kind: f.kind, reference: f.reference, aegisRequestId: f.aegisRequestId, at: f.at })) } });
    }
  });
  return result;
}

/** Audits every active integration. Used by the worker. */
export async function auditAllEnforcementPaths(run: TenantRunner, ctx: OrgContext, opts: { windowHours?: number } = {}): Promise<EnforcementAuditResult[]> {
  const integrations = await run((db) => db.integration.findMany({ where: { orgId: ctx.orgId, status: "active" }, select: { id: true } }));
  const out: EnforcementAuditResult[] = [];
  for (const i of integrations) out.push(await auditEnforcementPath(run, ctx, i.id, opts));
  return out;
}

export type EnforcementStrength = "gateway_executes" | "downstream_verifies" | "self_reported" | "not_enforced";

/**
 * How each granted tool is enforced, per agent. The strongest path is the gateway executing the
 * call itself through a registered connector. Next is a downstream system that verifies grants
 * (agent mode with the grant checked downstream). Self-reported means the agent executes and tells
 * AEGIS what happened: the decision is enforced only if the agent honours it. Not enforced means
 * no integration is attached, so nothing downstream can refuse a call that skipped AEGIS.
 */
export async function enforcementCoverage(db: TenantDb, ctx: OrgContext) {
  if (ctx.actor.type === "user" && !hasPermission(ctx.actor.permissions, "integrations:read")) throw forbidden("Missing permission integrations:read");
  const since = new Date((ctx.now ?? new Date()).getTime() - 30 * 24 * 3600_000);
  const agents = await db.agent.findMany({ where: { orgId: ctx.orgId, status: { in: ["active", "registered", "suspended"] } }, select: { id: true, slug: true, name: true, status: true, tools: { where: { enabled: true, revokedAt: null }, select: { tool: { select: { key: true, integration: { select: { id: true, key: true, enforcementSummary: true, lastEnforcementAuditAt: true } } } } } } }, orderBy: { slug: "asc" } });
  const modes = await db.actionRequest.groupBy({ by: ["agentId", "toolKey"], where: { orgId: ctx.orgId, createdAt: { gte: since } }, _count: { _all: true } });
  const agentMode = await db.$queryRaw<{ agent_id: string; tool_key: string; n: bigint }[]>`SELECT agent_id, tool_key, count(*)::bigint AS n FROM action_requests WHERE org_id = ${ctx.orgId}::uuid AND created_at >= ${since} AND context->>'executionMode' = 'agent' GROUP BY agent_id, tool_key`;
  const total = new Map(modes.map((m) => [`${m.agentId}:${m.toolKey}`, m._count._all]));
  const selfRun = new Map(agentMode.map((m) => [`${m.agent_id}:${m.tool_key}`, Number(m.n)]));
  return agents.map((a) => ({
    agentId: a.id,
    slug: a.slug,
    name: a.name,
    status: a.status,
    tools: a.tools.map(({ tool }) => {
      const key = `${a.id}:${tool.key}`;
      const requests30d = total.get(key) ?? 0;
      const agentExecuted = selfRun.get(key) ?? 0;
      const connector = tool.integration ? getDownstreamSystem(tool.integration.key) : undefined;
      const strength: EnforcementStrength = !tool.integration ? "not_enforced" : agentExecuted > 0 ? (connector ? "downstream_verifies" : "self_reported") : connector ? "gateway_executes" : "self_reported";
      const summary = (tool.integration?.enforcementSummary ?? {}) as { observable?: boolean; bypass?: number; unknownRequest?: number; unauthorized?: number };
      return { toolKey: tool.key, integrationKey: tool.integration?.key ?? null, strength, requests30d, agentExecuted, observable: summary.observable ?? null, lastAuditAt: tool.integration?.lastEnforcementAuditAt?.toISOString() ?? null, outsideGateway: (summary.bypass ?? 0) + (summary.unknownRequest ?? 0) + (summary.unauthorized ?? 0) };
    }),
  }));
}
