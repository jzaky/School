/**
 * Automated evidence checks: facts about this tenant's own AEGIS records that support a control.
 * Each check returns a count-style reference such as "aegis:approval_requests:count=312". These
 * are facts about the system of record, not a judgement about compliance; the engine labels
 * findings that rely on them as automated and they still require human validation.
 */
import type { TenantDb } from "@aegis/db";
import { verifyChain } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";

export const AUTOMATED_EVIDENCE_TYPES = [
  "approval_workflow",
  "evidence_ledger",
  "access_control",
  "incident_management",
  "policy_versioning",
  "monitoring",
  "agent_inventory",
  "data_protection",
  "integration_security",
  "security_events",
] as const;
export type AutomatedEvidenceType = (typeof AUTOMATED_EVIDENCE_TYPES)[number];

export interface AutomatedEvidence {
  type: AutomatedEvidenceType;
  /** True when the records exist (and, for the ledger, verify). */
  present: boolean;
  /** Machine-readable reference, e.g. "aegis:approval_requests:count=312". */
  reference: string;
  /** Human-readable sentence for the rationale. */
  detail: string;
}

export function isAutomatedEvidenceType(v: string | null | undefined): v is AutomatedEvidenceType {
  return !!v && (AUTOMATED_EVIDENCE_TYPES as readonly string[]).includes(v);
}

export async function runAutomatedCheck(db: TenantDb, ctx: OrgContext, type: string | null | undefined): Promise<AutomatedEvidence | null> {
  if (!isAutomatedEvidenceType(type)) return null;
  const orgId = ctx.orgId;
  switch (type) {
    case "approval_workflow": {
      const [total, decided] = await Promise.all([db.approvalRequest.count({ where: { orgId } }), db.approvalRequest.count({ where: { orgId, status: { in: ["approved", "rejected"] } } })]);
      return { type, present: total > 0, reference: `aegis:approval_requests:count=${total};decided=${decided}`, detail: `${total} approval requests are recorded in the Action Gateway, ${decided} decided by a human approver.` };
    }
    case "evidence_ledger": {
      const total = await db.evidenceEvent.count({ where: { orgId } });
      const v = total > 0 ? await verifyChain(db, orgId, { limit: 5000 }) : null;
      const valid = !!v && v.valid;
      return { type, present: total > 0 && valid, reference: `aegis:evidence_events:count=${total};chain=${valid ? "valid" : "invalid"}`, detail: `${total} evidence events in the tamper-evident ledger; hash chain ${valid ? "verified" : "did not verify"} over the first ${v?.checked ?? 0} events.` };
    }
    case "access_control": {
      const [roles, members] = await Promise.all([db.role.count({ where: { orgId } }), db.membership.count({ where: { orgId, status: "active" } })]);
      return { type, present: roles > 0 && members > 0, reference: `aegis:roles:count=${roles};memberships:count=${members}`, detail: `${roles} roles with explicit permission sets govern ${members} active members.` };
    }
    case "incident_management": {
      const [total, open] = await Promise.all([db.incident.count({ where: { orgId } }), db.incident.count({ where: { orgId, status: { not: "resolved" } } })]);
      return { type, present: total > 0, reference: `aegis:incidents:count=${total};open=${open}`, detail: `${total} incidents tracked (${open} open).` };
    }
    case "policy_versioning": {
      const [versions, active] = await Promise.all([db.policyVersion.count({ where: { orgId } }), db.policyVersion.count({ where: { orgId, state: "active" } })]);
      return { type, present: versions > 0, reference: `aegis:policy_versions:count=${versions};active=${active}`, detail: `${versions} policy versions with content hashes and approval records, ${active} active.` };
    }
    case "monitoring": {
      const [rules, alerts] = await Promise.all([db.monitoringRule.count({ where: { orgId, enabled: true } }), db.alert.count({ where: { orgId } })]);
      return { type, present: rules > 0, reference: `aegis:monitoring_rules:count=${rules};alerts:count=${alerts}`, detail: `${rules} enabled monitoring rules have produced ${alerts} alerts.` };
    }
    case "agent_inventory": {
      const [agents, active] = await Promise.all([db.agent.count({ where: { orgId } }), db.agent.count({ where: { orgId, status: "active" } })]);
      return { type, present: agents > 0, reference: `aegis:agents:count=${agents};active=${active}`, detail: `${agents} AI agents registered with owners, risk tiers and tool permissions (${active} active).` };
    }
    case "data_protection": {
      const classes = await db.dataClass.count({ where: { orgId, enabled: true } });
      return { type, present: classes > 0, reference: `aegis:data_classes:count=${classes}`, detail: `${classes} enabled data classes with detection and handling actions.` };
    }
    case "integration_security": {
      const [integrations, credentials] = await Promise.all([db.integration.count({ where: { orgId } }), db.credential.count({ where: { orgId } })]);
      return { type, present: integrations > 0, reference: `aegis:integrations:count=${integrations};credentials:count=${credentials}`, detail: `${integrations} integrations registered with ${credentials} vaulted credentials.` };
    }
    case "security_events": {
      const total = await db.securityEvent.count({ where: { orgId } });
      return { type, present: total > 0, reference: `aegis:security_events:count=${total}`, detail: `${total} security events recorded by Shield.` };
    }
  }
}
