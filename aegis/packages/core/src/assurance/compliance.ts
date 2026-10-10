import type { TenantDb } from "@aegis/db";
import type { OrgContext } from "../lib/context.js";
import { assertPermission } from "../orgs/orgs.js";
import { verifyChain } from "../evidence/ledger.js";

/**
 * Technical controls AEGIS can observe about itself for this tenant. Each entry says what was
 * measured and how. These are "automatically observed technical controls"; the Audit module adds
 * customer documents and human validation per framework control.
 */
export async function observedTechnicalControls(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "reports:read");
  const since30 = new Date(Date.now() - 30 * 86400_000);
  const [approvals, decisions, policies, retiredVersions, mfaUsers, members, incidents, alerts, keysRotated, chain, apiKeys, suspendedOrRevoked] = await Promise.all([
    db.approvalRequest.count({ where: { orgId: ctx.orgId, createdAt: { gte: since30 } } }),
    db.authorizationDecision.count({ where: { orgId: ctx.orgId, createdAt: { gte: since30 } } }),
    db.policy.count({ where: { orgId: ctx.orgId, currentVersionId: { not: null } } }),
    db.policyVersion.count({ where: { orgId: ctx.orgId, state: "retired" } }),
    db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ${ctx.orgId}::uuid AND m.status = 'active' AND u.mfa_enabled`,
    db.membership.count({ where: { orgId: ctx.orgId, status: "active" } }),
    db.incident.count({ where: { orgId: ctx.orgId } }),
    db.alert.count({ where: { orgId: ctx.orgId, createdAt: { gte: since30 } } }),
    db.credential.count({ where: { orgId: ctx.orgId, rotatedAt: { gte: new Date(Date.now() - 90 * 86400_000) } } }),
    verifyChain(db, ctx.orgId, { limit: 5000 }),
    db.apiKey.count({ where: { orgId: ctx.orgId, revokedAt: null } }),
    db.agent.count({ where: { orgId: ctx.orgId, status: { in: ["suspended", "revoked"] } } }),
  ]);
  const mfa = Number(mfaUsers[0]?.n ?? 0);
  return [
    { key: "runtime_authorization", name: "Every AI action is authorised before execution", status: decisions > 0 ? "observed" : "no_data", measure: `${decisions} authorization decisions in 30 days`, frameworks: ["ISO 42001 A.6.2.6", "NIST AI RMF MANAGE 2.4", "ISO 27001 A.5.15"] },
    { key: "human_oversight", name: "Human approval for elevated actions", status: approvals > 0 ? "observed" : "no_data", measure: `${approvals} approval requests in 30 days`, frameworks: ["ISO 42001 A.9.3", "NIST AI RMF GOVERN 3.2"] },
    { key: "policy_versioning", name: "Policies are versioned and changes are attributable", status: policies > 0 ? "observed" : "no_data", measure: `${policies} active policies, ${retiredVersions} retired versions kept`, frameworks: ["ISO 42001 6.1.4", "ISO 27001 A.5.1"] },
    { key: "evidence_integrity", name: "Tamper-evident evidence ledger", status: chain.valid ? "observed" : "failed", measure: `${chain.checked} events verified, chain ${chain.valid ? "valid" : "invalid"}`, frameworks: ["ISO 27001 A.8.15", "NIST AI RMF MEASURE 2.7"] },
    { key: "mfa_adoption", name: "Multi-factor authentication for console users", status: members > 0 && mfa === members ? "observed" : mfa > 0 ? "partial" : "gap", measure: `${mfa} of ${members} active members have MFA enabled`, frameworks: ["ISO 27001 A.5.17", "ISO 27001 A.8.5"] },
    { key: "incident_process", name: "Security incidents are recorded and tracked", status: incidents > 0 ? "observed" : "no_data", measure: `${incidents} incidents recorded`, frameworks: ["ISO 27001 A.5.24", "ISO 42001 A.8.4", "NIST AI RMF MANAGE 4.1"] },
    { key: "continuous_monitoring", name: "Deterministic monitoring rules raise alerts", status: alerts > 0 ? "observed" : "no_data", measure: `${alerts} alerts in 30 days`, frameworks: ["NIST AI RMF MEASURE 2.6", "ISO 27001 A.8.16"] },
    { key: "credential_rotation", name: "Integration credentials are rotated", status: keysRotated > 0 ? "observed" : "gap", measure: `${keysRotated} credentials rotated in 90 days`, frameworks: ["ISO 27001 A.5.17", "ISO 27001 A.8.24"] },
    { key: "agent_lifecycle", name: "Agents can be suspended and revoked with effect", status: "observed", measure: `${suspendedOrRevoked} agents currently suspended or revoked, ${apiKeys} live API keys`, frameworks: ["ISO 42001 A.6.2.5", "NIST AI RMF MANAGE 2.3"] },
  ];
}

/** Per-framework control mapping as maintained by the Audit module, with source labels. */
export async function complianceMappingSummary(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "reports:read");
  const frameworks = await db.framework.findMany({ where: { OR: [{ orgId: null }, { orgId: ctx.orgId }] }, include: { _count: { select: { controls: true } } }, orderBy: { name: "asc" } });
  const mappings = await db.controlMapping.findMany({ where: { orgId: ctx.orgId }, include: { control: { select: { frameworkId: true } } } });
  return frameworks.map((f) => {
    const mine = mappings.filter((m) => m.control.frameworkId === f.id);
    const by = (s: string) => mine.filter((m) => m.source === s).length;
    return { frameworkId: f.id, key: f.key, name: f.name, version: f.version, controls: f._count.controls, mapped: mine.length, automated: by("automated"), customerDocument: by("customer_document"), humanValidated: by("human_validated"), missing: f._count.controls - mine.length + by("missing") };
  });
}

export async function complianceControlsForFramework(db: TenantDb, ctx: OrgContext, frameworkId: string) {
  assertPermission(ctx, "reports:read");
  const controls = await db.control.findMany({ where: { frameworkId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
  const mappings = await db.controlMapping.findMany({ where: { orgId: ctx.orgId, controlId: { in: controls.map((c) => c.id) } } });
  const byControl = new Map(mappings.map((m) => [m.controlId, m]));
  return controls.map((c) => ({ ...c, mapping: byControl.get(c.id) ?? null }));
}
