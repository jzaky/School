import type { TenantDb } from "@aegis/db";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { forbidden, notFound, validation } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";
import { createSecurityEvent } from "../shield/security-events.js";
import { transitionAgent } from "./registry.js";

export interface RevocationReport {
  agentId: string;
  mode: "suspend" | "revoke";
  grantsVoided: number;
  apiKeysRevoked: number;
  delegationsRevoked: number;
  temporaryAccessRevoked: number;
  approvalsClosed: number;
  heldRequestsClosed: number;
  /** Requests already running downstream when revocation happened. AEGIS cannot undo them; it lists them for follow-up. */
  inFlight: { requestId: string; tool: string; status: string }[];
}

/**
 * Emergency revocation in one step. Stops all future authority immediately: the agent is suspended (or
 * revoked), live grants are voided, delegations in both directions end, temporary access ends,
 * pending approvals and held requests are closed so they can never execute, and (on revoke) its API
 * keys are revoked. Requests already executing downstream cannot be pulled back by AEGIS; they are
 * listed so a person can follow up with the downstream system. A security event records the action.
 */
export async function emergencyRevokeAgent(db: TenantDb, ctx: OrgContext, agentId: string, input: { mode: "suspend" | "revoke"; reason: string }): Promise<RevocationReport> {
  if (ctx.actor.type !== "user" && ctx.actor.type !== "system") throw forbidden("Only a person or AEGIS itself can revoke an agent");
  assertPermission(ctx, "agents:control");
  if (input.reason.trim().length < 5) throw validation("Give a reason of at least five characters");
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw notFound("Agent");
  const now = ctx.now ?? new Date();
  const before = await db.executionGrant.count({ where: { orgId: ctx.orgId, consumedAt: null, voidedAt: null, request: { agentId } } });
  const target = input.mode === "revoke" ? "revoked" : "suspended";
  // Keys are counted first: revoking the agent revokes its keys inside the status change.
  // Counted before the status change, which itself closes pending approvals on revoke.
  const pending = await db.approvalRequest.findMany({ where: { orgId: ctx.orgId, status: { in: ["pending", "more_info", "escalated"] }, request: { agentId } }, select: { id: true, actionRequestId: true } });
  const liveKeys = input.mode === "revoke" ? await db.apiKey.count({ where: { subjectType: "agent", subjectId: agentId, revokedAt: null } }) : 0;
  if (agent.status !== target && agent.status !== "revoked") await transitionAgent(db, ctx, agentId, target, `emergency: ${input.reason}`);
  if (input.mode === "revoke") await db.apiKey.updateMany({ where: { subjectType: "agent", subjectId: agentId, revokedAt: null }, data: { revokedAt: now } });
  const keys = { count: liveKeys };
  const delegations = await db.agentDelegation.updateMany({ where: { orgId: ctx.orgId, revokedAt: null, OR: [{ delegatorAgentId: agentId }, { delegateAgentId: agentId }] }, data: { revokedAt: now, revokedReason: `emergency revocation: ${input.reason}` } });
  const temp = await db.accessRequest.findMany({ where: { orgId: ctx.orgId, agentId, status: "approved" } });
  for (const r of temp) {
    if (r.toolId) await db.agentTool.updateMany({ where: { agentId, toolId: r.toolId, expiresAt: { not: null }, revokedAt: null }, data: { enabled: false, revokedAt: now, revokedReason: "emergency revocation" } });
    if (r.resourceId) await db.permission.updateMany({ where: { agentId, resourceId: r.resourceId, expiresAt: r.expiresAt, revokedAt: null }, data: { revokedAt: now } });
  }
  await db.accessRequest.updateMany({ where: { orgId: ctx.orgId, agentId, status: { in: ["approved", "pending"] } }, data: { status: "revoked" } });
  for (const p of pending) {
    await db.approvalRequest.updateMany({ where: { id: p.id, status: { in: ["pending", "more_info", "escalated"] } }, data: { status: "expired", decidedAt: now, reason: `agent ${target}` } });
    await db.actionRequest.updateMany({ where: { id: p.actionRequestId, status: "pending_approval" }, data: { status: "expired", completedAt: now } });
  }
  const held = await db.actionRequest.updateMany({ where: { orgId: ctx.orgId, agentId, status: { in: ["quarantined", "awaiting_information", "allowed", "approved"] } }, data: { status: "expired", completedAt: now } });
  const inFlight = await db.actionRequest.findMany({ where: { orgId: ctx.orgId, agentId, status: { in: ["executing", "unknown"] } }, select: { id: true, toolKey: true, status: true } });
  const after = await db.executionGrant.count({ where: { orgId: ctx.orgId, consumedAt: null, voidedAt: null, request: { agentId } } });
  const report: RevocationReport = { agentId, mode: input.mode, grantsVoided: Math.max(0, before - after), apiKeysRevoked: keys.count, delegationsRevoked: delegations.count, temporaryAccessRevoked: temp.length, approvalsClosed: pending.length, heldRequestsClosed: held.count, inFlight: inFlight.map((r) => ({ requestId: r.id, tool: r.toolKey, status: r.status })) };
  await appendEvidence(db, ctx, { type: "agent.emergency_revocation", subjectType: "agent", subjectId: agentId, payload: { ...report, inFlight: report.inFlight.map((r) => r.requestId), reason: input.reason } });
  await createSecurityEvent(db, ctx, { type: "agent.emergency_revocation", severity: "high", title: `Emergency ${input.mode}: ${agent.slug}`, agentId, detail: { reason: input.reason, inFlight: report.inFlight.length, grantsVoided: report.grantsVoided }, escalate: false });
  return report;
}
