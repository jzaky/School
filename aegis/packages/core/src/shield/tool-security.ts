import { orgSettings } from "../lib/tx-cache.js";
import type { TenantDb } from "@aegis/db";
import { baselineChecks, validateParams, type BaselineFailure } from "../gateway/baseline.js";
import { extractDestinationDomain } from "../gateway/input.js";
import type { OrgContext } from "../lib/context.js";
import { notFound } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";
import { loadEnabledDataClasses } from "./data-classes.js";
import { inspectParams, type Finding } from "./detectors.js";

/**
 * Read-only tool security analysis. It reuses the gateway's baseline checks (same function, same
 * inputs) so the Tool Security screen gives exactly the answers the gateway would give for the
 * structural part of a decision. Policies are not evaluated here.
 */
export interface ToolSecurityReport {
  agent: { id: string; slug: string; status: string; dataClassificationLimit: string } | null;
  tool: { id: string; key: string; riskLevel: string; enabled: boolean; integration: { key: string; status: string } | null } | null;
  grant: { status: "granted" | "not_granted" | "revoked" | "disabled" | "unknown" };
  destination: { domain: string | null; allowedDomains: string[]; result: "allowed" | "denied" | "not_applicable" };
  resource: { key: string | null; allowedResourceKeys: string[]; result: "allowed" | "denied" | "not_applicable" };
  parameters: { ok: boolean; errors: string[] };
  classification: { resourceClassification: string | null; agentLimit: string | null; result: "within_limit" | "exceeded" | "not_applicable" };
  dataClasses: { findings: Finding[]; dataClasses: string[]; highestSeverity: string | null; blocked: boolean; requireApproval: boolean };
  /** Raw baseline failures, identical to the gateway's. */
  baseline: BaselineFailure[];
  verdict: "would_deny" | "would_block" | "would_require_approval" | "passes_structural_checks";
  heuristic: false;
}

async function gatewayPaused(db: TenantDb, orgId: string): Promise<{ paused: boolean; reason?: string }> {
  // organizations is a global table (no org_id); reading it is how the gateway does it too.
  const org = { settings: await orgSettings(db, orgId) };
  const s = (org?.settings ?? {}) as { gatewayPaused?: boolean; gatewayPausedReason?: string };
  return { paused: !!s.gatewayPaused, reason: s.gatewayPausedReason };
}

export async function evaluateToolSecurity(db: TenantDb, orgId: string, input: { agentId: string; toolKey: string; action?: string; params?: Record<string, unknown>; destinationDomain?: string | null; resourceKey?: string | null }): Promise<ToolSecurityReport> {
  const params = input.params ?? {};
  const action = input.action ?? "execute";
  const agent = await db.agent.findUnique({ where: { id: input.agentId }, include: { tools: { include: { tool: true } }, permissions: true } });
  if (!agent || agent.orgId !== orgId) throw notFound("Agent");
  const tool = await db.tool.findUnique({ where: { orgId_key: { orgId, key: input.toolKey } }, include: { integration: { omit: { settings: true, enforcementSummary: true } } } });
  const resource = input.resourceKey ? await db.resource.findUnique({ where: { orgId_key: { orgId, key: input.resourceKey } } }) : null;
  const destinationDomain = input.destinationDomain === undefined ? extractDestinationDomain(params) : input.destinationDomain;

  const baseline = baselineChecks({ agent, tool, action, resource, resourceKeyRequested: input.resourceKey ?? null, params, destinationDomain, gatewayPaused: await gatewayPaused(db, orgId) });
  const codes = new Set(baseline.failures.map((f) => f.code));

  const rules = (tool?.destinationRules ?? {}) as { allowedDomains?: string[]; allowedResourceKeys?: string[] };
  const allowedDomains = rules.allowedDomains ?? [];
  const allowedResourceKeys = rules.allowedResourceKeys ?? [];
  const grantRow = tool ? agent.tools.find((t) => t.toolId === tool.id) : undefined;
  const grant: ToolSecurityReport["grant"] = !tool ? { status: "unknown" } : !grantRow ? { status: "not_granted" } : grantRow.revokedAt ? { status: "revoked" } : !grantRow.enabled ? { status: "disabled" } : { status: "granted" };

  const domainDenied = baseline.failures.some((f) => f.code === "destination_not_allowed" && f.message.startsWith("Destination "));
  const resourceDenied = baseline.failures.some((f) => f.code === "destination_not_allowed" && f.message.includes("may not target resource"));
  const paramCheck = tool ? validateParams(tool.parameterSchema, params) : { ok: true as const };

  const classes = await loadEnabledDataClasses(db, orgId);
  const inspection = inspectParams(params, classes);

  const verdict: ToolSecurityReport["verdict"] = baseline.failures.length > 0 || !tool ? "would_deny" : inspection.blocked ? "would_block" : inspection.requireApproval ? "would_require_approval" : "passes_structural_checks";

  return {
    agent: { id: agent.id, slug: agent.slug, status: agent.status, dataClassificationLimit: agent.dataClassificationLimit },
    tool: tool ? { id: tool.id, key: tool.key, riskLevel: tool.riskLevel, enabled: tool.enabled, integration: tool.integration ? { key: tool.integration.key, status: tool.integration.status } : null } : null,
    grant,
    destination: { domain: destinationDomain, allowedDomains, result: !tool || allowedDomains.length === 0 || !destinationDomain ? "not_applicable" : domainDenied ? "denied" : "allowed" },
    resource: { key: input.resourceKey ?? null, allowedResourceKeys, result: !tool || !resource || allowedResourceKeys.length === 0 ? "not_applicable" : resourceDenied ? "denied" : "allowed" },
    parameters: paramCheck.ok ? { ok: true, errors: [] } : { ok: false, errors: paramCheck.errors },
    classification: { resourceClassification: resource?.classification ?? null, agentLimit: agent.dataClassificationLimit, result: !resource ? "not_applicable" : codes.has("classification_exceeded") ? "exceeded" : "within_limit" },
    dataClasses: { findings: inspection.findings, dataClasses: inspection.dataClasses, highestSeverity: inspection.highestSeverity, blocked: inspection.blocked, requireApproval: inspection.requireApproval },
    baseline: baseline.failures,
    verdict,
    heuristic: false,
  };
}

