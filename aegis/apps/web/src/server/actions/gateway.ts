"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { auditEnforcementPath, createFreeze, endFreeze, executeApprovedRequest, forbidden, setTwoPersonRecovery, pauseGateway, releaseQuarantine, releaseQuarantineSchema, reconcileExecution, resolveExecutionManually, resumeGateway, revokeAgentTool, revokeCredential, setIntegrationStatus, transitionAgent } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { activityFamily, subjectHref, type ActivityFamily } from "@/server/queries/control";
import { actorLabel, evidenceLabels } from "@/server/queries/assurance";
import { act } from "./util";

const uuid = z.string().uuid();
const reasonSchema = z.string().min(3).max(1000);

function revalidateGateway() {
  revalidatePath("/gateway");
  revalidatePath("/overview");
  revalidatePath("/", "layout");
}

/** Emergency control: every new request is denied at the baseline stage until the gateway resumes. */
export async function pauseGatewayAction(reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("org:admin")) throw forbidden("Missing permission org:admin");
    const r = reasonSchema.parse(reason);
    const out = await withTenant(c.ctx.orgId, (db) => pauseGateway(db, { ...c.ctx, actor: { ...c.ctx.actor, label: c.session.user.name } }, r));
    revalidateGateway();
    revalidatePath("/approvals");
    return out;
  });
}

export async function resumeGatewayAction(reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("org:admin")) throw forbidden("Missing permission org:admin");
    const r = z.string().max(1000).parse(reason ?? "");
    await withTenant(c.ctx.orgId, (db) => resumeGateway(db, c.ctx, r));
    revalidateGateway();
    revalidatePath("/approvals");
  });
}

export async function emergencySuspendAgentAction(agentId: string, reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(agentId);
    const agent = await withTenant(c.ctx.orgId, (db) => transitionAgent(db, c.ctx, id, "suspended", reasonSchema.parse(reason)));
    revalidateGateway();
    revalidatePath("/agents");
    revalidatePath(`/agents/${id}`);
    return { name: agent.name };
  });
}

export async function emergencyRevokeToolAction(agentId: string, toolId: string, reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const aid = uuid.parse(agentId);
    await withTenant(c.ctx.orgId, (db) => revokeAgentTool(db, c.ctx, aid, uuid.parse(toolId), reasonSchema.parse(reason)));
    revalidateGateway();
    revalidatePath(`/agents/${aid}`);
  });
}

export async function emergencyDisableIntegrationAction(integrationId: string, reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(integrationId);
    const row = await withTenant(c.ctx.orgId, (db) => setIntegrationStatus(db, c.ctx, id, "disabled", reasonSchema.parse(reason)));
    revalidateGateway();
    revalidatePath("/integrations");
    revalidatePath(`/integrations/${id}`);
    return { name: row.name };
  });
}

export async function emergencyRevokeCredentialAction(credentialId: string, reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const row = await withTenant(c.ctx.orgId, (db) => revokeCredential(db, c.ctx, uuid.parse(credentialId), reasonSchema.parse(reason)));
    revalidateGateway();
    revalidatePath("/integrations");
    revalidatePath(`/integrations/${row.integrationId}`);
    return { name: row.name };
  });
}

export interface ActivityEvent {
  id: string;
  seq: string;
  type: string;
  family: ActivityFamily;
  actor: string;
  actorType: string;
  subjectType: string;
  subjectId: string | null;
  subjectLabel: string | null;
  href: string | null;
  correlationId: string | null;
  summary: string;
  occurredAt: string;
}

const feedSchema = z.object({ afterSeq: z.string().regex(/^\d+$/).nullable().optional(), limit: z.coerce.number().int().min(1).max(200).default(60) });

function summarize(type: string, payload: unknown): string {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ["tool", "result", "reason", "rule", "key", "version", "severity", "to", "from", "status", "note"]) {
    const v = p[k];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "object") continue;
    parts.push(`${k} ${String(v)}`);
    if (parts.length >= 3) break;
  }
  if (Array.isArray(p.reasons) && p.reasons.length && typeof p.reasons[0] === "string") parts.push(String(p.reasons[0]).slice(0, 80));
  return parts.join(" · ") || type;
}

/** Evidence newer than `afterSeq` (or the latest `limit` events) for the Live Activity feed. */
export async function activityFeedAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("gateway:read")) throw forbidden("Missing permission gateway:read");
    const f = feedSchema.parse(input ?? {});
    return withTenant(c.ctx.orgId, async (db) => {
      const rows = await db.evidenceEvent.findMany({ where: { orgId: c.ctx.orgId, ...(f.afterSeq ? { seq: { gt: BigInt(f.afterSeq) } } : {}) }, orderBy: { seq: "desc" }, take: f.limit });
      const labels = await evidenceLabels(db, rows);
      const events: ActivityEvent[] = rows.map((e) => ({
        id: e.id,
        seq: e.seq.toString(),
        type: e.type,
        family: activityFamily(e.type),
        actor: actorLabel(e, labels),
        actorType: e.actorType,
        subjectType: e.subjectType,
        subjectId: e.subjectId,
        subjectLabel: e.subjectType === "agent" ? (labels.agents.get(e.subjectId ?? "") ?? null) : null,
        href: subjectHref(e.subjectType, e.subjectId),
        correlationId: e.correlationId,
        summary: summarize(e.type, e.payload),
        occurredAt: e.occurredAt.toISOString(),
      }));
      return { events, serverTime: new Date().toISOString() };
    });
  });
}

/** Re-checks an executing or unresolved request against the downstream system's own records. */
export async function reconcileExecutionAction(requestId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("agents:control")) throw forbidden("Missing permission agents:control");
    const id = uuid.parse(requestId);
    const out = await reconcileExecution((fn) => withTenant(c.ctx.orgId, fn), c.ctx, id);
    revalidateGateway();
    revalidatePath(`/gateway/${id}`);
    return { status: out.status, requestStatus: out.requestStatus, reference: out.reference };
  });
}

/** A human settles an unresolved outcome after checking the downstream system directly. */
export async function resolveExecutionAction(requestId: string, input: { outcome: "succeeded" | "failed"; reference: string; reason: string }) {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("agents:control")) throw forbidden("Missing permission agents:control");
    const id = uuid.parse(requestId);
    const data = z.object({ outcome: z.enum(["succeeded", "failed"]), reference: z.string().max(200), reason: z.string().min(5).max(1000) }).parse(input);
    const out = await withTenant(c.ctx.orgId, (db) => resolveExecutionManually(db, { ...c.ctx, actor: { ...c.ctx.actor, label: c.session.user.name } }, id, { outcome: data.outcome, reference: data.reference || null, reason: data.reason }));
    revalidateGateway();
    revalidatePath(`/gateway/${id}`);
    return { status: out.status, requestStatus: out.requestStatus };
  });
}

/** Runs an approved request whose execution never started (gateway paused in between, grant expired unused). */
export async function executeApprovedAction(requestId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("approvals:decide") && !c.can("agents:control")) throw forbidden("Missing permission approvals:decide");
    const id = uuid.parse(requestId);
    const out = await executeApprovedRequest((fn) => withTenant(c.ctx.orgId, fn), c.ctx, id);
    revalidateGateway();
    revalidatePath(`/gateway/${id}`);
    revalidatePath("/approvals");
    return { status: out.status, requestStatus: out.requestStatus, reference: out.reference };
  });
}

/** Security review of a quarantined request: refuse it, or send it to a person for approval. */
export async function releaseQuarantineAction(requestId: string, input: { action: "refuse" | "to_approval"; reason: string }) {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("security:write")) throw forbidden("Missing permission security:write");
    const id = uuid.parse(requestId);
    const data = releaseQuarantineSchema.parse(input);
    const out = await withTenant(c.ctx.orgId, (db) => releaseQuarantine(db, c.ctx, id, data));
    revalidateGateway();
    revalidatePath(`/gateway/${id}`);
    revalidatePath("/approvals");
    return out;
  });
}

/** Compares an integration's own records with what AEGIS authorized, looking for actions taken around the gateway. */
export async function auditEnforcementAction(integrationId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("integrations:write") && !c.can("security:write")) throw forbidden("Missing permission integrations:write");
    const id = uuid.parse(integrationId);
    const out = await auditEnforcementPath((fn) => withTenant(c.ctx.orgId, fn), c.ctx, id);
    revalidatePath(`/integrations/${id}`);
    revalidatePath("/security/events");
    return { observable: out.observable, operations: out.operations, matched: out.matched, outside: out.findings.length, error: out.error };
  });
}

/** Change freezes (docs/CHANGE_FREEZE.md): permission and input checks are in core. */
export async function createFreezeAction(input: { title: string; reason: string; startsAt: string; endsAt: string; effect: "deny" | "require_approval"; minRiskLevel: "low" | "medium" | "high" | "critical"; agentIds: string[] }) {
  return act(async () => {
    const c = await getConsoleContext();
    const f = await withTenant(c.ctx.orgId, (db) => createFreeze(db, { ...c.ctx, actor: { ...c.ctx.actor, label: c.session.user.name } }, input));
    revalidateGateway();
    return { id: f.id };
  });
}

export async function endFreezeAction(freezeId: string, reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => endFreeze(db, { ...c.ctx, actor: { ...c.ctx.actor, label: c.session.user.name } }, uuid.parse(freezeId), reason));
    revalidateGateway();
  });
}

export async function setTwoPersonRecoveryAction(enabled: boolean, reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => setTwoPersonRecovery(db, c.ctx, { enabled: z.boolean().parse(enabled), reason }));
    revalidateGateway();
  });
}