export interface ToolSecurityOverviewRow {
  id: string;
  key: string;
  name: string;
  riskLevel: string;
  enabled: boolean;
  integration: { key: string; status: string } | null;
  agentsGranted: number;
  grantedAgents: { id: string; slug: string; name: string; status: string }[];
  allowedDomains: string[];
  allowedResourceKeys: string[];
  hasParameterSchema: boolean;
  deniedCount7d: number;
  requestCount7d: number;
  recentSecurityEvents: { id: string; type: string; severity: string; title: string; status: string; createdAt: Date }[];
}

export async function listToolSecurityOverview(db: TenantDb, ctx: OrgContext): Promise<ToolSecurityOverviewRow[]> {
  assertPermission(ctx, "security:read");
  const since = new Date((ctx.now ?? new Date()).getTime() - 7 * 86400_000);
  const tools = await db.tool.findMany({ where: { orgId: ctx.orgId }, include: { integration: { select: { key: true, status: true } }, agentTools: { where: { enabled: true, revokedAt: null }, include: { agent: { select: { id: true, slug: true, name: true, status: true } } } } }, orderBy: { key: "asc" } });
  const [denied, all] = await Promise.all([
    db.actionRequest.groupBy({ by: ["toolKey"], where: { orgId: ctx.orgId, status: "denied", createdAt: { gte: since } }, _count: { _all: true } }),
    db.actionRequest.groupBy({ by: ["toolKey"], where: { orgId: ctx.orgId, createdAt: { gte: since } }, _count: { _all: true } }),
  ]);
  const deniedBy = new Map(denied.map((d) => [d.toolKey, d._count._all]));
  const allBy = new Map(all.map((d) => [d.toolKey, d._count._all]));
  const out: ToolSecurityOverviewRow[] = [];
  for (const t of tools) {
    const rules = (t.destinationRules ?? {}) as { allowedDomains?: string[]; allowedResourceKeys?: string[] };
    const events = await db.securityEvent.findMany({ where: { orgId: ctx.orgId, detail: { path: ["tool"], equals: t.key } }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, type: true, severity: true, title: true, status: true, createdAt: true } });
    out.push({
      id: t.id,
      key: t.key,
      name: t.name,
      riskLevel: t.riskLevel,
      enabled: t.enabled,
      integration: t.integration,
      agentsGranted: t.agentTools.length,
      grantedAgents: t.agentTools.map((g) => g.agent),
      allowedDomains: rules.allowedDomains ?? [],
      allowedResourceKeys: rules.allowedResourceKeys ?? [],
      hasParameterSchema: !!t.parameterSchema && typeof t.parameterSchema === "object" && Object.keys(t.parameterSchema as object).length > 0,
      deniedCount7d: deniedBy.get(t.key) ?? 0,
      requestCount7d: allBy.get(t.key) ?? 0,
      recentSecurityEvents: events,
    });
  }
  return out;
}
